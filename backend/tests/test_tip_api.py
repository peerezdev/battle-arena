import json
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from app.db import init_db, make_session_factory
from app.main import create_app
from app.models import Tip, User
from app.services.gacha import GachaService
from tests.test_chain_mock import MockChainSource

APP_ID = "testapp"
WALLET_A = "So1anaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1"
WALLET_ID_A = "wallet-id-aaa"
WALLET_B = "So1anaBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1"
DUMMY_RPC = "https://api.devnet.solana.com"
DUMMY_MINT = "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr"


def _solana_embedded_with_id(addr: str, wallet_id: str) -> dict:
    return {"type": "wallet", "chain_type": "solana", "connector_type": None,
            "wallet_client_type": "privy", "address": addr, "id": wallet_id}


def _auth_headers(priv, addr: str, wallet_id: str) -> dict:
    now = int(time.time())
    payload = {"aud": APP_ID, "iss": "privy.io", "sub": f"did:privy:{addr[:8]}",
               "iat": now, "exp": now + 3600,
               "linked_accounts": json.dumps([_solana_embedded_with_id(addr, wallet_id)])}
    token = jwt.encode(payload, priv, algorithm="ES256", headers={"kid": "test-kid", "alg": "ES256"})
    return {"Authorization": f"Bearer {token}"}


class FakeSigner:
    def __init__(self):
        self.signed: list[tuple[str, str]] = []

    async def sign_solana(self, wallet_id: str, tx: str) -> str:
        self.signed.append((wallet_id, tx))
        return f"signed::{tx}"


def _build_client(**overrides):
    from app.privy import PrivyVerifier
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    init_db(engine)
    sf = make_session_factory(engine)
    priv = ec.generate_private_key(ec.SECP256R1())
    privy = PrivyVerifier(app_id=APP_ID, key_resolver=lambda kid: priv.public_key())
    kwargs = dict(gacha=GachaService(base_url="https://dev-gacha.example.com", api_key=""),
                  privy=privy, privy_signer=FakeSigner(), solana_rpc_url=DUMMY_RPC,
                  cc_usdc_mint=DUMMY_MINT, privy_operator_wallet_id="op-wallet-id",
                  privy_operator_address="So1anaOPERATOR1111111111111111111111111111")
    kwargs.update(overrides)
    app = create_app(sf, MockChainSource(), **kwargs)
    client = TestClient(app, raise_server_exceptions=True)
    client.session_factory = sf
    return client, priv


def _mock_money(monkeypatch, *, balance: int = 100_000_000):
    """Saldo on-chain alto y transferencia falsa: el tip no toca la red en los tests."""
    async def _bal(rpc_url, wallet, mint, *a, **k):
        return balance
    monkeypatch.setattr("app.main.usdc_balance_base_units", _bal)

    async def _bh(rpc_url):
        return "11111111111111111111111111111111"
    monkeypatch.setattr("app.main.fetch_latest_blockhash", _bh)

    sent = []

    async def _withdraw(rpc_url, signer, wid, addr, op_wid, op_addr, dest, mint, amount, bh):
        sent.append({"from": addr, "to": dest, "amount": amount})
        return "tx-signature-1"
    monkeypatch.setattr("app.main.withdraw_usdc", _withdraw)
    return sent


def _register(client, wallet: str):
    """Da de alta al jugador: el destinatario tiene que existir para poder recibir un tip."""
    from app.services.users import get_or_create_user
    s = client.session_factory()
    get_or_create_user(s, wallet, 1200)
    s.commit()
    s.close()


def test_tip_moves_usdc_and_records_the_row(monkeypatch):
    client, priv = _build_client()
    sent = _mock_money(monkeypatch)
    _register(client, WALLET_A)
    _register(client, WALLET_B)

    resp = client.post("/users/me/tip", json={"to": WALLET_B, "amount": 1.5, "source": "profile"},
                       headers=_auth_headers(priv, WALLET_A, WALLET_ID_A))

    assert resp.status_code == 200, resp.text
    assert resp.json()["signature"] == "tx-signature-1"
    # el dinero va de A a B, en unidades base
    assert sent == [{"from": WALLET_A, "to": WALLET_B, "amount": 1_500_000}]
    # y queda registrado
    s = client.session_factory()
    row = s.query(Tip).one()
    assert (row.from_wallet, row.to_wallet, row.amount) == (WALLET_A, WALLET_B, 1_500_000)
    assert row.signature == "tx-signature-1"
    assert row.source == "profile"


def test_tip_to_someone_without_an_account_is_rejected(monkeypatch):
    client, priv = _build_client()
    sent = _mock_money(monkeypatch)
    _register(client, WALLET_A)      # B NO está registrado: es el agujero que cerramos
    resp = client.post("/users/me/tip", json={"to": WALLET_B, "amount": 1.5},
                       headers=_auth_headers(priv, WALLET_A, WALLET_ID_A))
    assert resp.status_code == 404
    # el detalle distingue este 404 (destinatario sin cuenta) de un 404 de ruta inexistente,
    # que es lo único que "status_code == 404" a secas no podría distinguir
    assert resp.json()["detail"] == "that player does not have an account"
    # lo que de verdad importa: no salió ni un base unit
    assert sent == []
    s = client.session_factory()
    assert s.query(Tip).count() == 0


def test_tip_to_yourself_is_rejected(monkeypatch):
    client, priv = _build_client()
    _mock_money(monkeypatch)
    _register(client, WALLET_A)
    resp = client.post("/users/me/tip", json={"to": WALLET_A, "amount": 1.5},
                       headers=_auth_headers(priv, WALLET_A, WALLET_ID_A))
    assert resp.status_code == 422


def test_tip_below_the_minimum_is_rejected(monkeypatch):
    client, priv = _build_client()
    _mock_money(monkeypatch)
    _register(client, WALLET_A)
    _register(client, WALLET_B)
    resp = client.post("/users/me/tip", json={"to": WALLET_B, "amount": 0.5},
                       headers=_auth_headers(priv, WALLET_A, WALLET_ID_A))
    assert resp.status_code == 422
    assert "1.0" in resp.json()["detail"]


def test_tip_with_nan_amount_is_rejected(monkeypatch):
    client, priv = _build_client()
    _mock_money(monkeypatch)
    _register(client, WALLET_A)
    _register(client, WALLET_B)
    headers = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    headers["Content-Type"] = "application/json"
    # json.dumps(float("nan")) también emite el literal NaN (no es JSON estricto, pero Python lo
    # acepta por defecto); se manda crudo con `content=` para no depender de cómo serialice el
    # cliente de test y comprobar que de verdad llega tal cual.
    body = ('{"to": "%s", "amount": NaN}' % WALLET_B).encode()
    resp = client.post("/users/me/tip", content=body, headers=headers)
    assert resp.status_code == 422, resp.text


def test_tip_with_infinite_amount_is_rejected(monkeypatch):
    client, priv = _build_client()
    _mock_money(monkeypatch)
    _register(client, WALLET_A)
    _register(client, WALLET_B)
    headers = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    headers["Content-Type"] = "application/json"
    body = ('{"to": "%s", "amount": Infinity}' % WALLET_B).encode()
    resp = client.post("/users/me/tip", content=body, headers=headers)
    assert resp.status_code == 422, resp.text


def test_tip_without_signer_is_unavailable(monkeypatch):
    client, priv = _build_client(privy_signer=None)
    _mock_money(monkeypatch)
    _register(client, WALLET_A)
    _register(client, WALLET_B)
    resp = client.post("/users/me/tip", json={"to": WALLET_B, "amount": 1.5},
                       headers=_auth_headers(priv, WALLET_A, WALLET_ID_A))
    assert resp.status_code == 503
