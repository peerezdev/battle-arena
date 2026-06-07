import json
import os
import httpx
import respx
import pytest
from app.pricing.collector_crypt import CollectorCryptSource, _extract_card, _items_from_payload
from app.pricing.base import ValueUnavailable

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "cc_card_sample.json")
MINT_OK = "4zckiFu3N1kbJyZpqks8Qw1TW8bQ69eDDcyi1Qx9pJW"


def _payload():
    with open(FIX) as f:
        return json.load(f)


def test_extract_exact_match_and_value():
    items = _items_from_payload(_payload())
    card = _extract_card(items, MINT_OK)
    assert card["value_usd"] == 1200
    assert card["grade"] == 9
    assert card["grading_company"] == "PSA"
    assert card["mint"] == MINT_OK


def test_extract_rejects_when_no_insured_value():
    items = _items_from_payload(_payload())
    with pytest.raises(ValueUnavailable):
        _extract_card(items, "9xxOTHERmintADDRESSxxxxxxxxxxxxxxxxxxxxxxxxx")


def test_extract_rejects_when_mint_absent():
    items = _items_from_payload(_payload())
    with pytest.raises(ValueUnavailable):
        _extract_card(items, "NONEXISTENTMINT")


@respx.mock
async def test_get_value_calls_api():
    route = respx.get("https://api.collectorcrypt.com/marketplace").mock(
        return_value=httpx.Response(200, json=_payload())
    )
    src = CollectorCryptSource(base_url="https://api.collectorcrypt.com", cache_ttl=0)
    v = await src.get_value(MINT_OK)
    assert v["value_usd"] == 1200 and v["grade"] == 9
    assert route.called
    assert route.calls.last.request.url.params["search"] == MINT_OK


def test_extract_no_fallback_to_listing_price():
    items = _items_from_payload(_payload())
    with pytest.raises(ValueUnavailable):
        _extract_card(items, "3LISTINGonlyMINTxxxxxxxxxxxxxxxxxxxxxxxxxxxx")


@respx.mock
async def test_get_value_caches_within_ttl():
    route = respx.get("https://api.collectorcrypt.com/marketplace").mock(
        return_value=httpx.Response(200, json=_payload())
    )
    src = CollectorCryptSource(base_url="https://api.collectorcrypt.com", cache_ttl=300)
    a = await src.get_value(MINT_OK)
    b = await src.get_value(MINT_OK)
    assert a == b
    assert route.call_count == 1  # segunda llamada servida desde caché
