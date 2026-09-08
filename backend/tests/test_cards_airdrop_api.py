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
from tests.test_chain_mock import MockChainSource

APP_ID = "testapp"
WALLET = "8QDBKx8P3pxkRhiqyXFtYcPPf2CM1F5NiE5A8yjkgtm6"
WALLET_ID = "wallet-id-aaa"
AJENA = "FzRt4Pnh6tBpavXqkwQH1WVByeotDSefyyACKXC5kGHZ"
DISTRIBUTOR = "H6k7zSjCn2w5Q4em3b3E7iaPQfLrxVsF6u1bK6kD1Bhq"
VAULT = "5TBR7KQHbPsf3wHZ11dyL9iifztCnN9Ccr6rzoCvYqW7"
MINT = "CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp"
OPERADOR = "3q6Ucr1s7Knkp5nRQKQe3dYPzoh72XQGnn2oCgSS9S34"
PROOF = ["9Ad5fSi8QPvs8CimVj8vFwSXJkkZ5fgvnhmefmr6QEKv"]

ASIGNACIONES = {WALLET: {"i": 1687, "a": 1_483_000_000, "p": PROOF}}


def _headers(priv, addr=WALLET, wallet_id=WALLET_ID):
    now = int(time.time())
    cuenta = {"type": "wallet", "chain_type": "solana", "connector_type": None,
              "wallet_client_type": "privy", "address": addr, "id": wallet_id}
    payload = {"aud": APP_ID, "iss": "privy.io", "sub": f"did:privy:{addr[:8]}",
               "iat": now, "exp": now + 3600, "linked_accounts": json.dumps([cuenta])}
    tok = jwt.encode(payload, priv, algorithm="ES256", headers={"kid": "test-kid", "alg": "ES256"})
    return {"Authorization": f"Bearer {tok}"}


class FakeSigner:
    """Firma sin red y recuerda con qué wallet_id se le pidió cada firma."""
    def __init__(self):
        self.firmas: list[tuple[str, str]] = []
        self.enabled = True

    async def sign_solana(self, wallet_id: str, tx: str) -> str:
        self.firmas.append((wallet_id, tx))
        return f"signed::{tx}"

    async def podemos_firmar(self, wallet_id: str) -> bool:
        return True


class FakePrivy:
    def __init__(self, priv):
        self._pub = priv.public_key()

    def embedded_solana_wallet(self, token: str) -> str:
        import jwt as _jwt
        d = _jwt.decode(token, self._pub, algorithms=["ES256"], audience=APP_ID)
        return json.loads(d["linked_accounts"])[0]["address"]

    def embedded_solana_wallet_id(self, token: str) -> str:
        import jwt as _jwt
        d = _jwt.decode(token, self._pub, algorithms=["ES256"], audience=APP_ID)
        return json.loads(d["linked_accounts"])[0]["id"]


def _cliente(**over):
    priv = ec.generate_private_key(ec.SECP256R1())
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    init_db(engine)
    sf = make_session_factory(engine)
    kwargs = dict(
        privy=FakePrivy(priv), privy_signer=FakeSigner(),
        privy_operator_wallet_id="op-wallet-id", privy_operator_address=OPERADOR,
        cards_airdrop=dict(ASIGNACIONES),
        cards_airdrop_distributor=DISTRIBUTOR, cards_airdrop_vault=VAULT,
        cards_airdrop_mint=MINT, cards_airdrop_round="2026-09",
        solana_rpc_url="https://api.devnet.solana.com",
    )
    kwargs.update(over)
    app = create_app(sf, MockChainSource(), **kwargs)
    return TestClient(app), priv, kwargs


@pytest.fixture
def sin_pda(monkeypatch):
    """Por defecto, la cuenta de ClaimStatus no existe: nadie ha reclamado."""
    async def _cuenta(rpc_url, pubkey, **kw):
        return None
    monkeypatch.setattr("app.main._airdrop_cuenta", _cuenta)
    return _cuenta


def test_elegible_sin_reclamar(sin_pda):
    c, priv, _ = _cliente()
    r = c.get("/users/me/airdrop/cards", headers=_headers(priv))
    assert r.status_code == 200
    assert r.json() == {"eligible": True, "amount": 1_483_000_000,
                        "claimed": False, "signature": None}


def test_no_elegible(sin_pda):
    c, priv, _ = _cliente()
    r = c.get("/users/me/airdrop/cards", headers=_headers(priv, addr=AJENA, wallet_id="otro"))
    assert r.status_code == 200
    assert r.json()["eligible"] is False


def test_ya_reclamado_lo_dice_la_cadena(monkeypatch):
    async def _cuenta(rpc_url, pubkey, **kw):
        return {"lamports": 1}
    monkeypatch.setattr("app.main._airdrop_cuenta", _cuenta)
    c, priv, _ = _cliente()
    r = c.get("/users/me/airdrop/cards", headers=_headers(priv))
    assert r.json()["claimed"] is True


def test_sin_fichero_es_503_y_no_no_elegible(sin_pda):
    # La distinción importa: decirle "no eres elegible" a alguien que sí lo es por una
    # avería nuestra es el peor fallo posible aquí.
    c, priv, _ = _cliente(cards_airdrop={})
    r = c.get("/users/me/airdrop/cards", headers=_headers(priv))
    assert r.status_code == 503


def test_sin_operador_es_503(sin_pda):
    c, priv, _ = _cliente(privy_operator_wallet_id="", privy_operator_address="")
    r = c.get("/users/me/airdrop/cards", headers=_headers(priv))
    assert r.status_code == 503


def test_si_el_rpc_falla_es_502_y_no_no_elegible(monkeypatch):
    async def _cuenta(rpc_url, pubkey, **kw):
        raise RuntimeError("rpc caído")
    monkeypatch.setattr("app.main._airdrop_cuenta", _cuenta)
    c, priv, _ = _cliente()
    r = c.get("/users/me/airdrop/cards", headers=_headers(priv))
    assert r.status_code == 502
