"""Tests para el chat de lobby por WebSocket."""
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from app.chat import ChatBuffer, abbreviate
from app.db import make_session_factory, init_db
from app.main import create_app
from app.privy import PrivyVerifier
from app.chain.mock import MockChainSource

from tests.conftest import make_es256, make_id_token, solana_embedded

APP_ID = "app123"
WALLET = "Wallet1111111111111111111111111111111111111"  # 43 chars


def _chat_app():
    """Crea una app con PrivyVerifier inyectado para tests de chat."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    init_db(engine)
    sf = make_session_factory(engine)
    chain = MockChainSource()
    priv = make_es256()
    privy = PrivyVerifier(app_id=APP_ID, key_resolver=lambda kid: priv.public_key())
    app = create_app(sf, chain, privy=privy)
    return app, priv


# ── Pruebas unitarias de ChatBuffer y abbreviate ──────────────────────────────

def test_buffer_keeps_last_n():
    buf = ChatBuffer(maxlen=3)
    for i in range(5):
        buf.add({"user": "u", "text": str(i), "ts": i})
    assert [m["text"] for m in buf.history()] == ["2", "3", "4"]


def test_abbreviate():
    assert abbreviate("ABCDEFGH1234WXYZ") == "ABCD…WXYZ"
    assert abbreviate("short") == "short"


# ── Pruebas de integración WebSocket ─────────────────────────────────────────

def test_ws_chat_history_and_broadcast():
    """Un poster autenticado envía un mensaje; el reader anónimo lo recibe."""
    app, priv = _chat_app()
    token = make_id_token(priv, APP_ID, [solana_embedded(WALLET)])
    client = TestClient(app)

    with client.websocket_connect("/ws/chat") as reader:
        first = reader.receive_json()
        assert first["type"] == "history"
        reader.receive_json()  # presence(1) tras conectar

        with client.websocket_connect(f"/ws/chat?token={token}") as poster:
            poster.receive_json()  # history (poster)
            poster.receive_json()  # presence(2) para poster
            reader.receive_json()  # presence(2) broadcast a reader
            poster.send_json({"text": "hello"})
            msg = reader.receive_json()
            assert msg["type"] == "message"
            assert msg["text"] == "hello"


def test_ws_unauthenticated_post_returns_error_and_no_broadcast():
    """Un cliente sin token que intenta postear recibe login_required, sin broadcast."""
    app, _ = _chat_app()
    client = TestClient(app)

    with client.websocket_connect("/ws/chat") as anon:
        anon.receive_json()  # history
        anon.receive_json()  # presence(1)
        anon.send_json({"text": "intruso"})
        err = anon.receive_json()
        assert err["type"] == "error"
        assert err["error"] == "login_required"


def test_ws_chat_truncates_to_280_chars():
    app, priv = _chat_app()
    token = make_id_token(priv, APP_ID, [solana_embedded(WALLET)])
    client = TestClient(app)
    with client.websocket_connect(f"/ws/chat?token={token}") as ws:
        ws.receive_json()  # history
        ws.receive_json()  # presence(1)
        ws.send_json({"text": "a" * 500})
        msg = ws.receive_json()
        assert msg["type"] == "message"
        assert len(msg["text"]) == 280


def test_ws_chat_rate_limits_after_5_in_10s():
    """El 6º mensaje en la ventana recibe rate_limited (5 msg / 10s)."""
    app, priv = _chat_app()
    token = make_id_token(priv, APP_ID, [solana_embedded(WALLET)])
    client = TestClient(app)
    with client.websocket_connect(f"/ws/chat?token={token}") as ws:
        ws.receive_json()  # history
        ws.receive_json()  # presence(1)
        for i in range(5):
            ws.send_json({"text": f"m{i}"})
            assert ws.receive_json()["type"] == "message"
        ws.send_json({"text": "over"})
        resp = ws.receive_json()
        assert resp["type"] == "error"
        assert resp["error"] == "rate_limited"


def test_ws_chat_presence_reflects_connections():
    app, _ = _chat_app()
    client = TestClient(app)
    with client.websocket_connect("/ws/chat") as a:
        a.receive_json()                      # history
        p1 = a.receive_json()                 # presence tras history
        assert p1["type"] == "presence" and p1["online"] == 1
        with client.websocket_connect("/ws/chat") as b:
            b.receive_json()                  # history (b)
            # b recibe presence(2) y a también recibe broadcast de presencia con online == 2
            pb = b.receive_json()
            assert pb["type"] == "presence" and pb["online"] == 2
            pa = a.receive_json()
            assert pa["type"] == "presence" and pa["online"] == 2
        # al cerrar b, a recibe presencia con online == 1
        pa2 = a.receive_json()
        assert pa2["type"] == "presence" and pa2["online"] == 1
