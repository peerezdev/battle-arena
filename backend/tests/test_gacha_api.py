import json

import based58
import pytest
import respx
from fastapi.testclient import TestClient
from httpx import Response
from nacl.signing import SigningKey
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from app.main import create_app
from app.db import make_session_factory, init_db
from app.auth import AuthService, auth_message
from app.chain.mock import MockChainSource
from app.services.gacha import GachaService

BASE = "https://dev-gacha.collectorcrypt.com"


def _client(api_key="k123", rate_limit=10):
    engine = create_engine("sqlite:///:memory:",
                           connect_args={"check_same_thread": False}, poolclass=StaticPool)
    init_db(engine)
    sf = make_session_factory(engine)
    auth = AuthService(now_fn=lambda: 1000, ttl=3600)
    gacha = GachaService(base_url=BASE, api_key=api_key)
    app = create_app(sf, MockChainSource(), auth, elo_start=1200, elo_k=32,
                     gacha=gacha, gacha_rate_limit=rate_limit)
    return TestClient(app), auth


def _login(c, auth):
    key = SigningKey.generate()
    wallet = based58.b58encode(bytes(key.verify_key)).decode()
    nonce = c.get(f"/auth/nonce?wallet={wallet}").json()["nonce"]
    sig = key.sign(auth_message(nonce).encode()).signature.hex()
    token = c.post("/auth/verify", json={"wallet": wallet, "signature_hex": sig}).json()["token"]
    return wallet, {"Authorization": f"Bearer {token}"}


def test_machines_publico_y_503_sin_key():
    c, _ = _client(api_key="")
    r = c.get("/gacha/machines")
    assert r.status_code == 503
    assert r.json()["detail"] == "gacha_disabled"


@respx.mock
def test_machines_ok():
    respx.get(f"{BASE}/api/machines").mock(return_value=Response(200, json=[
        {"code": "pokemon_50", "name": "P50", "price": 50, "odds": {}, "stock": {},
         "ev": 1.0, "image": None}]))
    c, _ = _client()
    r = c.get("/gacha/machines")
    assert r.status_code == 200
    assert r.json()[0]["code"] == "pokemon_50"


def test_generate_pack_requiere_auth():
    c, _ = _client()
    assert c.post("/gacha/generate-pack", json={"pack_type": "pokemon_50"}).status_code == 401


@respx.mock
def test_generate_pack_fija_player_y_guarda_memo():
    route = respx.post(f"{BASE}/api/generatePack").mock(
        return_value=Response(200, json={"memo": "slug-m1", "transaction": "dA=="}))
    c, auth = _client()
    wallet, hdrs = _login(c, auth)
    r = c.post("/gacha/generate-pack", json={"pack_type": "pokemon_50"}, headers=hdrs)
    assert r.status_code == 200
    assert r.json() == {"memo": "slug-m1", "transaction": "dA=="}
    assert json.loads(route.calls[0].request.content)["playerAddress"] == wallet


@respx.mock
def test_open_pack_memo_ajeno_403():
    respx.post(f"{BASE}/api/generatePack").mock(
        return_value=Response(200, json={"memo": "slug-m2", "transaction": "dA=="}))
    c, auth = _client()
    _, hdrs1 = _login(c, auth)
    c.post("/gacha/generate-pack", json={"pack_type": "pokemon_50"}, headers=hdrs1)
    _, hdrs2 = _login(c, auth)  # otra wallet
    r = c.post("/gacha/open-pack", json={"memo": "slug-m2"}, headers=hdrs2)
    assert r.status_code == 403


@respx.mock
def test_open_pack_ok_marca_abierto():
    respx.post(f"{BASE}/api/generatePack").mock(
        return_value=Response(200, json={"memo": "slug-m3", "transaction": "dA=="}))
    respx.post(f"{BASE}/api/openPack").mock(return_value=Response(200, json={
        "success": True, "nft_address": "Mint" + "1" * 40, "rarity": "Rare",
        "nftWon": {"content": {"metadata": {"name": "Pika"}}, "image": "https://x/p.png"}}))
    c, auth = _client()
    _, hdrs = _login(c, auth)
    c.post("/gacha/generate-pack", json={"pack_type": "pokemon_50"}, headers=hdrs)
    r = c.post("/gacha/open-pack", json={"memo": "slug-m3"}, headers=hdrs)
    assert r.status_code == 200
    assert r.json() == {"pending": False, "nft_address": "Mint" + "1" * 40,
                        "rarity": "Rare", "name": "Pika", "image": "https://x/p.png"}


@respx.mock
def test_open_pack_pendiente():
    respx.post(f"{BASE}/api/generatePack").mock(
        return_value=Response(200, json={"memo": "slug-m4", "transaction": "dA=="}))
    respx.post(f"{BASE}/api/openPack").mock(
        return_value=Response(200, json={"code": "WAITING_FOR_WEBHOOK"}))
    c, auth = _client()
    _, hdrs = _login(c, auth)
    c.post("/gacha/generate-pack", json={"pack_type": "pokemon_50"}, headers=hdrs)
    r = c.post("/gacha/open-pack", json={"memo": "slug-m4"}, headers=hdrs)
    assert r.status_code == 200
    assert r.json() == {"pending": True}


@respx.mock
def test_submit_tx_valida_base64_y_tamano():
    c, auth = _client()
    _, hdrs = _login(c, auth)
    assert c.post("/gacha/submit-tx", json={"signed_transaction": "no base64 !!"},
                  headers=hdrs).status_code == 422
    assert c.post("/gacha/submit-tx", json={"signed_transaction": "A" * 4000},
                  headers=hdrs).status_code == 422


@respx.mock
def test_upstream_caido_502():
    respx.get(f"{BASE}/api/machines").mock(return_value=Response(500, text="interno secreto"))
    c, _ = _client()
    r = c.get("/gacha/machines")
    assert r.status_code == 502
    assert "secreto" not in r.text


@respx.mock
def test_rate_limit_429():
    respx.post(f"{BASE}/api/generatePack").mock(
        return_value=Response(200, json={"memo": None, "transaction": None}))
    c, auth = _client(rate_limit=2)
    _, hdrs = _login(c, auth)
    codes = [c.post("/gacha/generate-pack", json={"pack_type": "pokemon_50"}, headers=hdrs).status_code
             for _ in range(3)]
    # las 2 primeras llegan al upstream (memo nulo → 502); la 3ª ni sale → 429
    assert codes[2] == 429
