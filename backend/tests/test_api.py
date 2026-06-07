import based58
from fastapi.testclient import TestClient
from nacl.signing import SigningKey
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from app.main import create_app
from app.db import make_session_factory, init_db
from app.auth import AuthService, auth_message
from app.chain.mock import MockChainSource


def _client():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    init_db(engine)
    sf = make_session_factory(engine)
    chain = MockChainSource()
    auth = AuthService(now_fn=lambda: 1000, ttl=3600)
    app = create_app(sf, chain, auth, elo_start=1200, elo_k=32)
    return TestClient(app), chain, auth


def _login(c, key):
    wallet = based58.b58encode(bytes(key.verify_key)).decode()
    nonce = c.get("/auth/nonce", params={"wallet": wallet}).json()["nonce"]
    sig = key.sign(auth_message(nonce).encode()).signature.hex()
    token = c.post("/auth/verify", json={"wallet": wallet, "signature_hex": sig}).json()["token"]
    return wallet, token


def test_health():
    c, _, _ = _client()
    assert c.get("/health").json()["status"] == "ok"


def test_auth_and_create_match_flow():
    c, chain, _ = _client()
    key = SigningKey.generate()
    wallet, token = _login(c, key)
    chain.set_battle("B1", player_a=wallet, stake=100)
    r = c.post("/matches", json={"battle_pubkey": "B1", "min_elo": 1000, "max_elo": 1500},
               headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200 and r.json()["stake"] == 100
    # listado con viewer
    rows = c.get("/matches/open", params={"viewer": wallet}).json()
    assert rows[0]["battle_pubkey"] == "B1" and rows[0]["joinable"] is True


def test_create_match_requires_auth():
    c, chain, _ = _client()
    chain.set_battle("B1", player_a="A", stake=100)
    r = c.post("/matches", json={"battle_pubkey": "B1"})
    assert r.status_code == 401


def test_get_unknown_user_is_readonly():
    c, _, _ = _client()
    r = c.get("/users/SomeUnknownWalletPubkey1111111111111111")
    assert r.status_code == 200 and r.json()["elo"] == 1200
    lb = c.get("/leaderboard").json()
    assert lb == []  # la lectura no creó ningún usuario


def test_sync_applies_elo_and_compare():
    c, chain, _ = _client()
    ka, kb = SigningKey.generate(), SigningKey.generate()
    wa, token = _login(c, ka)
    wb = based58.b58encode(bytes(kb.verify_key)).decode()
    chain.set_battle("B1", player_a=wa, stake=100)
    c.post("/matches", json={"battle_pubkey": "B1"}, headers={"Authorization": f"Bearer {token}"})
    chain.join("B1", player_b=wb); chain.settle("B1", winner=wa)
    r = c.post("/matches/B1/sync")
    assert r.status_code == 200 and r.json()["elo_applied"] is True
    cmp = c.get("/elo/compare", params={"a": wa, "b": wb}).json()
    assert cmp["elo_a"] == 1216 and cmp["elo_b"] == 1184 and cmp["diff"] == 32
