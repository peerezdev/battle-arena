"""Tests for Pack Battle lobby REST endpoints (Task 5).

Mirrors test_gacha_api.py scaffolding:
- In-memory SQLite DB
- Fake Privy with a key_resolver (no network)
- TestClient
- Authorization: Bearer <token>

Monkeypatches:
- usdc_balance_base_units (high balance → pass, low → 402)
- gacha.machines (returns a single machine)
- run_pack_battle_live (async stub — asserts it was scheduled, does NOT run it)
"""
from __future__ import annotations

import asyncio
import json
import time
import pytest

from cryptography.hazmat.primitives.asymmetric import ec
import jwt

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from app.main import create_app
from app.db import make_session_factory, init_db
from app.privy import PrivyVerifier
from app.chain.mock import MockChainSource
from app.services.gacha import GachaService

APP_ID = "testapp"

# ── Wallets usadas en los tests ──────────────────────────────────────────────
# Must be valid base-58 Solana-like addresses (44 chars)
WALLET_A = "So1anaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1"
WALLET_B = "So1anaBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1"
WALLET_ID_A = "wallet-id-aaa"
WALLET_ID_B = "wallet-id-bbb"

# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_es256():
    return ec.generate_private_key(ec.SECP256R1())


def _solana_embedded_with_id(addr: str, wallet_id: str) -> dict:
    """linked_account entry that carries both address AND id (needed for wallet_id endpoint)."""
    return {
        "type": "wallet",
        "chain_type": "solana",
        "connector_type": None,
        "wallet_client_type": "privy",
        "address": addr,
        "id": wallet_id,
    }


def _make_token(priv, app_id: str, addr: str, wallet_id: str) -> str:
    now = int(time.time())
    payload = {
        "aud": app_id,
        "iss": "privy.io",
        "sub": f"did:privy:{addr[:8]}",
        "iat": now,
        "exp": now + 3600,
        "linked_accounts": json.dumps([_solana_embedded_with_id(addr, wallet_id)]),
    }
    return jwt.encode(payload, priv, algorithm="ES256", headers={"kid": "test-kid", "alg": "ES256"})


def _auth_headers(priv, addr: str, wallet_id: str) -> dict:
    token = _make_token(priv, APP_ID, addr, wallet_id)
    return {"Authorization": f"Bearer {token}"}


# ── App builder ───────────────────────────────────────────────────────────────
# We pass a dummy usdc_mint that is a valid Solana pubkey so Pubkey.from_string doesn't blow up.
# The actual balance check is monkeypatched so no RPC call is made.
DUMMY_RPC = "https://api.devnet.solana.com"
DUMMY_MINT = "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr"


def _build_client(signer=None, dev_endpoints_enabled=False):
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    init_db(engine)
    sf = make_session_factory(engine)
    priv = _make_es256()
    privy = PrivyVerifier(app_id=APP_ID, key_resolver=lambda kid: priv.public_key())
    gacha = GachaService(base_url="https://dev-gacha.example.com", api_key="")
    app = create_app(
        sf,
        MockChainSource(),
        gacha=gacha,
        privy=privy,
        privy_signer=signer,                # NEW: inject (None by default, as before)
        solana_rpc_url=DUMMY_RPC,
        cc_usdc_mint=DUMMY_MINT,
        privy_operator_wallet_id="op-wallet-id",
        privy_operator_address="So1anaOPERATOR1111111111111111111111111111",
        escrow_seed_lamports=10_000_000,
        dev_endpoints_enabled=dev_endpoints_enabled,
    )
    return TestClient(app, raise_server_exceptions=True), priv


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def client_priv():
    return _build_client()


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_create_battle_returns_hash_not_seed(client_priv, monkeypatch):
    """POST /pack-battles → 200, returns server_seed_hash, does NOT reveal server_seed."""
    c, priv = client_priv

    async def _high_balance(*args, **kwargs):
        return 100_000_000  # 100 USDC in base units — well above price

    async def _machines():
        return [{"code": "pokemon_50", "price": 50, "available": True}]

    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_balance)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())

    hdrs = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    r = c.post("/pack-battles", json={"machine_code": "pokemon_50", "max_players": 2}, headers=hdrs)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "id" in body
    assert "server_seed_hash" in body
    assert "server_seed" not in body  # must NOT be revealed pre-settle
    assert body["status"] == "lobby"


def test_rematch_guards(client_priv, monkeypatch):
    """Rematch requires a participant and a finished battle."""
    c, priv = client_priv

    async def _high_balance(*args, **kwargs):
        return 100_000_000

    async def _machines():
        return [{"code": "pokemon_50", "price": 50, "available": True}]

    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_balance)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())

    hdrs_a = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    bid = c.post("/pack-battles", json={"machine_code": "pokemon_50", "max_players": 2}, headers=hdrs_a).json()["id"]

    # battle still in lobby (not finished) → 409, even for a participant
    assert c.post(f"/pack-battles/{bid}/rematch", headers=hdrs_a).status_code == 409
    # non-participant → 403
    hdrs_b = _auth_headers(priv, WALLET_B, WALLET_ID_B)
    assert c.post(f"/pack-battles/{bid}/rematch", headers=hdrs_b).status_code == 403
    # unknown battle → 404
    assert c.post("/pack-battles/does-not-exist/rematch", headers=hdrs_a).status_code == 404


def test_second_player_join_schedules_run(client_priv, monkeypatch):
    """Second player joining a 2-player lobby fills it → run_pack_battle_live is scheduled."""
    c, priv = client_priv

    run_called: list = []

    async def _high_balance(*args, **kwargs):
        return 100_000_000

    async def _machines():
        return [{"code": "pokemon_50", "price": 50, "available": True}]

    async def _fake_run(session, battle, *, gacha, signer, **kwargs):
        run_called.append(battle.id)

    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_balance)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())
    monkeypatch.setattr("app.main.run_pack_battle_live", _fake_run)

    # Player A creates the battle
    hdrs_a = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    r_create = c.post(
        "/pack-battles", json={"machine_code": "pokemon_50", "max_players": 2}, headers=hdrs_a
    )
    assert r_create.status_code == 200, r_create.text
    battle_id = r_create.json()["id"]

    # Player B joins — this fills the lobby (max_players=2)
    hdrs_b = _auth_headers(priv, WALLET_B, WALLET_ID_B)
    r_join = c.post(f"/pack-battles/{battle_id}/join", headers=hdrs_b)
    assert r_join.status_code == 200, r_join.text

    # Give the event loop a tick so the asyncio.create_task fires
    async def _drain():
        await asyncio.sleep(0)

    asyncio.get_event_loop().run_until_complete(_drain())

    # The stub should have been called (task was scheduled)
    assert run_called, "run_pack_battle_live was not scheduled after lobby filled"


def test_get_open_battles(client_priv, monkeypatch):
    """GET /pack-battles/open lists open lobbies."""
    c, priv = client_priv

    async def _high_balance(*args, **kwargs):
        return 100_000_000

    async def _machines():
        return [{"code": "pokemon_50", "price": 50, "available": True}]

    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_balance)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())

    hdrs = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    c.post("/pack-battles", json={"machine_code": "pokemon_50", "max_players": 3}, headers=hdrs)

    r = c.get("/pack-battles/open")
    assert r.status_code == 200, r.text
    battles = r.json()
    assert isinstance(battles, list)
    assert len(battles) >= 1
    assert battles[0]["machine_code"] == "pokemon_50"


def test_get_battle_no_server_seed_pre_settle(client_priv, monkeypatch):
    """GET /pack-battles/{id} returns state without server_seed while not settled."""
    c, priv = client_priv

    async def _high_balance(*args, **kwargs):
        return 100_000_000

    async def _machines():
        return [{"code": "pokemon_50", "price": 50, "available": True}]

    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_balance)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())

    hdrs = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    r_create = c.post(
        "/pack-battles", json={"machine_code": "pokemon_50", "max_players": 2}, headers=hdrs
    )
    assert r_create.status_code == 200
    battle_id = r_create.json()["id"]

    r = c.get(f"/pack-battles/{battle_id}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == battle_id
    assert "server_seed_hash" in body
    assert "server_seed" not in body  # not settled yet


def test_join_insufficient_usdc_returns_402(client_priv, monkeypatch):
    """Joining with insufficient USDC balance → 402."""
    c, priv = client_priv

    call_count = 0

    async def _balance_varies(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        # First call (create): high balance; subsequent calls (join): low balance
        if call_count <= 1:
            return 100_000_000
        return 0  # zero balance for join attempt

    async def _machines():
        return [{"code": "pokemon_50", "price": 50, "available": True}]

    monkeypatch.setattr("app.main.usdc_balance_base_units", _balance_varies)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())

    # Player A creates (has funds)
    hdrs_a = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    r_create = c.post(
        "/pack-battles", json={"machine_code": "pokemon_50", "max_players": 2}, headers=hdrs_a
    )
    assert r_create.status_code == 200, r_create.text
    battle_id = r_create.json()["id"]

    # Player B tries to join but has zero USDC
    hdrs_b = _auth_headers(priv, WALLET_B, WALLET_ID_B)
    r_join = c.post(f"/pack-battles/{battle_id}/join", headers=hdrs_b)
    assert r_join.status_code == 402, r_join.text


# ── Royale mode tests ─────────────────────────────────────────────────────────

def _make_royale_app(escrow_created_list=None, escrow_address="So1anaESCROWXXXXXXXXXXXXXXXXXXXXXXXXXXX1"):
    """Build a fresh TestClient+priv pair with a fake signer that records escrow creation."""
    from app.db import make_session_factory, init_db
    from sqlalchemy import create_engine
    from sqlalchemy.pool import StaticPool
    from app.main import create_app
    from app.privy import PrivyVerifier
    from app.chain.mock import MockChainSource
    from app.services.gacha import GachaService
    from fastapi.testclient import TestClient

    counter = [0]

    class FakeSigner:
        async def create_solana_wallet(self):
            counter[0] += 1
            if escrow_created_list is not None:
                escrow_created_list.append(True)
            return {"id": f"escrow-wid-{counter[0]}", "address": escrow_address}

    engine2 = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    init_db(engine2)
    sf2 = make_session_factory(engine2)
    priv2 = _make_es256()
    privy2 = PrivyVerifier(app_id=APP_ID, key_resolver=lambda kid: priv2.public_key())
    gacha2 = GachaService(base_url="https://dev-gacha.example.com", api_key="")

    app2 = create_app(
        sf2, MockChainSource(), gacha=gacha2, privy=privy2,
        privy_signer=FakeSigner(),
        solana_rpc_url=DUMMY_RPC, cc_usdc_mint=DUMMY_MINT,
        privy_operator_wallet_id="op-wallet-id",
        privy_operator_address="So1anaOPERATOR1111111111111111111111111111",
        escrow_seed_lamports=10_000_000,
    )
    return TestClient(app2, raise_server_exceptions=True), priv2


def test_royale_create_returns_200_with_buyin_and_escrow(client_priv, monkeypatch):
    """POST /pack-battles with mode=royale → 200; body has buyin and escrow_address; escrow is pre-created."""
    async def _high_balance(*args, **kwargs):
        return 200_000_000  # well above any buyin

    async def _machines():
        return [{"code": "pokemon_50", "price": 50, "available": True}]

    async def _fake_collect_buyin(*args, **kwargs):
        return "fake-sig"

    async def _fake_blockhash(rpc_url: str) -> str:
        return "FakeBH444444444444444444444444444444444444444"

    escrow_created = []
    c2, priv2 = _make_royale_app(escrow_created_list=escrow_created)

    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_balance)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())
    monkeypatch.setattr("app.main.collect_buyin", _fake_collect_buyin)
    monkeypatch.setattr("app.main.fetch_latest_blockhash", _fake_blockhash)

    hdrs = _auth_headers(priv2, WALLET_A, WALLET_ID_A)
    r = c2.post("/pack-battles", json={"machine_code": "pokemon_50", "max_players": 4, "mode": "royale"}, headers=hdrs)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("mode") == "royale"
    assert "buyin" in body, f"buyin not in response: {body}"
    assert body["buyin"] > 0
    # escrow must be pre-created (create_solana_wallet was called)
    assert escrow_created, "signer.create_solana_wallet was not called at royale create time"
    assert body.get("escrow_address"), "escrow_address not in response"


def test_royale_join_collects_buyin(client_priv, monkeypatch):
    """Joining a royale battle calls collect_buyin once per new player."""
    async def _high_balance(*args, **kwargs):
        return 200_000_000

    async def _machines():
        return [{"code": "pokemon_50", "price": 50, "available": True}]

    buyin_calls: list = []

    async def _fake_collect_buyin(*args, **kwargs):
        buyin_calls.append(args)
        return "fake-sig"

    async def _fake_blockhash(rpc_url: str) -> str:
        return "FakeBH111111111111111111111111111111111111111"

    c2, priv2 = _make_royale_app()

    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_balance)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())
    monkeypatch.setattr("app.main.collect_buyin", _fake_collect_buyin)
    monkeypatch.setattr("app.main.fetch_latest_blockhash", _fake_blockhash)

    # Player A creates royale battle
    hdrs_a = _auth_headers(priv2, WALLET_A, WALLET_ID_A)
    r = c2.post("/pack-battles", json={"machine_code": "pokemon_50", "max_players": 3, "mode": "royale"}, headers=hdrs_a)
    assert r.status_code == 200, r.text
    battle_id = r.json()["id"]

    # Player B joins — collect_buyin should be called again (once for creator at create, once for joiner B)
    hdrs_b = _auth_headers(priv2, WALLET_B, WALLET_ID_B)
    r2 = c2.post(f"/pack-battles/{battle_id}/join", headers=hdrs_b)
    assert r2.status_code == 200, r2.text
    assert len(buyin_calls) == 2, f"collect_buyin called {len(buyin_calls)} times, expected 2 (1 for creator at create + 1 for joiner B)"


def test_royale_creator_buyin_collected_at_create(client_priv, monkeypatch):
    """POST /pack-battles with mode=royale → collect_buyin is called for the creator immediately."""
    async def _high_balance(*args, **kwargs):
        return 200_000_000

    async def _machines():
        return [{"code": "pokemon_50", "price": 50, "available": True}]

    buyin_calls: list = []

    async def _fake_collect_buyin(*args, **kwargs):
        buyin_calls.append(args)
        return "fake-sig"

    async def _fake_blockhash(rpc_url: str) -> str:
        return "FakeBH333333333333333333333333333333333333333"

    c2, priv2 = _make_royale_app()

    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_balance)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())
    monkeypatch.setattr("app.main.collect_buyin", _fake_collect_buyin)
    monkeypatch.setattr("app.main.fetch_latest_blockhash", _fake_blockhash)

    # Player A creates royale battle
    hdrs_a = _auth_headers(priv2, WALLET_A, WALLET_ID_A)
    r = c2.post("/pack-battles", json={"machine_code": "pokemon_50", "max_players": 3, "mode": "royale"}, headers=hdrs_a)
    assert r.status_code == 200, r.text

    # collect_buyin should have been called once (for the creator) right at create time
    assert len(buyin_calls) == 1, f"collect_buyin called {len(buyin_calls)} times, expected 1 for creator"
    # The creator's wallet (WALLET_A) and wallet_id (WALLET_ID_A) must be in the call args
    creator_call_args = buyin_calls[0]
    assert WALLET_ID_A in creator_call_args, f"WALLET_ID_A not in collect_buyin args: {creator_call_args}"
    assert WALLET_A in creator_call_args, f"WALLET_A not in collect_buyin args: {creator_call_args}"


def test_royale_fill_schedules_run_royale_live(client_priv, monkeypatch):
    """When a royale lobby fills, run_royale_live (not run_pack_battle_live) is scheduled."""
    async def _high_balance(*args, **kwargs):
        return 200_000_000

    async def _machines():
        return [{"code": "pokemon_50", "price": 50, "available": True}]

    async def _fake_collect_buyin(*args, **kwargs):
        return "fake-sig"

    async def _fake_blockhash(rpc_url: str) -> str:
        return "FakeBH222222222222222222222222222222222222222"

    royale_scheduled: list = []

    async def _fake_run_royale_live(session, battle, **kwargs):
        royale_scheduled.append(battle.id)

    pack_scheduled: list = []

    async def _fake_run_pack_live(session, battle, **kwargs):
        pack_scheduled.append(battle.id)

    c2, priv2 = _make_royale_app()

    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_balance)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())
    monkeypatch.setattr("app.main.collect_buyin", _fake_collect_buyin)
    monkeypatch.setattr("app.main.fetch_latest_blockhash", _fake_blockhash)
    monkeypatch.setattr("app.main.run_royale_live", _fake_run_royale_live)
    monkeypatch.setattr("app.main.run_pack_battle_live", _fake_run_pack_live)

    hdrs_a = _auth_headers(priv2, WALLET_A, WALLET_ID_A)
    r = c2.post("/pack-battles", json={"machine_code": "pokemon_50", "max_players": 2, "mode": "royale"}, headers=hdrs_a)
    assert r.status_code == 200, r.text
    battle_id = r.json()["id"]

    hdrs_b = _auth_headers(priv2, WALLET_B, WALLET_ID_B)
    r2 = c2.post(f"/pack-battles/{battle_id}/join", headers=hdrs_b)
    assert r2.status_code == 200, r2.text

    # Drain the event loop so the task fires
    asyncio.get_event_loop().run_until_complete(asyncio.sleep(0))

    assert royale_scheduled, "run_royale_live was not scheduled after royale lobby filled"
    assert not pack_scheduled, "run_pack_battle_live should NOT be called for royale mode"


def test_available_balance_blocks_overcommit(client_priv, monkeypatch):
    """With on-chain funds for exactly ONE price, a second Pack Battle create is 402."""
    c, priv = client_priv

    async def _one_price_balance(*args, **kwargs):
        return 50_000_000  # exactly $50 — one pack price

    async def _machines():
        return [{"code": "pokemon_50", "price": 50, "available": True}]

    monkeypatch.setattr("app.main.usdc_balance_base_units", _one_price_balance)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())

    hdrs = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    r1 = c.post("/pack-battles", json={"machine_code": "pokemon_50", "max_players": 2}, headers=hdrs)
    assert r1.status_code == 200, r1.text            # first reserves $50 → available now 0
    r2 = c.post("/pack-battles", json={"machine_code": "pokemon_50", "max_players": 2}, headers=hdrs)
    assert r2.status_code == 402, r2.text            # over-commit blocked


def test_reservations_released_after_run(client_priv, monkeypatch):
    """After a filled lobby runs (stubbed), the wiring releases its reservations — proven by the
    creator being able to create a SECOND battle while holding funds for only ONE price."""
    c, priv = client_priv

    async def _one_price(*args, **kwargs):
        return 50_000_000   # exactly one $50 price → only affordable if the first reservation freed

    async def _machines():
        return [{"code": "pokemon_50", "price": 50, "available": True}]

    async def _fake_run(session, battle, *, gacha, signer, **kwargs):
        return "settled"

    monkeypatch.setattr("app.main.usdc_balance_base_units", _one_price)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())
    monkeypatch.setattr("app.main.run_pack_battle_live", _fake_run)

    import asyncio
    hdrs_a = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    bid = c.post("/pack-battles", json={"machine_code": "pokemon_50", "max_players": 2}, headers=hdrs_a).json()["id"]
    hdrs_b = _auth_headers(priv, WALLET_B, WALLET_ID_B)
    c.post(f"/pack-battles/{bid}/join", headers=hdrs_b)   # fills → schedules _run_bg (stubbed) → release

    asyncio.get_event_loop().run_until_complete(asyncio.sleep(0.1))   # let _run_bg + its finally run

    # A's reservation for the finished battle was released → a second create now succeeds.
    r = c.post("/pack-battles", json={"machine_code": "pokemon_50", "max_players": 2}, headers=hdrs_a)
    assert r.status_code == 200, r.text


def test_pack_cancel_releases_reservation_creator_only(client_priv, monkeypatch):
    c, priv = client_priv

    async def _exact_one_price(*args, **kwargs):
        return 50_000_000

    async def _machines():
        return [{"code": "pokemon_50", "price": 50, "available": True}]

    monkeypatch.setattr("app.main.usdc_balance_base_units", _exact_one_price)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())

    hdrs_a = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    bid = c.post("/pack-battles", json={"machine_code": "pokemon_50", "max_players": 2}, headers=hdrs_a).json()["id"]

    # Non-creator cannot cancel
    hdrs_b = _auth_headers(priv, WALLET_B, WALLET_ID_B)
    assert c.post(f"/pack-battles/{bid}/cancel", headers=hdrs_b).status_code == 409

    # Creator cancels → cancelled
    r = c.post(f"/pack-battles/{bid}/cancel", headers=hdrs_a)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "cancelled"

    # Reservation was released: a new battle with the same wallet must succeed (available = price again)
    r2 = c.post("/pack-battles", json={"machine_code": "pokemon_50", "max_players": 2}, headers=hdrs_a)
    assert r2.status_code == 200, f"second create failed ({r2.status_code}) — reservation not released"


class _FakeSigner:
    async def create_solana_wallet(self):
        return {"id": "esc-id", "address": "So1anaESCROW111111111111111111111111111111"}


def test_royale_cancel_refunds_buyins(monkeypatch):
    # The royale create path calls privy_signer.create_solana_wallet(), so this test builds a
    # client WITH a fake signer (the default _build_client() passes privy_signer=None).
    c, priv = _build_client(signer=_FakeSigner())
    refunds = []

    async def _high(*args, **kwargs):
        return 1_000_000_000

    async def _machines():
        return [{"code": "pokemon_50", "price": 50, "available": True}]

    async def _collect(*args, **kwargs):
        return "collect-sig"

    async def _bh(*args, **kwargs):
        return "11111111111111111111111111111111"

    async def _refund(rpc, signer, ewid, eaddr, opid, opaddr, player, mint, amount, bh):
        refunds.append((player, amount)); return "refund-sig"

    monkeypatch.setattr("app.main.usdc_balance_base_units", _high)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())
    monkeypatch.setattr("app.main.fetch_latest_blockhash", _bh)
    monkeypatch.setattr("app.main.collect_buyin", _collect)
    monkeypatch.setattr("app.main.refund_buyin", _refund)

    hdrs_a = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    res = c.post("/pack-battles", json={"machine_code": "pokemon_50", "max_players": 3, "mode": "royale"}, headers=hdrs_a)
    assert res.status_code == 200, res.text
    bid = res.json()["id"]

    r = c.post(f"/pack-battles/{bid}/cancel", headers=hdrs_a)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "cancelled"
    assert len(refunds) == 1                          # only the creator had joined
    assert refunds[0][0] == WALLET_A


def test_verify_endpoint_pre_settle_and_404(client_priv, monkeypatch):
    c, priv = client_priv

    async def _high(*args, **kwargs):
        return 100_000_000

    async def _machines():
        return [{"code": "pokemon_50", "price": 50, "available": True}]

    monkeypatch.setattr("app.main.usdc_balance_base_units", _high)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())

    assert c.get("/pack-battles/does-not-exist/verify").status_code == 404

    hdrs = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    bid = c.post("/pack-battles", json={"machine_code": "pokemon_50", "max_players": 2}, headers=hdrs).json()["id"]
    r = c.get(f"/pack-battles/{bid}/verify")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["server_seed_hash"] and body["server_seed"] is None   # pre-settle


def test_me_balance_returns_reserved(client_priv, monkeypatch):
    c, priv = client_priv

    async def _high_balance(*args, **kwargs):
        return 100_000_000

    async def _machines():
        return [{"code": "pokemon_50", "price": 50, "available": True}]

    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_balance)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())
    hdrs = _auth_headers(priv, WALLET_A, WALLET_ID_A)

    # no reservations yet
    r0 = c.get("/users/me/balance", headers=hdrs)
    assert r0.status_code == 200 and r0.json() == {"reserved": 0, "locked_royale": 0}

    # creating a pack battle reserves the price (50 * 1e6 base units)
    c.post("/pack-battles", json={"machine_code": "pokemon_50", "max_players": 2}, headers=hdrs)
    r1 = c.get("/users/me/balance", headers=hdrs)
    assert r1.json() == {"reserved": 50_000_000, "locked_royale": 0}


def test_me_balance_requires_auth(client_priv):
    c, _ = client_priv
    assert c.get("/users/me/balance").status_code == 401


def test_open_battles_include_creator_wallet(client_priv, monkeypatch):
    c, priv = client_priv

    async def _high_balance(*args, **kwargs):
        return 100_000_000

    async def _machines():
        return [{"code": "pokemon_50", "price": 50, "available": True}]

    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_balance)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())
    hdrs = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    c.post("/pack-battles", json={"machine_code": "pokemon_50", "max_players": 2}, headers=hdrs)
    row = c.get("/pack-battles/open").json()[0]
    assert row["creator_wallet"] == WALLET_A


def test_create_multipack_bundle(client_priv, monkeypatch):
    c, priv = client_priv

    async def _high_balance(*args, **kwargs):
        return 1_000_000_000

    async def _machines():
        return [{"code": "m25", "price": 25, "available": True},
                {"code": "m50", "price": 50, "available": True}]

    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_balance)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())
    hdrs = _auth_headers(priv, WALLET_A, WALLET_ID_A)

    r = c.post("/pack-battles", json={"max_players": 2,
               "packs": [{"machine_code": "m25", "count": 1}, {"machine_code": "m50", "count": 2}]},
               headers=hdrs)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["price"] == 125_000_000   # 25 + 50 + 50, base units
    assert body["packs"] == [
        {"machine_code": "m25", "sequence": 1, "price": 25_000_000},
        {"machine_code": "m50", "sequence": 2, "price": 50_000_000},
        {"machine_code": "m50", "sequence": 3, "price": 50_000_000}]
    # the creator reserved the total
    assert c.get("/users/me/balance", headers=hdrs).json() == {"reserved": 125_000_000, "locked_royale": 0}


def test_create_multipack_rejects_over_ten_boxes(client_priv, monkeypatch):
    c, priv = client_priv

    async def _high_balance(*args, **kwargs):
        return 1_000_000_000

    async def _machines():
        return [{"code": "m25", "price": 25, "available": True}]

    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_balance)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())
    hdrs = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    r = c.post("/pack-battles", json={"max_players": 2, "packs": [{"machine_code": "m25", "count": 11}]},
               headers=hdrs)
    assert r.status_code == 422, r.text


def test_create_legacy_single_machine_still_works(client_priv, monkeypatch):
    c, priv = client_priv

    async def _high_balance(*args, **kwargs):
        return 1_000_000_000

    async def _machines():
        return [{"code": "m50", "price": 50, "available": True}]

    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_balance)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())
    hdrs = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    r = c.post("/pack-battles", json={"machine_code": "m50", "max_players": 2}, headers=hdrs)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["price"] == 50_000_000
    assert body["packs"] == [{"machine_code": "m50", "sequence": 1, "price": 50_000_000}]


# ── A1: /pack-battles/{id}/join-bot must be disabled outside dev ───────────────

def test_join_bot_disabled_by_default():
    """SECURITY (A1): the unauthenticated, fund-moving join-bot endpoint must 404
    when DEV_ENDPOINTS_ENABLED is off (the default), so it cannot be reached in prod.
    The gate runs before the battle lookup, so the 404 detail is "Not Found" (not "no existe")."""
    c, _priv = _build_client()  # dev_endpoints_enabled=False by default
    r = c.post("/pack-battles/whatever-id/join-bot")
    assert r.status_code == 404
    assert r.json()["detail"] == "Not Found"


def test_join_bot_enabled_passes_gate_in_dev():
    """With DEV_ENDPOINTS_ENABLED on, the gate is open: the handler proceeds to the
    battle lookup. A nonexistent battle then yields 404 "no existe" — proving the
    request got PAST the dev gate (different detail than the disabled case)."""
    c, _priv = _build_client(dev_endpoints_enabled=True)
    r = c.post("/pack-battles/nonexistent/join-bot")
    assert r.status_code == 404
    assert r.json()["detail"] == "no existe"


# ── A2: /users/me/withdraw anti-drain (minimum amount + per-wallet rate limit) ─

def test_withdraw_below_minimum_rejected():
    """SECURITY (A2): a sub-minimum withdrawal is rejected (422) BEFORE any on-chain
    work, so an attacker can't flood 1-base-unit withdrawals to fresh addresses and
    drain the operator-paid destination-ATA rent. Default minimum is 1.0 USDC."""
    c, priv = _build_client(signer=object())  # truthy signer passes the 503 gate
    hdrs = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    r = c.post("/users/me/withdraw", json={"address": WALLET_B, "amount": 0.000001}, headers=hdrs)
    assert r.status_code == 422, r.text
    assert "mínimo" in r.json()["detail"]


def test_withdraw_rate_limited(monkeypatch):
    """SECURITY (A2): withdrawals are rate-limited per wallet. With the default limit of 5
    per window, the 6th withdrawal is throttled (429) — the throttle fires before the
    on-chain transfer, capping how fast the operator's gas/rent can be spent."""
    c, priv = _build_client(signer=object())

    async def _high_balance(*a, **k):
        return 1_000_000_000  # plenty so _require_available always passes

    async def _bh(*a, **k):
        return "11111111111111111111111111111111"

    async def _wd(*a, **k):
        return "sig-stub"

    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_balance)
    monkeypatch.setattr("app.main.fetch_latest_blockhash", _bh)
    monkeypatch.setattr("app.main.withdraw_usdc", _wd)

    hdrs = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    body = {"address": WALLET_B, "amount": 1.0}  # at/above the minimum

    for i in range(5):
        r = c.post("/users/me/withdraw", json=body, headers=hdrs)
        assert r.status_code == 200, f"call {i}: {r.text}"

    r = c.post("/users/me/withdraw", json=body, headers=hdrs)
    assert r.status_code == 429, r.text
