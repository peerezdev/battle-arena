import json

import pytest
import respx
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from app.main import create_app
from app.db import make_session_factory, init_db
from app.privy import PrivyVerifier
from app.chain.mock import MockChainSource
from app.services.gacha import GachaService

from tests.conftest import make_es256, privy_auth_headers

BASE = "https://dev-gacha.collectorcrypt.com"
APP_ID = "app123"

# Direcciones Solana embebidas de prueba (44 caracteres)
WALLET_A = "So1anaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1"
WALLET_B = "So1anaBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1"


def _client(api_key="k123", rate_limit=10, base_url=BASE):
    engine = create_engine("sqlite:///:memory:",
                           connect_args={"check_same_thread": False}, poolclass=StaticPool)
    init_db(engine)
    sf = make_session_factory(engine)
    priv = make_es256()
    privy = PrivyVerifier(app_id=APP_ID, key_resolver=lambda kid: priv.public_key())
    gacha = GachaService(base_url=base_url, api_key=api_key)
    app = create_app(sf, MockChainSource(), elo_start=1200, elo_k=32,
                     gacha=gacha, gacha_rate_limit=rate_limit, privy=privy)
    return TestClient(app), priv


def _hdrs(priv, wallet):
    """Devuelve headers de Authorization para `wallet`."""
    return privy_auth_headers(priv, APP_ID, wallet)


@respx.mock
def test_machines_keyless_ok():
    respx.get(f"{BASE}/api/machines").mock(return_value=Response(200, json={"machines": [
        {"code": "pokemon_50", "name": "P50", "price": 50, "odds": {}, "stock": {},
         "ev": 1.0, "image": None}]}))
    respx.get(f"{BASE}/api/status").mock(return_value=Response(200, json={"gachas": []}))
    c, _ = _client(api_key="")
    r = c.get("/gacha/machines")
    assert r.status_code == 200
    assert r.json()[0]["code"] == "pokemon_50"


def test_503_when_base_url_empty():
    c, _ = _client(api_key="", base_url="")
    r = c.get("/gacha/machines")
    assert r.status_code == 503
    assert r.json()["detail"] == "gacha_disabled"


@respx.mock
def test_machines_ok():
    respx.get(f"{BASE}/api/machines").mock(return_value=Response(200, json={"machines": [
        {"code": "pokemon_50", "name": "P50", "price": 50, "odds": {}, "stock": {},
         "ev": 1.0, "image": None}]}))
    respx.get(f"{BASE}/api/status").mock(return_value=Response(200, json={"gachas": []}))
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
    c, priv = _client()
    hdrs = _hdrs(priv, WALLET_A)
    r = c.post("/gacha/generate-pack", json={"pack_type": "pokemon_50"}, headers=hdrs)
    assert r.status_code == 200
    assert r.json() == {"memo": "slug-m1", "transaction": "dA=="}
    assert json.loads(route.calls[0].request.content)["playerAddress"] == WALLET_A


@respx.mock
def test_open_pack_memo_ajeno_403():
    respx.post(f"{BASE}/api/generatePack").mock(
        return_value=Response(200, json={"memo": "slug-m2", "transaction": "dA=="}))
    c, priv = _client()
    hdrs_a = _hdrs(priv, WALLET_A)
    c.post("/gacha/generate-pack", json={"pack_type": "pokemon_50"}, headers=hdrs_a)
    hdrs_b = _hdrs(priv, WALLET_B)  # otra wallet, misma clave (app verifier la acepta)
    r = c.post("/gacha/open-pack", json={"memo": "slug-m2"}, headers=hdrs_b)
    assert r.status_code == 403


@respx.mock
def test_open_pack_ok_marca_abierto():
    respx.post(f"{BASE}/api/generatePack").mock(
        return_value=Response(200, json={"memo": "slug-m3", "transaction": "dA=="}))
    respx.post(f"{BASE}/api/openPack").mock(return_value=Response(200, json={
        "success": True, "nft_address": "Mint" + "1" * 40, "rarity": "Rare",
        "nftWon": {"content": {"metadata": {"name": "Pika"}}, "image": "https://x/p.png"}}))
    c, priv = _client()
    hdrs = _hdrs(priv, WALLET_A)
    c.post("/gacha/generate-pack", json={"pack_type": "pokemon_50"}, headers=hdrs)
    r = c.post("/gacha/open-pack", json={"memo": "slug-m3"}, headers=hdrs)
    assert r.status_code == 200
    assert r.json() == {"pending": False, "nft_address": "Mint" + "1" * 40,
                        "rarity": "Rare", "name": "Pika", "image": "https://x/p.png",
                        "images": ["https://x/p.png"],
                        "grade": None, "year": None,
                        "grading_company": None, "grading_id": None,
                        "authenticated": None, "insured_value": None}


@respx.mock
def test_open_pack_pendiente():
    respx.post(f"{BASE}/api/generatePack").mock(
        return_value=Response(200, json={"memo": "slug-m4", "transaction": "dA=="}))
    respx.post(f"{BASE}/api/openPack").mock(
        return_value=Response(200, json={"code": "WAITING_FOR_WEBHOOK"}))
    c, priv = _client()
    hdrs = _hdrs(priv, WALLET_A)
    c.post("/gacha/generate-pack", json={"pack_type": "pokemon_50"}, headers=hdrs)
    r = c.post("/gacha/open-pack", json={"memo": "slug-m4"}, headers=hdrs)
    assert r.status_code == 200
    assert r.json() == {"pending": True}


@respx.mock
def test_submit_tx_valida_base64_y_tamano():
    c, priv = _client()
    hdrs = _hdrs(priv, WALLET_A)
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
    c, priv = _client(rate_limit=2)
    hdrs = _hdrs(priv, WALLET_A)
    codes = [c.post("/gacha/generate-pack", json={"pack_type": "pokemon_50"}, headers=hdrs).status_code
             for _ in range(3)]
    # las 2 primeras llegan al upstream (memo nulo → 502); la 3ª ni sale → 429
    assert codes[2] == 429


@respx.mock
def test_machine_cards_ok():
    respx.get(f"{BASE}/api/getNfts").mock(return_value=Response(200, json={"nfts": [
        {"nft_address": "A", "name": "Card A", "image": "i", "rarity": "rare",
         "insured_value": 400, "attributes": [{"trait_type": "Grading Company", "value": "PSA"},
                                               {"trait_type": "The Grade", "value": "MINT 9"}]}]}))
    c, _ = _client(api_key="")
    r = c.get("/gacha/machines/pokemon_50/cards?limit=10")
    assert r.status_code == 200
    body = r.json()
    assert body[0]["name"] == "Card A"
    assert body[0]["grade"] == "PSA MINT 9"


def test_machine_cards_503_when_base_url_empty():
    c, _ = _client(api_key="", base_url="")
    r = c.get("/gacha/machines/pokemon_50/cards")
    assert r.status_code == 503


@respx.mock
def test_generate_pack_502_detail_carries_reason():
    respx.post(f"{BASE}/api/generatePack").mock(return_value=Response(500, json={"details": "Machine is off"}))
    c, priv = _client(api_key="")
    r = c.post("/gacha/generate-pack", json={"pack_type": "pokemon_25"}, headers=_hdrs(priv, WALLET_A))
    assert r.status_code == 502
    assert "Machine is off" in r.json()["detail"]
