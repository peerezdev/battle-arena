"""Tests para GET /users/search: el autocompletado de `/tip` en el chat."""
import asyncio
import json
import time
from typing import Optional

import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from app.chat import ConnectionManager
from app.db import init_db, make_session_factory
from app.main import create_app
from app.services.gacha import GachaService
from app.services.users import get_or_create_user, set_alias
from tests.test_chain_mock import MockChainSource

APP_ID = "testapp"
CALLER = "So1anaCALLERRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR1"
CALLER_ID = "wallet-id-caller"
ANA = "So1anaANAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1"
ANABEL = "So1anaANABELAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1"
BOB = "So1anaBOBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1"
ZOE = "So1anaZOEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1"
SILENT = "So1anaSILENTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1"
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


def _mock_online(monkeypatch, users: list) -> None:
    """Sustituye la presencia del chat por una lista fija: [{wallet, name}, ...].

    Nada de abrir un WebSocket real para esto. Un socket real obliga a leer del stream con
    `receive_json()`, una llamada SIN plazo (no hay pytest-timeout instalado); si el handler del
    chat deja de mandar el mensaje que el test espera, la lectura no falla, se queda colgada, y un
    test colgado no es un test rojo: es un CI atascado para siempre. Monkeypatchear
    `ConnectionManager.online_users` prueba exactamente lo mismo que le importa a este endpoint
    (de dónde sale `online`) sin ninguna de esas dos cosas.
    """
    monkeypatch.setattr(ConnectionManager, "online_users", lambda self: users)


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


def test_marca_a_los_conectados(monkeypatch):
    """`online` sale de la presencia del chat, no de la base.

    ZOE va conectada y ANA no, y "zoe" ordena DETRÁS de "ana" en el alfabeto a propósito: si el
    test usara un conectado que ya fuera primero por orden alfabético, pasaría aunque el código no
    pusiera a los conectados delante, y no estaría fijando nada.
    """
    client, priv = _build_client()
    _register(client, ZOE, "zoe")
    _register(client, ANA, "ana")
    _mock_online(monkeypatch, [{"wallet": ZOE, "name": "zoe"}])

    r = client.get("/users/search", headers=_auth_headers(priv, CALLER, CALLER_ID))

    assert r.status_code == 200, r.text
    by_wallet = {u["wallet"]: u["online"] for u in r.json()}
    assert by_wallet[ZOE] is True
    assert by_wallet[ANA] is False
    assert r.json()[0]["wallet"] == ZOE


def test_los_conectados_aparecen_aunque_la_pagina_ya_este_llena_por_alfabeto(monkeypatch):
    """Con 10 alias que preceden a "zoe" en el alfabeto, la primera página (8) se llenaría sin
    hueco para ella si se filtrara por prefijo DESPUÉS de recortar. El filtro tiene que ir antes.
    """
    client, priv = _build_client()
    for i in range(10):
        wallet = f"So1anaANA{i:02d}AAAAAAAAAAAAAAAAAAAAAAAAAAAAA1"
        _register(client, wallet, f"ana{i:02d}")
    _register(client, ZOE, "zoe")
    _mock_online(monkeypatch, [{"wallet": ZOE, "name": "zoe"}])

    r = client.get("/users/search", headers=_auth_headers(priv, CALLER, CALLER_ID))

    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body) == 8
    assert body[0]["wallet"] == ZOE


def test_un_conectado_sin_alias_aparece(monkeypatch):
    """Los conectados salen SIEMPRE, tengan alias o no: no pagan la consulta a la base (vienen de
    memoria), y son el destinatario más probable de una propina. Sin esto, `buscar_usuarios` con
    `q` vacía los descarta por no tener alias (ver su docstring)."""
    client, priv = _build_client()
    _register(client, SILENT)  # sin alias
    _mock_online(monkeypatch, [{"wallet": SILENT, "name": "abbr"}])

    r = client.get("/users/search", headers=_auth_headers(priv, CALLER, CALLER_ID))

    assert r.status_code == 200, r.text
    assert SILENT in [u["wallet"] for u in r.json()]


def test_el_tope_de_8_se_respeta_aunque_se_pida_mas():
    client, priv = _build_client()
    for i in range(10):
        wallet = f"So1anaUSERNUM{i}AAAAAAAAAAAAAAAAAAAAAAAAAAAAA1"
        _register(client, wallet, f"user{i}")

    r = client.get("/users/search?limit=500", headers=_auth_headers(priv, CALLER, CALLER_ID))

    assert r.status_code == 200, r.text
    body = r.json()
    # `== 8`, no `<= 8`: con el orden de rutas invertido, "search" cae en `/users/{wallet}`, que
    # devuelve UN dict (no una lista), y `len(dict) <= 8` puede colar igual. La forma exacta de
    # cada fila cierra ese hueco por el otro lado.
    assert len(body) == 8
    assert all(set(u.keys()) == {"wallet", "alias", "online"} for u in body)


def test_la_busqueda_tiene_freno():
    """Sin throttle, un bucle contra este endpoint deja el backend mudo.

    El límite es 20 por minuto y wallet (`_search_throttle` en main.py): la petición #20 pasa,
    la #21 no. Mirar solo la última de un bucle de 30 no fija ese número: cualquier límite entre
    1 y 30 haría que la última también fuera 429.
    """
    client, priv = _build_client()
    headers = _auth_headers(priv, CALLER, CALLER_ID)
    respuestas = [client.get("/users/search?q=a", headers=headers).status_code for _ in range(21)]
    assert respuestas[19] == 200   # la #20: agota el cupo, pero pasa
    assert respuestas[20] == 429   # la #21: ya no queda cupo


def test_search_no_lo_come_la_ruta_de_wallet():
    """/users/{wallet} está declarada antes en el fichero: si el orden se invierte, 'search' se
    interpreta como una wallet y este endpoint deja de existir sin que falle nada más."""
    client, priv = _build_client()
    r = client.get("/users/search?q=an", headers=_auth_headers(priv, CALLER, CALLER_ID))
    assert isinstance(r.json(), list)


def test_users_search_no_es_async():
    """`def`, no `async def`, y a propósito (ver el docstring del endpoint en main.py): con la
    base síncrona, un `async def` que consulta bloquea el bucle de eventos y deja el proceso sin
    atender NADA, ni /health. Medido: con `async def` y una búsqueda lenta en vuelo, /health tarda
    1,02s; con `def`, 0,05s. Con 62 `async def` alrededor en este fichero, es la clase de cosa que
    una "limpieza por consistencia" revierte sin darse cuenta."""
    client, _ = _build_client()
    ruta = next(r for r in client.app.routes if getattr(r, "path", None) == "/users/search")
    assert not asyncio.iscoroutinefunction(ruta.dependant.call)
