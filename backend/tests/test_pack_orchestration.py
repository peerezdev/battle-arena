"""Tests for app/services/pack_orchestration.py.

Uses respx to mock the Solana JSON-RPC endpoint and in-memory SQLite for the DB.
The fake _Gacha and _Signer are minimal copies of the style used in test_pack_engine.py,
but _Signer uses real base58 pubkeys so build_nft_transfer can derive ATAs.
"""
import json

import pytest
import respx
import httpx

from app.db import Base, make_engine, make_session_factory, init_db
from app.models import PackBattle, BattlePlayer
from app.services.pack_orchestration import (
    fetch_latest_blockhash,
    usdc_balance_base_units,
    run_pack_battle_live,
)
from app.services.solana_tx import TOKEN_PROGRAM

# ---------------------------------------------------------------------------
# Constants — valid devnet-style pubkeys so solders accepts them everywhere
# ---------------------------------------------------------------------------

RPC_URL = "http://rpc.test.invalid"

# Escrow wallet: returned by _Signer.create_solana_wallet
ESCROW_ADDRESS = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
ESCROW_WALLET_ID = "privy-esc-id-001"

# Two player wallets
WALLET_A = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
WALLET_B = "So11111111111111111111111111111111111111112"
WALLET_ID_A = "privy-wallet-id-A"
WALLET_ID_B = "privy-wallet-id-B"

# NFT mints returned by the fake gacha (must be valid pubkeys)
NFT_A = "7i5KKsX2weiTkry7jA4ZwSuXGhs5eJBEjY8vVxR4pfRx"
NFT_B = "11111111111111111111111111111112"

# USDC mint used for balance checks (any valid pubkey)
USDC_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"

# A valid base58 blockhash (32-byte hash, base58-encoded)
BLOCKHASH = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi"

# Operator wallet (valid base58 pubkey)
OPERATOR_ADDRESS = "So11111111111111111111111111111111111111111"
OPERATOR_WALLET_ID = "privy-operator-id"
SEED_LAMPORTS = 10_000_000

# Pre-computed ATAs for WALLET_A and WALLET_B against USDC_MINT
# (solders.token.associated.get_associated_token_address(owner, USDC_MINT, TOKEN_PROGRAM))
# These are used by the side_effect handler to route per-owner balance responses.
from solders.pubkey import Pubkey
from solders.token.associated import get_associated_token_address as _gata

_prog = Pubkey.from_string(TOKEN_PROGRAM)
_usdc = Pubkey.from_string(USDC_MINT)
ATA_A = str(_gata(Pubkey.from_string(WALLET_A), _usdc, _prog))
ATA_B = str(_gata(Pubkey.from_string(WALLET_B), _usdc, _prog))


# ---------------------------------------------------------------------------
# Shared DB session fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def session():
    engine = make_engine("sqlite:///:memory:")
    init_db(engine)
    Session = make_session_factory(engine)
    with Session() as s:
        yield s


# ---------------------------------------------------------------------------
# Minimal fakes: _Gacha and _Signer (mirroring test_pack_engine.py style)
# ---------------------------------------------------------------------------

class _Gacha:
    """Fake gacha: generate_pack returns a dummy tx; open_pack returns the
    configured outcome dict for each wallet.  NFT addresses must be real pubkeys."""

    def __init__(self, opens: dict):
        # opens: {player_wallet: {"nft_address": ..., "insured_value": ..., "grade": ...}}
        self.opens = opens
        self.alt = None
        self.pulled: list[str] = []

    async def generate_pack(self, player_address: str, pack_type: str,
                            alt_player_address=None, turbo=False) -> dict:
        self.alt = alt_player_address
        self.pulled.append(player_address)
        return {"memo": f"m-{player_address}", "transaction": f"tx-{player_address}"}

    async def open_pack(self, memo: str) -> dict:
        wallet = memo[len("m-"):]
        return {"pending": False, **self.opens[wallet]}

    async def submit_tx(self, signed_transaction):
        return {"signature": "ccsig", "confirmation_status": "confirmed"}


class _Signer:
    """Fake signer: create_solana_wallet returns a REAL base58 address (ESCROW_ADDRESS)
    so that build_nft_transfer can derive ATAs from it without errors."""

    def __init__(self):
        self.sent: list[tuple] = []
        self.signed: list[tuple] = []

    async def create_solana_wallet(self) -> dict:
        return {"id": ESCROW_WALLET_ID, "address": ESCROW_ADDRESS}

    async def sign_solana(self, wallet_id: str, tx: str) -> str:
        self.signed.append((wallet_id, tx)); return f"signed-{tx}"

    async def sign_and_send_solana(self, wallet_id: str, tx: str, sponsor: bool = False) -> str:
        self.sent.append((wallet_id, tx, sponsor))
        return f"sig-{len(self.sent)}"


# ---------------------------------------------------------------------------
# RPC mock helper: a single side_effect that branches on JSON-RPC method
# ---------------------------------------------------------------------------

def _make_rpc_handler(
    blockhash: str = BLOCKHASH,
    balances=None,          # dict[str, int] | None — {ata_address: amount}
    missing_atas=None,      # set[str] | None — ATAs whose response has error/null value
):
    """Returns an httpx side_effect callable for respx that handles both
    getLatestBlockhash and getTokenAccountBalance in a single mock route."""
    _balances = balances or {}
    _missing = missing_atas or set()

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        method = body.get("method")

        if method == "getLatestBlockhash":
            return httpx.Response(200, json={
                "jsonrpc": "2.0", "id": body.get("id", 1),
                "result": {"value": {"blockhash": blockhash}},
            })

        if method == "getTokenAccountBalance":
            ata_str = body["params"][0]
            if ata_str in _missing:
                # Simulate missing account (RPC returns error)
                return httpx.Response(200, json={
                    "jsonrpc": "2.0", "id": body.get("id", 1),
                    "error": {"code": -32602, "message": "Invalid param: could not find account"},
                })
            amount = _balances.get(ata_str, 0)
            return httpx.Response(200, json={
                "jsonrpc": "2.0", "id": body.get("id", 1),
                "result": {"value": {"amount": str(amount), "decimals": 6,
                                     "uiAmount": amount / 1_000_000,
                                     "uiAmountString": str(amount / 1_000_000)}},
            })

        # Fallback — unknown method
        return httpx.Response(400, json={"error": "unknown method"})

    return handler


# ---------------------------------------------------------------------------
# Test 1: fetch_latest_blockhash
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_fetch_latest_blockhash_returns_blockhash():
    handler = _make_rpc_handler(blockhash="AbcDef123BlockHash456")
    with respx.mock:
        respx.post(RPC_URL).mock(side_effect=handler)
        result = await fetch_latest_blockhash(RPC_URL)
    assert result == "AbcDef123BlockHash456"


# ---------------------------------------------------------------------------
# Test 2: usdc_balance_base_units
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_usdc_balance_base_units_returns_amount():
    """Happy path: account exists, balance is returned as an int."""
    handler = _make_rpc_handler(balances={ATA_A: 5_000_000})
    with respx.mock:
        respx.post(RPC_URL).mock(side_effect=handler)
        result = await usdc_balance_base_units(RPC_URL, WALLET_A, USDC_MINT)
    assert result == 5_000_000


@pytest.mark.asyncio
async def test_usdc_balance_base_units_returns_zero_on_rpc_error():
    """When the RPC response contains an 'error' key, return 0."""
    handler = _make_rpc_handler(missing_atas={ATA_A})
    with respx.mock:
        respx.post(RPC_URL).mock(side_effect=handler)
        result = await usdc_balance_base_units(RPC_URL, WALLET_A, USDC_MINT)
    assert result == 0


@pytest.mark.asyncio
async def test_usdc_balance_base_units_returns_zero_on_null_value():
    """When result.value is null (account not initialised), return 0."""
    def null_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "jsonrpc": "2.0", "id": 1,
            "result": {"value": None},
        })

    with respx.mock:
        respx.post(RPC_URL).mock(side_effect=null_handler)
        result = await usdc_balance_base_units(RPC_URL, WALLET_A, USDC_MINT)
    assert result == 0


# ---------------------------------------------------------------------------
# Test 3: run_pack_battle_live — happy path (both players funded)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_run_pack_battle_live_happy_path(session, monkeypatch):
    """Both players have sufficient USDC → battle settles, escrow NFTs transferred
    to winner via the async transfer dispatcher (build_transfer / submit_signed_tx
    are monkeypatched so no real RPC calls are needed for settle)."""
    import app.services.pack_orchestration as po

    # Stub build_transfer and submit_signed_tx in the pack_orchestration module
    calls = {"build": [], "submit": [], "seed": []}

    async def fake_build(rpc, esc, dest, mint, bh):
        calls["build"].append((esc, dest, mint))
        return f"tx-{mint}"

    async def fake_submit(rpc, signed):
        calls["submit"].append(signed)
        return "sig"

    async def fake_nft_in_owner(rpc, owner, mint):
        return True

    async def fake_seed_escrow(rpc_url, signer, operator_wallet_id, operator_address,
                               escrow_address, lamports, blockhash):
        calls["seed"].append(escrow_address)
        return "seed-sig"

    monkeypatch.setattr(po, "build_transfer", fake_build)
    monkeypatch.setattr(po, "submit_signed_tx", fake_submit)
    monkeypatch.setattr(po, "nft_in_owner", fake_nft_in_owner)
    monkeypatch.setattr(po, "seed_escrow", fake_seed_escrow)

    b = PackBattle(id="b-live-1", mode="pack", machine_code="pokemon_50",
                   price=50, max_players=2, status="running")
    session.add(b)
    session.add_all([
        BattlePlayer(battle_id="b-live-1", player_wallet=WALLET_A, wallet_id=WALLET_ID_A),
        BattlePlayer(battle_id="b-live-1", player_wallet=WALLET_B, wallet_id=WALLET_ID_B),
    ])
    session.commit()

    gacha = _Gacha({
        WALLET_A: {"nft_address": NFT_A, "insured_value": 100.0, "grade": 9},
        WALLET_B: {"nft_address": NFT_B, "insured_value": 300.0, "grade": 8},
    })
    signer = _Signer()

    # Both players have 10 USDC (10_000_000 base units); min is 1_000_000 (1 USDC)
    handler = _make_rpc_handler(
        blockhash=BLOCKHASH,
        balances={ATA_A: 10_000_000, ATA_B: 10_000_000},
    )

    with respx.mock:
        respx.post(RPC_URL).mock(side_effect=handler)
        result = await run_pack_battle_live(
            session, b,
            gacha=gacha,
            signer=signer,
            rpc_url=RPC_URL,
            usdc_mint=USDC_MINT,
            min_usdc_base_units=1_000_000,
            token_program=TOKEN_PROGRAM,
            sponsor=False,
            operator_wallet_id=OPERATOR_WALLET_ID,
            operator_address=OPERATOR_ADDRESS,
            seed_lamports=SEED_LAMPORTS,
        )

    assert result == "settled"
    assert b.status == "settled"
    # WALLET_B wins (higher insured_value=300 > 100)
    assert b.winner == WALLET_B
    assert b.escrow_address == ESCROW_ADDRESS
    assert b.escrow_wallet_id == ESCROW_WALLET_ID

    # Gacha received escrow address as alt_player_address
    assert gacha.alt == ESCROW_ADDRESS

    # resolve_wallet_id maps wallets to their privy wallet IDs from DB (pulls use sign_solana)
    privy_ids_used = {s[0] for s in signer.signed}
    assert WALLET_ID_A in privy_ids_used
    assert WALLET_ID_B in privy_ids_used

    # The transfer dispatcher was called once per NFT (both NFTs → winner WALLET_B)
    assert len(calls["build"]) == 2
    build_mints = {t[2] for t in calls["build"]}
    assert NFT_A in build_mints
    assert NFT_B in build_mints

    # submit_signed_tx was called once for the escrow USDC ATA pre-create
    # (operator-signed) and once per NFT settle transfer — 3 total.
    assert len(calls["submit"]) == 3
    # The two NFT-settle submits receive "signed-tx-<mint>"
    nft_submits = [s for s in calls["submit"] if s.startswith("signed-tx-")]
    assert len(nft_submits) == 2

    # seed_escrow was called with the escrow address
    assert calls["seed"] == [ESCROW_ADDRESS]


# ---------------------------------------------------------------------------
# Test 4: run_pack_battle_live — void path (one player under-funded)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_run_pack_battle_live_void_when_player_underfunded(session, monkeypatch):
    """WALLET_B has 0 USDC balance → can_play(WALLET_B) == False →
    run_battle voids immediately, no escrow created, no sign calls."""
    import app.services.pack_orchestration as po

    async def fake_seed_escrow(rpc_url, signer, operator_wallet_id, operator_address,
                               escrow_address, lamports, blockhash):
        return "seed-sig"

    monkeypatch.setattr(po, "seed_escrow", fake_seed_escrow)

    b = PackBattle(id="b-live-void", mode="pack", machine_code="pokemon_50",
                   price=50, max_players=2, status="running")
    session.add(b)
    session.add_all([
        BattlePlayer(battle_id="b-live-void", player_wallet=WALLET_A, wallet_id=WALLET_ID_A),
        BattlePlayer(battle_id="b-live-void", player_wallet=WALLET_B, wallet_id=WALLET_ID_B),
    ])
    session.commit()

    gacha = _Gacha({
        WALLET_A: {"nft_address": NFT_A, "insured_value": 100.0, "grade": 9},
        WALLET_B: {"nft_address": NFT_B, "insured_value": 300.0, "grade": 8},
    })
    signer = _Signer()

    # WALLET_A funded, WALLET_B has 0 (ATA missing → error response)
    handler = _make_rpc_handler(
        blockhash=BLOCKHASH,
        balances={ATA_A: 10_000_000},
        missing_atas={ATA_B},
    )

    with respx.mock:
        respx.post(RPC_URL).mock(side_effect=handler)
        result = await run_pack_battle_live(
            session, b,
            gacha=gacha,
            signer=signer,
            rpc_url=RPC_URL,
            usdc_mint=USDC_MINT,
            min_usdc_base_units=1_000_000,  # WALLET_B has 0, fails
            token_program=TOKEN_PROGRAM,
            sponsor=False,
            operator_wallet_id=OPERATOR_WALLET_ID,
            operator_address=OPERATOR_ADDRESS,
            seed_lamports=SEED_LAMPORTS,
        )

    assert result == "voided"
    assert b.status == "voided"
    assert b.winner is None
    assert b.escrow_address is None
    assert signer.sent == []


# ---------------------------------------------------------------------------
# Lightweight fakes for USDC-sweep tests (no DB, no RPC)
# ---------------------------------------------------------------------------

class _FakeBattle:
    id = "b1"; mode = "pack"; machine_code = "pokemon_50"; price = 50
    escrow_wallet_id = "eid"; escrow_address = "ESC"; status = "lobby"

class _FakeSession:
    def __init__(self, players): self._players = players
    def query(self, *a, **k): return self
    def filter_by(self, **k): return self
    def order_by(self, *a, **k): return self
    def all(self): return self._players


# ---------------------------------------------------------------------------
# Test 5: build_usdc_sweep_tx — zero balance returns None
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_build_usdc_sweep_tx_zero_balance_returns_none(monkeypatch):
    import app.services.pack_orchestration as po
    captured = {}
    async def fake_run_battle(session, battle, **kw):
        captured["sweep"] = kw["build_usdc_sweep_tx"]; return "settled"
    monkeypatch.setattr(po, "run_battle", fake_run_battle)
    async def zero_bal(rpc, owner, mint, tp=None): return 0
    monkeypatch.setattr(po, "usdc_balance_base_units", zero_bal)

    await po.run_pack_battle_live(_FakeSession([]), _FakeBattle(), gacha=None, signer=None,
        rpc_url="http://x", usdc_mint="Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr",
        min_usdc_base_units=0)
    assert await captured["sweep"]("ESC", "WIN") is None     # 0 balance → None


# ---------------------------------------------------------------------------
# Test 6: build_usdc_sweep_tx — positive balance builds a tx
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_build_usdc_sweep_tx_positive_balance_builds_tx(monkeypatch):
    import app.services.pack_orchestration as po
    captured = {}
    async def fake_run_battle(session, battle, **kw):
        captured["sweep"] = kw["build_usdc_sweep_tx"]; return "settled"
    monkeypatch.setattr(po, "run_battle", fake_run_battle)
    async def bal(rpc, owner, mint, tp=None): return 42_500_000
    async def bh(rpc): return "11111111111111111111111111111111"
    monkeypatch.setattr(po, "usdc_balance_base_units", bal)
    monkeypatch.setattr(po, "fetch_latest_blockhash", bh)

    await po.run_pack_battle_live(_FakeSession([]), _FakeBattle(), gacha=None, signer=None,
        rpc_url="http://x", usdc_mint="Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr",
        min_usdc_base_units=0)
    out = await captured["sweep"]("9oZgd4eviozqaYu7KwCTctAYgsRTWtF3McJARaztPsRQ",
                                  "8QDBKx8P3pxkRhiqyXFtYcPPf2CM1F5NiE5A8yjkgtm6")
    assert isinstance(out, str) and len(out) > 0             # built a tx


# ---------------------------------------------------------------------------
# Test 7: run_pack_battle_live — void result triggers refund_pack_void
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_run_pack_battle_live_invokes_refund_on_void(session, monkeypatch):
    """A 'voided' result from run_battle triggers refund_pack_void with the live closures."""
    import app.services.pack_orchestration as po
    from app.models import PackBattle, BattlePlayer
    b = PackBattle(id="b-void-refund", mode="pack", machine_code="pokemon_50", price=50,
                   max_players=2, status="lobby", escrow_wallet_id="eid", escrow_address="ESC")
    session.add(b)
    session.add_all([BattlePlayer(battle_id="b-void-refund", player_wallet=WALLET_A, wallet_id=WALLET_ID_A),
                     BattlePlayer(battle_id="b-void-refund", player_wallet=WALLET_B, wallet_id=WALLET_ID_B)])
    session.commit()

    called = {}
    async def _fake_run(session, battle, **kwargs):
        return "voided"
    async def _fake_refund(session, battle, **kwargs):
        called["escrow_address"] = kwargs.get("escrow_address")
        called["has_usdc_closure"] = kwargs.get("build_usdc_transfer_tx") is not None
    monkeypatch.setattr(po, "run_battle", _fake_run)
    monkeypatch.setattr(po, "refund_pack_void", _fake_refund)
    async def _bal(*a, **k): return 0
    monkeypatch.setattr(po, "usdc_balance_base_units", _bal)

    out = await po.run_pack_battle_live(session, b, gacha=None, signer=None, rpc_url="x",
        usdc_mint="Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr", min_usdc_base_units=0)
    assert out == "voided"
    assert called.get("escrow_address") == "ESC"
    assert called.get("has_usdc_closure") is True


@pytest.mark.asyncio
async def test_run_pack_battle_live_no_refund_on_settled(session, monkeypatch):
    import app.services.pack_orchestration as po
    from app.models import PackBattle, BattlePlayer
    b = PackBattle(id="b-settled", mode="pack", machine_code="pokemon_50", price=50,
                   max_players=2, status="lobby")
    session.add(b)
    session.add(BattlePlayer(battle_id="b-settled", player_wallet=WALLET_A, wallet_id=WALLET_ID_A))
    session.commit()
    refunded = []
    async def _fake_run(session, battle, **kwargs): return "settled"
    async def _fake_refund(session, battle, **kwargs): refunded.append(battle.id)
    monkeypatch.setattr(po, "run_battle", _fake_run)
    monkeypatch.setattr(po, "refund_pack_void", _fake_refund)
    async def _bal(*a, **k): return 0
    monkeypatch.setattr(po, "usdc_balance_base_units", _bal)
    out = await po.run_pack_battle_live(session, b, gacha=None, signer=None, rpc_url="x",
        usdc_mint="Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr", min_usdc_base_units=0)
    assert out == "settled" and refunded == []   # no refund on settle
