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

        with client.websocket_connect(f"/ws/chat?token={token}") as poster:
            poster.receive_json()  # history
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
        anon.send_json({"text": "intruso"})
        err = anon.receive_json()
        assert err["type"] == "error"
        assert err["error"] == "login_required"
