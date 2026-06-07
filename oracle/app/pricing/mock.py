import hashlib
from typing import Optional
from .base import CardValue, PricingSource, ValueUnavailable


class MockPricingSource(PricingSource):
    """Valores deterministas derivados del mint. Para dev/tests sin red."""

    def __init__(self, overrides: Optional[dict] = None, unavailable: Optional[set] = None):
        self._overrides = overrides or {}
        self._unavailable = unavailable or set()

    async def get_value(self, mint: str) -> CardValue:
        if mint in self._unavailable:
            raise ValueUnavailable(f"mock: {mint} no disponible")
        if mint in self._overrides:
            o = self._overrides[mint]
            return {"mint": mint, "value_usd": o["value_usd"], "grade": o["grade"],
                    "grading_company": o.get("grading_company", "PSA")}
        h = hashlib.sha256(mint.encode()).digest()
        value = 100 + (int.from_bytes(h[:4], "big") % 100_000)  # 100..100099
        grade = 7 + (h[4] % 4)  # 7..10
        return {"mint": mint, "value_usd": value, "grade": grade, "grading_company": "PSA"}
