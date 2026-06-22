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
         "ev": 1.0, "image": None, "turboMode": True}]}))
    respx.get(f"{BASE}/api/status").mock(return_value=Response(200, json={"gachas": []}))
    c, _ = _client(api_key="")
    r = c.get("/gacha/machines")
    assert r.status_code == 200
    assert r.json()[0]["code"] == "pokemon_50"
    assert r.json()[0]["turboMode"] is True


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
def test_generate_pack_fija_player_y_guarda_memo(monkeypatch):
    respx.get(f"{BASE}/api/machines").mock(return_value=Response(200, json={"machines": [
        {"code": "pokemon_50", "price": 50, "available": True}]}))
    respx.get(f"{BASE}/api/status").mock(return_value=Response(200, json={"gachas": []}))
    route = respx.post(f"{BASE}/api/generatePack").mock(
        return_value=Response(200, json={"memo": "slug-m1", "transaction": "dA=="}))
    async def _high_bal(*a, **kw): return 100_000_000
    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_bal)
    c, priv = _client()
    hdrs = _hdrs(priv, WALLET_A)
    r = c.post("/gacha/generate-pack", json={"pack_type": "pokemon_50"}, headers=hdrs)
    assert r.status_code == 200
    assert r.json() == {"memo": "slug-m1", "transaction": "dA=="}
    assert json.loads(route.calls[0].request.content)["playerAddress"] == WALLET_A


@respx.mock
def test_open_pack_memo_ajeno_403(monkeypatch):
    respx.get(f"{BASE}/api/machines").mock(return_value=Response(200, json={"machines": [
        {"code": "pokemon_50", "price": 50, "available": True}]}))
    respx.get(f"{BASE}/api/status").mock(return_value=Response(200, json={"gachas": []}))
    respx.post(f"{BASE}/api/generatePack").mock(
        return_value=Response(200, json={"memo": "slug-m2", "transaction": "dA=="}))
    async def _high_bal(*a, **kw): return 100_000_000
    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_bal)
    c, priv = _client()
    hdrs_a = _hdrs(priv, WALLET_A)
    c.post("/gacha/generate-pack", json={"pack_type": "pokemon_50"}, headers=hdrs_a)
    hdrs_b = _hdrs(priv, WALLET_B)  # otra wallet, misma clave (app verifier la acepta)
    r = c.post("/gacha/open-pack", json={"memo": "slug-m2"}, headers=hdrs_b)
    assert r.status_code == 403


@respx.mock
def test_open_pack_ok_marca_abierto(monkeypatch):
    respx.get(f"{BASE}/api/machines").mock(return_value=Response(200, json={"machines": [
        {"code": "pokemon_50", "price": 50, "available": True}]}))
    respx.get(f"{BASE}/api/status").mock(return_value=Response(200, json={"gachas": []}))
    respx.post(f"{BASE}/api/generatePack").mock(
        return_value=Response(200, json={"memo": "slug-m3", "transaction": "dA=="}))
    respx.post(f"{BASE}/api/openPack").mock(return_value=Response(200, json={
        "success": True, "nft_address": "Mint" + "1" * 40, "rarity": "Rare",
        "nftWon": {"content": {"metadata": {"name": "Pika"}}, "image": "https://x/p.png"}}))
    async def _high_bal(*a, **kw): return 100_000_000
    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_bal)
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
                        "authenticated": None, "insured_value": None,
                        "auto_sold": False, "buyback_amount": None}


@respx.mock
def test_open_pack_pendiente(monkeypatch):
    respx.get(f"{BASE}/api/machines").mock(return_value=Response(200, json={"machines": [
        {"code": "pokemon_50", "price": 50, "available": True}]}))
    respx.get(f"{BASE}/api/status").mock(return_value=Response(200, json={"gachas": []}))
    respx.post(f"{BASE}/api/generatePack").mock(
        return_value=Response(200, json={"memo": "slug-m4", "transaction": "dA=="}))
    respx.post(f"{BASE}/api/openPack").mock(
        return_value=Response(200, json={"code": "WAITING_FOR_WEBHOOK"}))
    async def _high_bal(*a, **kw): return 100_000_000
    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_bal)
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
def test_rate_limit_429(monkeypatch):
    respx.get(f"{BASE}/api/machines").mock(return_value=Response(200, json={"machines": [
        {"code": "pokemon_50", "price": 50, "available": True}]}))
    respx.get(f"{BASE}/api/status").mock(return_value=Response(200, json={"gachas": []}))
    respx.post(f"{BASE}/api/generatePack").mock(
        return_value=Response(200, json={"memo": None, "transaction": None}))
    async def _high_bal(*a, **kw): return 100_000_000
    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_bal)
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
def test_generate_pack_502_detail_carries_reason(monkeypatch):
    respx.get(f"{BASE}/api/machines").mock(return_value=Response(200, json={"machines": [
        {"code": "pokemon_25", "price": 25, "available": True}]}))
    respx.get(f"{BASE}/api/status").mock(return_value=Response(200, json={"gachas": []}))
    respx.post(f"{BASE}/api/generatePack").mock(return_value=Response(500, json={"details": "Machine is off"}))
    async def _high_bal(*a, **kw): return 100_000_000
    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_bal)
    c, priv = _client(api_key="")
    r = c.post("/gacha/generate-pack", json={"pack_type": "pokemon_25"}, headers=_hdrs(priv, WALLET_A))
    assert r.status_code == 502
    assert "Machine is off" in r.json()["detail"]


@respx.mock
def test_buyback_available_ok():
    respx.get(f"{BASE}/api/buyback/available").mock(
        return_value=Response(200, json={"available": True, "amount": 42500000}))
    c, _ = _client()
    r = c.get("/gacha/buyback/available", params={"wallet": WALLET_A, "nft": "NFT1"})
    assert r.status_code == 200
    assert r.json() == {"available": True, "amount": 42500000}


@respx.mock
def test_buyback_available_false():
    respx.get(f"{BASE}/api/buyback/available").mock(
        return_value=Response(200, json={"available": False}))
    c, _ = _client()
    r = c.get("/gacha/buyback/available", params={"wallet": WALLET_A, "nft": "NFT1"})
    assert r.status_code == 200
    assert r.json() == {"available": False, "amount": None}


def test_buyback_available_requiere_params():
    c, _ = _client()
    assert c.get("/gacha/buyback/available", params={"wallet": WALLET_A}).status_code == 422


def test_buyback_requiere_auth():
    c, _ = _client()
    assert c.post("/gacha/buyback", json={"nft_address": "NFT1"}).status_code == 401


@respx.mock
def test_buyback_fija_player_y_whitelista():
    route = respx.post(f"{BASE}/api/buyback").mock(return_value=Response(200, json={
        "success": True,
        "serializedTransaction": "BASE64TX",
        "refundAmount": 42500000,
        "memo": "memo-xyz",
        "secret": "should-not-leak",
    }))
    c, priv = _client()
    r = c.post("/gacha/buyback", json={"nft_address": "NFT1"}, headers=_hdrs(priv, WALLET_A))
    assert r.status_code == 200
    assert r.json() == {"serialized_transaction": "BASE64TX", "refund_amount": 42500000, "memo": "memo-xyz"}
    sent = json.loads(route.calls.last.request.content)
    assert sent == {"playerAddress": WALLET_A, "nftAddress": "NFT1"}


@respx.mock
def test_buyback_upstream_error_502():
    respx.post(f"{BASE}/api/buyback").mock(
        return_value=Response(400, json={"error": "outside 72-hour window"}))
    c, priv = _client()
    r = c.post("/gacha/buyback", json={"nft_address": "NFT1"}, headers=_hdrs(priv, WALLET_A))
    assert r.status_code == 502
    assert "72-hour" in r.json()["detail"]


@respx.mock
def test_machine_cards_enriched():
    respx.get(f"{BASE}/api/getNfts").mock(return_value=Response(200, json={"nfts": [{
        "nft_address": "MINT1", "name": "1999 Charizard", "image": "img-front",
        "rarity": "epic", "insured_value": 5000,
        "content": {"files": [
            {"cc_cdn": "img-front"}, {"cdn_uri": "img-back"},
        ]},
        "attributes": [
            {"trait_type": "Year", "value": "1999"},
            {"trait_type": "Grading Company", "value": "PSA"},
            {"trait_type": "Grading ID", "value": "44272228"},
            {"trait_type": "The Grade", "value": "MINT 9"},
            {"trait_type": "GradeNum", "value": 9},
            {"trait_type": "Authenticated", "value": "true"},
        ],
    }]}))
    c, _ = _client(api_key="")
    r = c.get("/gacha/machines/pokemon_50/cards?limit=10")
    assert r.status_code == 200
    card = r.json()[0]
    assert card["images"] == ["img-front", "img-back"]
    assert card["grading_company"] == "PSA"
    assert card["grading_id"] == "44272228"
    assert card["the_grade"] == "MINT 9"
    assert card["generic_grade"] == "9"
    assert card["authenticated"] is True
    assert card["year"] == "1999"
    assert card["grade"] == "PSA MINT 9"  # existing composed field unchanged


@respx.mock
def test_yolo_generates_and_stores_memos():
    route = respx.post(f"{BASE}/api/generateYoloPacks").mock(return_value=Response(200, json={
        "yoloId": "y-1", "count": 2, "extra": "drop-me",
        "transactions": [
            {"memo": "ym-1", "transaction": "TX1", "junk": 1},
            {"memo": "ym-2", "transaction": "TX2"},
        ],
    }))
    c, priv = _client(api_key="")
    r = c.post("/gacha/yolo", json={"pack_type": "pokemon_50", "count": 2, "turbo": True},
               headers=_hdrs(priv, WALLET_A))
    assert r.status_code == 200
    assert r.json() == {"yolo_id": "y-1", "count": 2,
                        "transactions": [{"memo": "ym-1", "transaction": "TX1"},
                                         {"memo": "ym-2", "transaction": "TX2"}]}
    sent = json.loads(route.calls.last.request.content)
    assert sent == {"playerAddress": WALLET_A, "packType": "pokemon_50", "count": 2, "turbo": True}


def test_yolo_count_bounds():
    c, priv = _client()
    assert c.post("/gacha/yolo", json={"pack_type": "pokemon_50", "count": 0},
                  headers=_hdrs(priv, WALLET_A)).status_code == 422
    assert c.post("/gacha/yolo", json={"pack_type": "pokemon_50", "count": 11},
                  headers=_hdrs(priv, WALLET_A)).status_code == 422


def test_yolo_requires_auth():
    c, _ = _client()
    assert c.post("/gacha/yolo", json={"pack_type": "pokemon_50", "count": 2}).status_code == 401


@respx.mock
def test_yolo_open_pack_owns_memo():
    respx.post(f"{BASE}/api/generateYoloPacks").mock(return_value=Response(200, json={
        "yoloId": "y-2", "count": 1, "transactions": [{"memo": "ym-own", "transaction": "TX"}]}))
    respx.post(f"{BASE}/api/openPack").mock(return_value=Response(200, json={
        "nft_address": "MINT", "rarity": "Common", "code": "TURBO_MODE_BUYBACK",
        "buybackAmount": 42500000, "nftWon": {"content": {"metadata": {"name": "C"}}}}))
    c, priv = _client(api_key="")
    c.post("/gacha/yolo", json={"pack_type": "pokemon_50", "count": 1, "turbo": True},
           headers=_hdrs(priv, WALLET_A))
    r = c.post("/gacha/open-pack", json={"memo": "ym-own"}, headers=_hdrs(priv, WALLET_A))
    assert r.status_code == 200
    body = r.json()
    assert body["auto_sold"] is True
    assert body["buyback_amount"] == 42500000


@respx.mock
def test_open_pack_not_auto_sold_by_default(monkeypatch):
    respx.get(f"{BASE}/api/machines").mock(return_value=Response(200, json={"machines": [
        {"code": "pokemon_50", "price": 50, "available": True}]}))
    respx.get(f"{BASE}/api/status").mock(return_value=Response(200, json={"gachas": []}))
    respx.post(f"{BASE}/api/generatePack").mock(return_value=Response(200, json={"memo": "m-x", "transaction": "T"}))
    respx.post(f"{BASE}/api/openPack").mock(return_value=Response(200, json={
        "nft_address": "MINT", "rarity": "Rare", "nftWon": {"content": {"metadata": {"name": "R"}}}}))
    async def _high_bal(*a, **kw): return 100_000_000
    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_bal)
    c, priv = _client(api_key="")
    c.post("/gacha/generate-pack", json={"pack_type": "pokemon_50"}, headers=_hdrs(priv, WALLET_A))
    r = c.post("/gacha/open-pack", json={"memo": "m-x"}, headers=_hdrs(priv, WALLET_A))
    assert r.json()["auto_sold"] is False
    assert r.json()["buyback_amount"] is None


@respx.mock
@pytest.mark.asyncio
async def test_generate_pack_forwards_alt_player_address():
    from app.services.gacha import GachaService
    route = respx.post(f"{BASE}/api/generatePack").mock(
        return_value=Response(200, json={"memo": "m", "transaction": "T"}))
    svc = GachaService(base_url=BASE, api_key="")
    await svc.generate_pack(player_address="P", pack_type="pokemon_50", alt_player_address="ESCROW")
    sent = json.loads(route.calls.last.request.content)
    assert sent == {"playerAddress": "P", "packType": "pokemon_50", "altPlayerAddress": "ESCROW"}


@respx.mock
@pytest.mark.asyncio
async def test_generate_pack_omits_alt_when_none():
    from app.services.gacha import GachaService
    route = respx.post(f"{BASE}/api/generatePack").mock(
        return_value=Response(200, json={"memo": "m", "transaction": "T"}))
    svc = GachaService(base_url=BASE, api_key="")
    await svc.generate_pack(player_address="P", pack_type="pokemon_50")
    sent = json.loads(route.calls.last.request.content)
    assert "altPlayerAddress" not in sent
