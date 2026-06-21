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


def _build_client():
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
        solana_rpc_url=DUMMY_RPC,
        cc_usdc_mint=DUMMY_MINT,
        privy_operator_wallet_id="op-wallet-id",
        privy_operator_address="So1anaOPERATOR1111111111111111111111111111",
        escrow_seed_lamports=10_000_000,
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
