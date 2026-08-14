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
        dh = reader.receive_json()  # drops_history tras la history del chat
        assert dh["type"] == "drops_history"
        assert dh["drops"] == []
        reader.receive_json()  # presence(1) tras conectar

        with client.websocket_connect(f"/ws/chat?token={token}") as poster:
            poster.receive_json()  # history (poster)
            poster.receive_json()  # drops_history (poster)
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
        anon.receive_json()  # drops_history
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
        ws.receive_json()  # drops_history
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
        ws.receive_json()  # drops_history
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
        a.receive_json()                      # drops_history
        p1 = a.receive_json()                 # presence tras history
        assert p1["type"] == "presence" and p1["online"] == 1
        with client.websocket_connect("/ws/chat") as b:
            b.receive_json()                  # history (b)
            b.receive_json()                  # drops_history (b)
            # b recibe presence(2) y a también recibe broadcast de presencia con online == 2
            pb = b.receive_json()
            assert pb["type"] == "presence" and pb["online"] == 2
            pa = a.receive_json()
            assert pa["type"] == "presence" and pa["online"] == 2
        # al cerrar b, a recibe presencia con online == 1
        pa2 = a.receive_json()
        assert pa2["type"] == "presence" and pa2["online"] == 1


def test_ws_chat_shows_alias_when_set():
    """Si el wallet tiene alias, el chat emite el alias como `user`, no el wallet abreviado."""
    app, priv = _chat_app()
    token = make_id_token(priv, APP_ID, [solana_embedded(WALLET)])
    client = TestClient(app)
    assert client.post("/users/me/alias", json={"alias": "Morpheus"},
                       headers={"Authorization": f"Bearer {token}"}).status_code == 200

    with client.websocket_connect(f"/ws/chat?token={token}") as ws:
        ws.receive_json()  # history
        ws.receive_json()  # drops_history
        ws.receive_json()  # presence(1)
        ws.send_json({"text": "hi"})
        msg = ws.receive_json()
        assert msg["type"] == "message"
        assert msg["user"] == "Morpheus"


def test_ws_chat_falls_back_to_abbreviated_wallet():
    """Sin alias, el chat emite el wallet abreviado."""
    app, priv = _chat_app()
    token = make_id_token(priv, APP_ID, [solana_embedded(WALLET)])
    client = TestClient(app)
    with client.websocket_connect(f"/ws/chat?token={token}") as ws:
        ws.receive_json()  # history
        ws.receive_json()  # drops_history
        ws.receive_json()  # presence(1)
        ws.send_json({"text": "hi"})
        msg = ws.receive_json()
        assert msg["user"] == abbreviate(WALLET)


# ── La wallet viaja con el mensaje, para poder ir al perfil desde el chat ──────────────────────

def test_el_mensaje_lleva_la_wallet_de_quien_habla():
    app, priv = _chat_app()
    token = make_id_token(priv, APP_ID, [solana_embedded(WALLET)])
    client = TestClient(app)
    with client.websocket_connect(f"/ws/chat?token={token}") as ws:
        ws.receive_json(); ws.receive_json(); ws.receive_json()   # history, drops, presence
        ws.send_json({"text": "hola"})
        msg = ws.receive_json()
        assert msg["wallet"] == WALLET


def test_el_historial_tambien_la_lleva():
    """Al reconectar, los mensajes viejos tienen que seguir siendo clicables."""
    app, priv = _chat_app()
    token = make_id_token(priv, APP_ID, [solana_embedded(WALLET)])
    client = TestClient(app)
    with client.websocket_connect(f"/ws/chat?token={token}") as ws:
        ws.receive_json(); ws.receive_json(); ws.receive_json()
        ws.send_json({"text": "hola"})
        ws.receive_json()
    with client.websocket_connect("/ws/chat") as otro:
        historia = otro.receive_json()
        assert historia["type"] == "history"
        assert historia["messages"][-1]["wallet"] == WALLET


def test_los_mensajes_sin_dueño_no_traen_wallet():
    """Los avisos de la casa y lo guardado antes de esta columna no son de nadie: mandar
    `wallet: null` haría que el cliente pintase un enlace a /profile/null."""
    from app.chat import save_chat_message, recent_chat_messages
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    init_db(engine)
    with make_session_factory(engine)() as s:
        save_chat_message(s, "Battle Arena", "auto royale abierta", 1, kind="system")
        assert "wallet" not in recent_chat_messages(s)[0]
        save_chat_message(s, "Mauro", "hola", 2, wallet=WALLET)
        assert recent_chat_messages(s)[-1]["wallet"] == WALLET


def test_online_users_no_repite_a_quien_tiene_dos_pestanas():
    """Dos pestañas son dos sockets pero UN jugador.

    `online_count` contaba sockets, así que quien abría dos pestañas inflaba el contador y
    aparecería dos veces en el autocompletado de menciones.
    """
    from app.chat import ConnectionManager
    m = ConnectionManager()
    a1, a2, b = object(), object(), object()
    for ws in (a1, a2, b):
        m._active[ws] = None            # simula conexión sin pasar por el accept
    m.identify(a1, "WalletA", "Ana")
    m.identify(a2, "WalletA", "Ana")
    m.identify(b, "WalletB", "Bea")

    assert m.online_count() == 2
    assert sorted(u["wallet"] for u in m.online_users()) == ["WalletA", "WalletB"]


def test_online_users_no_incluye_a_los_anonimos():
    """Sin sesión no hay a quién avisar, así que no se puede mencionar.

    Siguen contando en `online`: están mirando, aunque no puedan hablar.
    """
    from app.chat import ConnectionManager
    m = ConnectionManager()
    con, sin = object(), object()
    m._active[con] = None
    m._active[sin] = None
    m.identify(con, "WalletA", "Ana")

    assert m.online_count() == 2
    assert [u["wallet"] for u in m.online_users()] == ["WalletA"]


def test_solo_se_aceptan_menciones_de_conectados_y_como_mucho_cinco():
    """El cliente manda las menciones, así que el servidor no se fía.

    Sin este filtro, cualquiera podría mandar a mano un mensaje mencionando a TODA la base de
    usuarios, o a gente desconectada que nunca se enteraría.
    """
    from app.main import _menciones_validas

    conectados = [{"wallet": f"W{i}", "name": f"n{i}"} for i in range(8)]
    crudas = ([{"wallet": "DESCONECTADA", "label": "x"}]
              + [{"wallet": f"W{i}", "label": f"n{i}"} for i in range(8)])

    out = _menciones_validas(crudas, conectados)

    assert len(out) == 5                                    # recortado
    assert all(m["wallet"] != "DESCONECTADA" for m in out)  # filtrado


def test_menciones_basura_no_tumban_el_mensaje():
    """Un cliente puede mandar cualquier cosa; el mensaje se envía igual, sin esa mención."""
    from app.main import _menciones_validas

    conectados = [{"wallet": "W1", "name": "ana"}]
    crudas = ["texto suelto", None, 42, {"sin": "wallet"},
              {"wallet": "W1", "label": ""}, {"wallet": "W1", "label": "ana"}]

    assert _menciones_validas(crudas, conectados) == [{"wallet": "W1", "label": "ana"}]
    assert _menciones_validas(None, conectados) == []
