import pytest
from app.config import Settings
from app.models import GachaPack
import respx
from httpx import Response
from app.services.gacha import GachaService, GachaDisabled, GachaUpstreamError

BASE = "https://dev-gacha.collectorcrypt.com"
MACHINE = {
    "code": "pokemon_50", "name": "Pokemon 50", "price": 50,
    "odds": {"epic": 1, "rare": 9, "uncommon": 30, "common": 60},
    "stock": {"epic": 2, "rare": 10, "uncommon": 40, "common": 100},
    "ev": 42.5, "image": "",
    "shortName": "Poke50", "thumbnailUrl": "/pokemon_50.png",
    "videoSrc": "/pokemon_50.webm", "videoHevc": "/pokemon_50.hevc.mp4",
    "instantBuyback": 80, "contains": 1,
    "tierRanges": {"common": {"start": 150, "end": 250}}, "extra_ignored": "x",
}


def _svc(now=None):
    return GachaService(base_url=BASE, api_key="k123", now_fn=now or (lambda: 1000.0))


def test_settings_gacha_defaults():
    s = Settings(_env_file=None)
    assert s.gacha_base_url == "https://dev-gacha.collectorcrypt.com"
    assert s.gacha_api_key == ""


def test_gacha_pack_model(Session):
    s = Session()
    p = GachaPack(memo="slug-abc-123", wallet="W" * 43, pack_type="pokemon_50")
    s.add(p)
    s.commit()
    row = s.get(GachaPack, "slug-abc-123")
    assert row.wallet == "W" * 43
    assert row.opened_at is None and row.nft_address is None
    s.close()


@respx.mock
@pytest.mark.asyncio
async def test_enabled_keyless_devnet():
    """Sin API key pero con base_url, el gacha está habilitado (devnet keyless)
    y NO envía el header x-api-key."""
    route = respx.get(f"{BASE}/api/machines").mock(return_value=Response(200, json={"machines": [MACHINE]}))
    respx.get(f"{BASE}/api/status").mock(return_value=Response(200, json={"gachas": []}))
    svc = GachaService(base_url=BASE, api_key="")
    assert svc.enabled is True
    out = await svc.machines()
    assert out[0]["code"] == "pokemon_50"
    assert "x-api-key" not in route.calls[0].request.headers


@pytest.mark.asyncio
async def test_disabled_without_base_url():
    """Sin base_url el gacha está deshabilitado (kill-switch)."""
    svc = GachaService(base_url="", api_key="")
    with pytest.raises(GachaDisabled):
        await svc.machines()


@respx.mock
@pytest.mark.asyncio
async def test_machines_maps_and_caches():
    route = respx.get(f"{BASE}/api/machines").mock(return_value=Response(200, json={"machines": [MACHINE]}))
    respx.get(f"{BASE}/api/status").mock(return_value=Response(200, json={"gachas": [{"code": "pokemon_50", "status": "open"}]}))
    svc = _svc()
    out = await svc.machines()
    assert out == [{
        "code": "pokemon_50", "name": "Pokemon 50", "price": 50,
        "odds": MACHINE["odds"], "tierRanges": MACHINE["tierRanges"], "stock": MACHINE["stock"], "ev": 42.5,
        "image": "",
        "shortName": "Poke50", "thumbnailUrl": f"{BASE}/pokemon_50.png",
        "videoSrc": f"{BASE}/pokemon_50.webm", "videoHevc": f"{BASE}/pokemon_50.hevc.mp4",
        "instantBuyback": 80, "contains": 1,
        "turboMode": None,
        "available": True,
    }]
    assert out[0]["tierRanges"] == {"common": {"start": 150, "end": 250}}
    assert "extra_ignored" not in out[0]
    await svc.machines()
    assert route.call_count == 1  # cache 60s


@respx.mock
@pytest.mark.asyncio
async def test_machines_accepts_top_level_list():
    """Tolerante: si el upstream devolviera una lista top-level, también se parsea."""
    respx.get(f"{BASE}/api/machines").mock(return_value=Response(200, json=[MACHINE]))
    respx.get(f"{BASE}/api/status").mock(return_value=Response(200, json={"gachas": []}))
    out = await _svc().machines()
    assert out[0]["code"] == "pokemon_50"


@respx.mock
@pytest.mark.asyncio
async def test_machines_cache_expira():
    route = respx.get(f"{BASE}/api/machines").mock(return_value=Response(200, json={"machines": [MACHINE]}))
    respx.get(f"{BASE}/api/status").mock(return_value=Response(200, json={"gachas": []}))
    t = {"v": 1000.0}
    svc = _svc(now=lambda: t["v"])
    await svc.machines(); t["v"] = 1061.0; await svc.machines()
    assert route.call_count == 2


@respx.mock
@pytest.mark.asyncio
async def test_generate_pack_sends_api_key_and_player():
    route = respx.post(f"{BASE}/api/generatePack").mock(
        return_value=Response(200, json={"memo": "slug-uuid-1", "transaction": "dGVzdA=="}))
    out = await _svc().generate_pack(player_address="W" * 43, pack_type="pokemon_50")
    assert out == {"memo": "slug-uuid-1", "transaction": "dGVzdA=="}
    req = route.calls[0].request
    assert req.headers["x-api-key"] == "k123"
    import json as _json
    body = _json.loads(req.content)
    assert body == {"playerAddress": "W" * 43, "packType": "pokemon_50"}


@respx.mock
@pytest.mark.asyncio
async def test_upstream_error_becomes_gacha_upstream_error():
    respx.post(f"{BASE}/api/generatePack").mock(return_value=Response(500, text="boom interno"))
    with pytest.raises(GachaUpstreamError):
        await _svc().generate_pack(player_address="W" * 43, pack_type="pokemon_50")


@respx.mock
@pytest.mark.asyncio
async def test_open_pack_pending_passthrough():
    respx.post(f"{BASE}/api/openPack").mock(
        return_value=Response(200, json={"code": "WAITING_FOR_WEBHOOK"}))
    out = await _svc().open_pack(memo="slug-uuid-1")
    assert out == {"pending": True}


@respx.mock
@pytest.mark.asyncio
async def test_open_pack_success_whitelists_fields():
    payload = {"success": True, "transactionSignature": "sig", "nft_address": "Mint" + "1" * 40,
               "nftWon": {"content": {"metadata": {"name": "Charizard"}},
                          "image": "https://x/c.png", "secret": "no"},
               "points": 10, "roll": 4242, "rarity": "Epic"}
    respx.post(f"{BASE}/api/openPack").mock(return_value=Response(200, json=payload))
    out = await _svc().open_pack(memo="slug-uuid-1")
    assert out == {"pending": False, "nft_address": payload["nft_address"],
                   "rarity": "Epic", "name": "Charizard", "image": "https://x/c.png",
                   "images": ["https://x/c.png"],
                   "grade": None, "year": None,
                   "grading_company": None, "grading_id": None,
                   "authenticated": None, "insured_value": None,
                   "auto_sold": False, "buyback_amount": None}


@respx.mock
@pytest.mark.asyncio
async def test_open_pack_respuesta_invalida_es_upstream_error():
    respx.post(f"{BASE}/api/openPack").mock(return_value=Response(200, json={"success": True}))
    with pytest.raises(GachaUpstreamError):
        await _svc().open_pack(memo="slug-uuid-1")


@respx.mock
@pytest.mark.asyncio
async def test_submit_tx():
    route = respx.post(f"{BASE}/api/submitTransaction").mock(
        return_value=Response(200, json={"success": True, "signature": "s1",
                                         "confirmationStatus": "confirmed"}))
    out = await _svc().submit_tx(signed_transaction="dGVzdA==")
    assert out == {"signature": "s1", "confirmation_status": "confirmed"}
    import json as _json
    assert _json.loads(route.calls[0].request.content) == {"signedTransaction": "dGVzdA=="}


@respx.mock
@pytest.mark.asyncio
async def test_get_nfts_maps_and_extracts_grade():
    nft = {
        "nft_address": "H5Ez", "name": "Mewtwo GX", "image": "https://img/x",
        "rarity": "epic", "insured_value": 1628, "description": "d", "id": "H5Ez",
        "attributes": [{"trait_type": "Grading Company", "value": "CGC"},
                       {"trait_type": "The Grade", "value": "GEM MINT 9.5"}],
        "content": {}, "ownership": {},
    }
    route = respx.get(f"{BASE}/api/getNfts").mock(return_value=Response(200, json={"nfts": [nft]}))
    out = await _svc().get_nfts(code="pokemon_50", limit=3)
    assert out == [{
        "nft_address": "H5Ez", "name": "Mewtwo GX", "image": "https://img/x",
        "rarity": "epic", "insured_value": 1628, "grade": "CGC GEM MINT 9.5",
        "images": ["https://img/x"], "grading_company": "CGC", "grading_id": None,
        "the_grade": "GEM MINT 9.5", "generic_grade": None, "authenticated": None, "year": None,
    }]
    # query params sent
    req = route.calls[0].request
    assert "code=pokemon_50" in str(req.url)
    assert "limit=3" in str(req.url)


@respx.mock
@pytest.mark.asyncio
async def test_get_nfts_grade_none_when_no_attributes():
    nft = {"nft_address": "A", "name": "n", "image": None, "rarity": "common",
           "insured_value": 10, "attributes": []}
    respx.get(f"{BASE}/api/getNfts").mock(return_value=Response(200, json={"nfts": [nft]}))
    out = await _svc().get_nfts(code="pokemon_50")
    assert out[0]["grade"] is None
    assert out[0]["images"] == []
    assert out[0]["grading_company"] is None
    assert out[0]["generic_grade"] is None
    assert out[0]["authenticated"] is None
    assert out[0]["year"] is None


@respx.mock
@pytest.mark.asyncio
async def test_get_nfts_grade_num_int_no_the_grade():
    """GradeNum como int (sin The Grade) no debe lanzar AttributeError."""
    nft = {
        "nft_address": "B", "name": "Pikachu PSA9", "image": "https://img/p",
        "rarity": "rare", "insured_value": 50,
        "attributes": [
            {"trait_type": "Grading Company", "value": "PSA"},
            {"trait_type": "GradeNum", "value": 9},
        ],
        "content": {}, "ownership": {},
    }
    respx.get(f"{BASE}/api/getNfts").mock(return_value=Response(200, json={"nfts": [nft]}))
    out = await _svc().get_nfts(code="pokemon_50")
    assert out[0]["grade"] == "PSA 9"


@respx.mock
@pytest.mark.asyncio
async def test_generate_pack_surfaces_machine_empty_reason():
    respx.post(f"{BASE}/api/generatePack").mock(return_value=Response(500, json={"error": "Internal server error", "details": "Machine is empty"}))
    with pytest.raises(GachaUpstreamError) as ei:
        await _svc().generate_pack(player_address="W" * 43, pack_type="pokemon_250")
    assert "Machine is empty" in str(ei.value)


@respx.mock
@pytest.mark.asyncio
async def test_machines_merges_availability():
    respx.get(f"{BASE}/api/machines").mock(return_value=Response(200, json={"machines": [
        {**MACHINE, "code": "pokemon_50"}, {**MACHINE, "code": "pokemon_25"}]}))
    respx.get(f"{BASE}/api/status").mock(return_value=Response(200, json={"gachas": [
        {"code": "pokemon_50", "status": "open"}, {"code": "pokemon_25", "status": "closed"}]}))
    out = await _svc().machines()
    by = {m["code"]: m for m in out}
    assert by["pokemon_50"]["available"] is True
    assert by["pokemon_25"]["available"] is False


@respx.mock
@pytest.mark.asyncio
async def test_machines_available_defaults_true_when_status_fails():
    respx.get(f"{BASE}/api/machines").mock(return_value=Response(200, json={"machines": [{**MACHINE, "code": "pokemon_50"}]}))
    respx.get(f"{BASE}/api/status").mock(return_value=Response(500, json={"error": "x"}))
    out = await _svc().machines()
    assert out[0]["available"] is True


@respx.mock
@pytest.mark.asyncio
async def test_open_pack_extracts_year_and_grade():
    respx.post(f"{BASE}/api/openPack").mock(return_value=Response(200, json={
        "nft_address": "MINT1", "rarity": "epic",
        "nftWon": {"image": "https://img/x", "attributes": [
            {"trait_type": "Year", "value": "2017"},
            {"trait_type": "Grading Company", "value": "CGC"},
            {"trait_type": "The Grade", "value": "GEM MINT 9.5"}],
            "content": {"metadata": {"name": "2017 #78 Mewtwo GX"}}}}))
    out = await _svc().open_pack(memo="cc-x")
    assert out["year"] == "2017"
    assert out["grade"] == "CGC GEM MINT 9.5"
    assert out["rarity"] == "epic"


@respx.mock
@pytest.mark.asyncio
async def test_open_pack_returns_rich_metadata():
    respx.post(f"{BASE}/api/openPack").mock(return_value=Response(200, json={
        "nft_address": "MINT1", "rarity": "epic",
        "nftWon": {
            "image": "https://img/primary", "insured_value": 35,
            "attributes": [
                {"trait_type": "Year", "value": "2023"},
                {"trait_type": "Grading Company", "value": "PSA"},
                {"trait_type": "The Grade", "value": "GEM MT 10"},
                {"trait_type": "Grading ID", "value": "12345"},
                {"trait_type": "Authenticated", "value": "true"}],
            "content": {
                "metadata": {"name": "2023 #006 Tony Tony Chopper"},
                "files": [{"cc_cdn": "https://cdn/front"}, {"cc_cdn": "https://cdn/back"}]}}}))
    out = await _svc().open_pack(memo="cc-x")
    assert out["insured_value"] == 35
    assert out["images"] == ["https://cdn/front", "https://cdn/back"]
    assert out["grading_company"] == "PSA"
    assert out["grading_id"] == "12345"
    assert out["grade"] == "PSA GEM MT 10"
    assert out["authenticated"] is True
    assert out["year"] == "2023"
    assert out["name"] == "2023 #006 Tony Tony Chopper"


@respx.mock
@pytest.mark.asyncio
async def test_open_pack_insured_value_from_attribute_and_unauthenticated():
    respx.post(f"{BASE}/api/openPack").mock(return_value=Response(200, json={
        "nft_address": "MINT2", "rarity": "common",
        "nftWon": {"image": "https://img/y", "attributes": [
            {"trait_type": "Insured Value", "value": "1,500.50"},
            {"trait_type": "Authenticated", "value": "false"}],
            "content": {"metadata": {"name": "n"}}}}))
    out = await _svc().open_pack(memo="cc-y")
    assert out["insured_value"] == 1500.5
    assert out["authenticated"] is False


@pytest.mark.asyncio
async def test_generate_pack_turbo_flag(monkeypatch):
    from app.services.gacha import GachaService
    g = GachaService(base_url="http://x", api_key="k")
    captured = {}
    async def fake_request(method, path, json=None, params=None):
        captured["json"] = json
        return {"memo": "m", "transaction": "t"}
    monkeypatch.setattr(g, "_request", fake_request)

    await g.generate_pack("P", "pokemon_50", alt_player_address="E", turbo=True)
    assert captured["json"]["turbo"] is True
    assert captured["json"]["altPlayerAddress"] == "E"

    await g.generate_pack("P", "pokemon_50")
    assert "turbo" not in captured["json"]
