from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
from typing import Optional, Protocol, TypedDict


class ValueUnavailable(Exception):
    """La carta no puede valorarse de forma segura (sin insuredValue / grade)."""


class CardValue(TypedDict):
    mint: str
    value_usd: int        # dólares enteros, > 0
    grade: int            # 1..=10
    grading_company: str  # 'PSA' | 'CGC' | 'BGS' | ''


def parse_insured_value(raw: Optional[str]) -> int:
    if raw is None or str(raw).strip() == "":
        raise ValueUnavailable("insuredValue ausente")
    try:
        d = Decimal(str(raw))
    except (InvalidOperation, ValueError):
        raise ValueUnavailable(f"insuredValue no parseable: {raw!r}")
    dollars = int(d.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if dollars <= 0:
        raise ValueUnavailable(f"insuredValue no positivo: {raw!r}")
    if dollars > 2**64 - 1:
        raise ValueUnavailable(f"insuredValue desborda u64: {raw!r}")
    return dollars


def parse_grade(raw: Optional[int]) -> int:
    if raw is None or not isinstance(raw, int) or isinstance(raw, bool):
        raise ValueUnavailable(f"grade inválido: {raw!r}")
    if raw < 1 or raw > 10:
        raise ValueUnavailable(f"grade fuera de rango: {raw!r}")
    return raw


class PricingSource(Protocol):
    async def get_value(self, mint: str) -> CardValue: ...
