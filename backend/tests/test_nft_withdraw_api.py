"""Tests for POST /users/me/nft/withdraw — send an embedded-wallet NFT to an external address.

Mirrors test_pack_lobby_api.py scaffolding:
- In-memory SQLite DB
- Fake Privy with a key_resolver (no network)
- TestClient + Authorization: Bearer <token>
- A fake signer whose sign_solana records the wallet_id it is asked to sign with

The on-chain helpers (nft_in_owner / build_transfer / submit_signed_tx / fetch_latest_blockhash)
are monkeypatched so no RPC call is made.
"""
from __future__ import annotations

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

WALLET_A = "So1anaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1"
WALLET_ID_A = "wallet-id-aaa"
DEST = "So1anaDESTBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1"
MINT = "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr"

DUMMY_RPC = "https://api.devnet.solana.com"
DUMMY_MINT = "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr"


def _make_es256():
    return ec.generate_private_key(ec.SECP256R1())


def _solana_embedded_with_id(addr: str, wallet_id: str) -> dict:
    return {
        "type": "wallet", "chain_type": "solana", "connector_type": None,
        "wallet_client_type": "privy", "address": addr, "id": wallet_id,
    }


def _make_token(priv, app_id: str, addr: str, wallet_id: str) -> str:
    now = int(time.time())
    payload = {
        "aud": app_id, "iss": "privy.io", "sub": f"did:privy:{addr[:8]}",
        "iat": now, "exp": now + 3600,
        "linked_accounts": json.dumps([_solana_embedded_with_id(addr, wallet_id)]),
    }
    return jwt.encode(payload, priv, algorithm="ES256", headers={"kid": "test-kid", "alg": "ES256"})


def _auth_headers(priv, addr: str, wallet_id: str) -> dict:
    return {"Authorization": f"Bearer {_make_token(priv, APP_ID, addr, wallet_id)}"}


class FakeSigner:
    """Records the (wallet_id, tx) pairs it is asked to sign; returns a deterministic signed blob."""
    def __init__(self):
        self.signed: list[tuple[str, str]] = []

    async def sign_solana(self, wallet_id: str, tx: str) -> str:
        self.signed.append((wallet_id, tx))
        return f"signed::{tx}"


def _build_client(signer=None):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    init_db(engine)
    sf = make_session_factory(engine)
    priv = _make_es256()
    privy = PrivyVerifier(app_id=APP_ID, key_resolver=lambda kid: priv.public_key())
    gacha = GachaService(base_url="https://dev-gacha.example.com", api_key="")
    app = create_app(
        sf, MockChainSource(), gacha=gacha, privy=privy, privy_signer=signer,
        solana_rpc_url=DUMMY_RPC, cc_usdc_mint=DUMMY_MINT,
        privy_operator_wallet_id="op-wallet-id",
        privy_operator_address="So1anaOPERATOR1111111111111111111111111111",
        escrow_seed_lamports=10_000_000,
    )
    return TestClient(app, raise_server_exceptions=True), priv


def _mock_chain(monkeypatch, *, owns: bool):
    calls = {"nft_in_owner": [], "build_transfer": [], "submit": []}

    async def _nft_in_owner(rpc_url, owner, mint):
        calls["nft_in_owner"].append((rpc_url, owner, mint))
        return owns

    async def _build_transfer(rpc_url, escrow, winner, mint, blockhash, *, fee_payer=None):
        calls["build_transfer"].append((escrow, winner, mint, fee_payer))
        return "TXBYTES"

    async def _submit(rpc_url, signed):
        calls["submit"].append(signed)
        return "on-chain-sig"

    async def _bh(rpc_url):
        return "11111111111111111111111111111111"

    monkeypatch.setattr("app.main.nft_in_owner", _nft_in_owner)
    monkeypatch.setattr("app.main.build_transfer", _build_transfer)
    monkeypatch.setattr("app.main.submit_signed_tx", _submit)
    monkeypatch.setattr("app.main.fetch_latest_blockhash", _bh)
    return calls


OPERATOR = "So1anaOPERATOR1111111111111111111111111111"


def test_nft_withdraw_transfers_owned_nft(monkeypatch):
    """Owned NFT → 200; owner authorizes, OPERATOR sponsors (fee-payer + 2nd signer)."""
    signer = FakeSigner()
    c, priv = _build_client(signer=signer)   # operator configured → sponsored path
    calls = _mock_chain(monkeypatch, owns=True)

    hdrs = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    r = c.post("/users/me/nft/withdraw", json={"nft_address": MINT, "address": DEST}, headers=hdrs)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body == {"signature": "on-chain-sig", "nft_address": MINT, "address": DEST}
    # ownership was checked for the authed wallet + this mint
    assert calls["nft_in_owner"] == [(DUMMY_RPC, WALLET_A, MINT)]
    # transfer built owner→dest with the OPERATOR as fee-payer (user needs no SOL)
    assert calls["build_transfer"] == [(WALLET_A, DEST, MINT, OPERATOR)]
    # 2-signer: the OWNER authorizes first, then the OPERATOR pays the fee
    assert signer.signed == [(WALLET_ID_A, "TXBYTES"), ("op-wallet-id", "signed::TXBYTES")]
    assert calls["submit"] == ["signed::signed::TXBYTES"]


def test_nft_withdraw_rejects_unowned_nft(monkeypatch):
    """A mint the wallet does NOT hold → 403, and nothing is signed or submitted."""
    signer = FakeSigner()
    c, priv = _build_client(signer=signer)
    calls = _mock_chain(monkeypatch, owns=False)

    hdrs = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    r = c.post("/users/me/nft/withdraw", json={"nft_address": MINT, "address": DEST}, headers=hdrs)
    assert r.status_code == 403, r.text
    assert signer.signed == []           # never signed
    assert calls["build_transfer"] == []  # never built
    assert calls["submit"] == []          # never submitted


def test_nft_withdraw_requires_auth():
    """No identity token → 401 (before any on-chain work)."""
    c, _priv = _build_client(signer=FakeSigner())
    r = c.post("/users/me/nft/withdraw", json={"nft_address": MINT, "address": DEST})
    assert r.status_code == 401, r.text


def test_nft_withdraw_503_without_signer():
    """Signer not configured → 503 withdrawals_unavailable."""
    c, priv = _build_client(signer=None)
    hdrs = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    r = c.post("/users/me/nft/withdraw", json={"nft_address": MINT, "address": DEST}, headers=hdrs)
    assert r.status_code == 503, r.text


def test_nft_withdraw_rejects_bad_address():
    """Non-base58 destination → 422 (pydantic validation, no on-chain work)."""
    c, priv = _build_client(signer=FakeSigner())
    hdrs = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    r = c.post("/users/me/nft/withdraw", json={"nft_address": MINT, "address": "not-an-address!"}, headers=hdrs)
    assert r.status_code == 422, r.text
