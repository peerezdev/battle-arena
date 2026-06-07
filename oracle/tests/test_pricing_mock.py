import pytest
from app.pricing.mock import MockPricingSource
from app.pricing.base import ValueUnavailable


async def test_mock_deterministic():
    src = MockPricingSource()
    a = await src.get_value("MintAAA")
    b = await src.get_value("MintAAA")
    assert a == b
    assert a["value_usd"] > 0
    assert 1 <= a["grade"] <= 10
    assert a["mint"] == "MintAAA"


async def test_mock_overrides():
    src = MockPricingSource(overrides={"X": {"value_usd": 5000, "grade": 10, "grading_company": "PSA"}})
    v = await src.get_value("X")
    assert v["value_usd"] == 5000 and v["grade"] == 10


async def test_mock_unavailable():
    src = MockPricingSource(unavailable={"NOPE"})
    with pytest.raises(ValueUnavailable):
        await src.get_value("NOPE")
