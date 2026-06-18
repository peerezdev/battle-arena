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
    "ev": 42.5, "image": "https://x/img.png",
    "tierRanges": {}, "instantBuyback": True, "extra_ignored": "x",
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
    svc = _svc()
    out = await svc.machines()
    assert out == [{
        "code": "pokemon_50", "name": "Pokemon 50", "price": 50,
        "odds": MACHINE["odds"], "stock": MACHINE["stock"], "ev": 42.5,
        "image": "https://x/img.png",
    }]
    assert "tierRanges" not in out[0]
    await svc.machines()
    assert route.call_count == 1  # cache 60s


@respx.mock
@pytest.mark.asyncio
async def test_machines_accepts_top_level_list():
    """Tolerante: si el upstream devolviera una lista top-level, también se parsea."""
    respx.get(f"{BASE}/api/machines").mock(return_value=Response(200, json=[MACHINE]))
    out = await _svc().machines()
    assert out[0]["code"] == "pokemon_50"


@respx.mock
@pytest.mark.asyncio
async def test_machines_cache_expira():
    route = respx.get(f"{BASE}/api/machines").mock(return_value=Response(200, json={"machines": [MACHINE]}))
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
                   "rarity": "Epic", "name": "Charizard", "image": "https://x/c.png"}


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
