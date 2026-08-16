"""Tests para GET /users/search: el autocompletado de `/tip` en el chat."""
import json
import time
from typing import Optional

import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from app.db import init_db, make_session_factory
from app.main import create_app
from app.services.gacha import GachaService
from app.services.users import get_or_create_user, set_alias
from tests.test_chain_mock import MockChainSource

APP_ID = "testapp"
CALLER = "So1anaCALLERRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR1"
CALLER_ID = "wallet-id-caller"
ANA = "So1anaANAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1"
ANA_ID = "wallet-id-ana"
ANABEL = "So1anaANABELAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1"
BOB = "So1anaBOBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1"
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


def _build_client(**overrides):
    from app.privy import PrivyVerifier
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    init_db(engine)
    sf = make_session_factory(engine)
    priv = ec.generate_private_key(ec.SECP256R1())
    privy = PrivyVerifier(app_id=APP_ID, key_resolver=lambda kid: priv.public_key())
    kwargs = dict(gacha=GachaService(base_url="https://dev-gacha.example.com", api_key=""),
                  privy=privy, solana_rpc_url=DUMMY_RPC, cc_usdc_mint=DUMMY_MINT)
    kwargs.update(overrides)
    app = create_app(sf, MockChainSource(), **kwargs)
    client = TestClient(app, raise_server_exceptions=True)
    client.session_factory = sf
    return client, priv


def _register(client, wallet: str, alias: Optional[str] = None):
    """Da de alta al jugador y, si se pide, le pone alias."""
    s = client.session_factory()
    get_or_create_user(s, wallet, 1200)
    if alias:
        set_alias(s, wallet, alias)
    s.commit()
    s.close()


def test_la_busqueda_exige_sesion():
    client, _ = _build_client()
    resp = client.get("/users/search?q=an")
    assert resp.status_code == 401


def test_devuelve_los_que_empiezan_por_la_consulta():
    client, priv = _build_client()
    _register(client, ANA, "ana")
    _register(client, ANABEL, "anabel")
    _register(client, BOB, "bob")

    r = client.get("/users/search?q=an", headers=_auth_headers(priv, CALLER, CALLER_ID))

    assert r.status_code == 200, r.text
    assert [u["alias"] for u in r.json()] == ["ana", "anabel"]


def test_marca_a_los_conectados():
    """`online` sale de la presencia del chat, no de la base."""
    client, priv = _build_client()
    _register(client, ANA, "ana")
    _register(client, BOB, "bob")
    token = _auth_headers(priv, ANA, ANA_ID)["Authorization"].split(" ", 1)[1]

    with client.websocket_connect(f"/ws/chat?token={token}") as ws:
        ws.receive_json()  # history
        ws.receive_json()  # drops_history
        ws.receive_json()  # presence

        r = client.get("/users/search", headers=_auth_headers(priv, CALLER, CALLER_ID))

    assert r.status_code == 200, r.text
    by_wallet = {u["wallet"]: u["online"] for u in r.json()}
    assert by_wallet[ANA] is True
    assert by_wallet[BOB] is False
    # los conectados van delante: es a quien la propina llega con alguien delante
    assert r.json()[0]["wallet"] == ANA


def test_el_tope_de_8_se_respeta_aunque_se_pida_mas():
    client, priv = _build_client()
    for i in range(10):
        wallet = f"So1anaUSERNUM{i}AAAAAAAAAAAAAAAAAAAAAAAAAAAAA1"
        _register(client, wallet, f"user{i}")

    r = client.get("/users/search?limit=500", headers=_auth_headers(priv, CALLER, CALLER_ID))

    assert r.status_code == 200, r.text
    assert len(r.json()) <= 8


def test_la_busqueda_tiene_freno():
    """Sin throttle, un bucle contra este endpoint deja el backend mudo."""
    client, priv = _build_client()
    headers = _auth_headers(priv, CALLER, CALLER_ID)
    ultima = None
    for _ in range(30):
        ultima = client.get("/users/search?q=a", headers=headers)
    assert ultima.status_code == 429


def test_search_no_lo_come_la_ruta_de_wallet():
    """/users/{wallet} está declarada antes en el fichero: si el orden se invierte, 'search' se
    interpreta como una wallet y este endpoint deja de existir sin que falle nada más."""
    client, priv = _build_client()
    r = client.get("/users/search?q=an", headers=_auth_headers(priv, CALLER, CALLER_ID))
    assert isinstance(r.json(), list)
