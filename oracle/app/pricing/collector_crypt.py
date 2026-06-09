import time
from typing import Any
import httpx
from .base import CardValue, PricingSource, ValueUnavailable, parse_insured_value, parse_grade


def _items_from_payload(payload: Any) -> list:
    """La API puede envolver la lista en 'nfts'/'data' o devolverla directa."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("nfts", "data", "results", "items"):
            v = payload.get(key)
            if isinstance(v, list):
                return v
    return []


def _extract_card(items: list, mint: str) -> CardValue:
    match = next((it for it in items if it.get("nftAddress") == mint), None)
    if match is None:
        raise ValueUnavailable(f"mint no encontrado en CC: {mint}")
    value_usd = parse_insured_value(match.get("insuredValue"))   # SOLO insuredValue (decisión 1)
    grade = parse_grade(match.get("gradeNum"))
    company = match.get("gradingCompany") or ""
    return {"mint": mint, "value_usd": value_usd, "grade": grade, "grading_company": company}


class CollectorCryptSource(PricingSource):
    def __init__(self, base_url: str, cache_ttl: int = 120):
        self._base = base_url.rstrip("/")
        self._ttl = cache_ttl
        self._cache: dict[str, tuple[float, CardValue]] = {}

    async def get_value(self, mint: str) -> CardValue:
        now = time.time()
        cached = self._cache.get(mint)
        if cached and now - cached[0] < self._ttl:
            return cached[1]
        url = f"{self._base}/marketplace"
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                resp = await client.get(url, params={"search": mint},
                                        headers={"accept": "application/json"})
                resp.raise_for_status()
                if len(resp.content) > 1_048_576:  # 1 MB cap
                    raise ValueUnavailable("CC API response too large")
                payload = resp.json()
            except (httpx.HTTPError, ValueError) as e:
                raise ValueUnavailable(f"error CC API: {e}")
        card = _extract_card(_items_from_payload(payload), mint)
        if self._ttl > 0:
            self._cache[mint] = (now, card)
        return card
