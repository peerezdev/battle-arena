from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from app.main import create_app
from app.db import make_session_factory, init_db
from app.privy import PrivyVerifier
from app.chain.mock import MockChainSource

from tests.conftest import make_es256, make_id_token, solana_embedded, privy_auth_headers

# Realistic-length Solana pubkey stubs for HTTP-layer tests (44 chars, base58-like)
BP1 = "BattlePubkey1111111111111111111111111111111"   # 43 chars
BP2 = "BattlePubkey2222222222222222222222222222222"   # 43 chars

APP_ID = "app123"

# Par de clave / verifier compartido para cada instancia de cliente
_PRIV = make_es256()


def _client():
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
    app = create_app(sf, chain, elo_start=1200, elo_k=32, privy=privy)
    return TestClient(app), chain, priv


def _auth_headers(priv, wallet):
    """Devuelve headers de Authorization para `wallet` usando `priv`."""
    return privy_auth_headers(priv, APP_ID, wallet)


def test_health():
    c, _, _ = _client()
    assert c.get("/health").json()["status"] == "ok"


def test_auth_and_create_match_flow():
    c, chain, priv = _client()
    wallet = "So1ana1111111111111111111111111111111111111"
    hdrs = _auth_headers(priv, wallet)
    chain.set_battle(BP1, player_a=wallet, stake=100)
    r = c.post("/matches", json={"battle_pubkey": BP1, "min_elo": 1000, "max_elo": 1500},
               headers=hdrs)
    assert r.status_code == 200 and r.json()["stake"] == 100
    # listado con viewer
    rows = c.get("/matches/open", params={"viewer": wallet}).json()
    assert rows[0]["battle_pubkey"] == BP1 and rows[0]["joinable"] is True


def test_create_match_requires_auth():
    c, chain, _ = _client()
    chain.set_battle(BP1, player_a="A" * 44, stake=100)
    r = c.post("/matches", json={"battle_pubkey": BP1})
    assert r.status_code == 401


def test_get_unknown_user_is_readonly():
    c, _, _ = _client()
    r = c.get("/users/SomeUnknownWalletPubkey1111111111111111")
    assert r.status_code == 200 and r.json()["elo"] == 1200
    lb = c.get("/leaderboard").json()
    assert lb == []  # la lectura no creó ningún usuario


def test_sync_unknown_match_404():
    c, chain, priv = _client()
    wallet = "So1ana1111111111111111111111111111111111111"
    hdrs = _auth_headers(priv, wallet)
    r = c.post("/matches/UNREGISTERED/sync", headers=hdrs)
    assert r.status_code == 404


def test_sync_requires_auth():
    c, chain, _ = _client()
    r = c.post("/matches/SOMEMATCH/sync")
    assert r.status_code == 401


def test_sync_applies_elo_and_compare():
    c, chain, priv = _client()
    wa = "So1anaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    wb = "So1anaBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
    hdrs_a = _auth_headers(priv, wa)
    chain.set_battle(BP1, player_a=wa, stake=100)
    c.post("/matches", json={"battle_pubkey": BP1}, headers=hdrs_a)
    chain.join(BP1, player_b=wb)
    chain.settle(BP1, winner=wa)
    r = c.post(f"/matches/{BP1}/sync", headers=hdrs_a)
    assert r.status_code == 200 and r.json()["elo_applied"] is True
    cmp = c.get("/elo/compare", params={"a": wa, "b": wb}).json()
    assert cmp["elo_a"] == 1216 and cmp["elo_b"] == 1184 and cmp["diff"] == 32


def test_alias_too_long_rejected():
    c, _, priv = _client()
    wallet = "So1ana1111111111111111111111111111111111111"
    hdrs = _auth_headers(priv, wallet)
    r = c.post("/users/me/alias", json={"alias": "a" * 33}, headers=hdrs)
    assert r.status_code == 422


def test_leaderboard_limit_over_200_rejected():
    c, _, _ = _client()
    r = c.get("/leaderboard", params={"limit": 201})
    assert r.status_code == 422


def test_create_match_min_elo_greater_than_max_elo_rejected():
    c, chain, priv = _client()
    wallet = "So1ana1111111111111111111111111111111111111"
    hdrs = _auth_headers(priv, wallet)
    chain.set_battle(BP2, player_a=wallet, stake=50)
    r = c.post("/matches", json={"battle_pubkey": BP2, "min_elo": 1500, "max_elo": 1000},
               headers=hdrs)
    assert r.status_code == 422


def test_privy_me_503_when_privy_not_configured():
    # create_app sin privy => privy=None
    engine = create_engine("sqlite:///:memory:",
                           connect_args={"check_same_thread": False}, poolclass=StaticPool)
    init_db(engine)
    sf = make_session_factory(engine)
    app = create_app(sf, MockChainSource(), elo_start=1200, elo_k=32)
    c = TestClient(app)
    r = c.get("/auth/privy/me")
    assert r.status_code == 503


def _client_with_privy():
    """App con un PrivyVerifier configurado cuyo resolver rechaza todo →
    permite ejercitar de verdad la rama 401 del endpoint (no la 503)."""
    from app.privy import PrivyVerifier, PrivyAuthError

    def _reject(_kid):
        raise PrivyAuthError("kid desconocido (test)")

    engine = create_engine("sqlite:///:memory:",
                           connect_args={"check_same_thread": False}, poolclass=StaticPool)
    init_db(engine)
    sf = make_session_factory(engine)
    privy = PrivyVerifier(app_id=APP_ID, key_resolver=_reject)
    app = create_app(sf, MockChainSource(), elo_start=1200, elo_k=32, privy=privy)
    return TestClient(app)


def test_privy_me_401_without_bearer():
    c = _client_with_privy()
    assert c.get("/auth/privy/me", headers={"Authorization": "Token abc"}).status_code == 401
    assert c.get("/auth/privy/me").status_code == 401


def test_privy_me_401_invalid_token():
    c = _client_with_privy()
    r = c.get("/auth/privy/me", headers={"Authorization": "Bearer not-a-real-token"})
    assert r.status_code == 401


def test_current_user_503_when_privy_not_configured():
    """Sin privy, los endpoints protegidos devuelven 503."""
    engine = create_engine("sqlite:///:memory:",
                           connect_args={"check_same_thread": False}, poolclass=StaticPool)
    init_db(engine)
    sf = make_session_factory(engine)
    app = create_app(sf, MockChainSource(), elo_start=1200, elo_k=32)
    c = TestClient(app)
    r = c.post("/matches", json={"battle_pubkey": "B" * 44},
               headers={"Authorization": "Bearer tok"})
    assert r.status_code == 503


def test_current_user_401_invalid_token():
    """Token Bearer inválido (no firma de Privy) → 401."""
    c, _, _ = _client()
    r = c.post("/matches", json={"battle_pubkey": "B" * 44},
               headers={"Authorization": "Bearer not-a-jwt"})
    assert r.status_code == 401


def test_alias_must_be_unique_case_insensitive():
    c, _, priv = _client()
    wa = "WalletAAAA1111111111111111111111111111111111"
    wb = "WalletBBBB2222222222222222222222222222222222"
    tok_a = make_id_token(priv, APP_ID, [solana_embedded(wa)])
    tok_b = make_id_token(priv, APP_ID, [solana_embedded(wb)])

    r1 = c.post("/users/me/alias", json={"alias": "Neo"},
                headers={"Authorization": f"Bearer {tok_a}"})
    assert r1.status_code == 200

    r2 = c.post("/users/me/alias", json={"alias": "neo"},
                headers={"Authorization": f"Bearer {tok_b}"})
    assert r2.status_code == 409
    assert r2.json()["detail"] == "username_taken"


def test_alias_rejects_bad_charset_and_length():
    c, _, priv = _client()
    wa = "WalletAAAA1111111111111111111111111111111111"
    tok = make_id_token(priv, APP_ID, [solana_embedded(wa)])
    for bad in ["ab", "a" * 21, "has space", "emoji😀", "dash-no"]:
        r = c.post("/users/me/alias", json={"alias": bad},
                   headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 422, bad


def test_alias_same_wallet_can_keep_its_name():
    c, _, priv = _client()
    wa = "WalletAAAA1111111111111111111111111111111111"
    tok = make_id_token(priv, APP_ID, [solana_embedded(wa)])
    h = {"Authorization": f"Bearer {tok}"}
    assert c.post("/users/me/alias", json={"alias": "Trinity"}, headers=h).status_code == 200
    assert c.post("/users/me/alias", json={"alias": "Trinity"}, headers=h).status_code == 200
