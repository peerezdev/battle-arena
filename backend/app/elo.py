from __future__ import annotations


def expected_score(rating_a: int, rating_b: int) -> float:
    return 1.0 / (1.0 + 10 ** ((rating_b - rating_a) / 400.0))


def updated_ratings(rating_a: int, rating_b: int, score_a: float, k: int = 32) -> tuple[int, int]:
    """score_a: 1.0 gana A, 0.0 gana B, 0.5 empate. Devuelve (nuevo_a, nuevo_b)."""
    ea = expected_score(rating_a, rating_b)
    eb = 1.0 - ea
    score_b = 1.0 - score_a
    new_a = round(rating_a + k * (score_a - ea))
    new_b = round(rating_b + k * (score_b - eb))
    return new_a, new_b


def gap_label(diff: int) -> str:
    d = abs(diff)
    if d < 100:
        return "parejo"
    if d <= 300:
        return "notable"
    return "gran diferencia"
