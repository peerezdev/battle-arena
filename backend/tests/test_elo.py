from app.elo import expected_score, updated_ratings, gap_label


def test_expected_even():
    assert abs(expected_score(1200, 1200) - 0.5) < 1e-9


def test_update_even_win():
    # 1200 vs 1200, gana A (score 1), K=32 -> +16 / -16
    new_a, new_b = updated_ratings(1200, 1200, 1.0, k=32)
    assert new_a == 1216 and new_b == 1184


def test_update_draw():
    new_a, new_b = updated_ratings(1200, 1200, 0.5, k=32)
    assert new_a == 1200 and new_b == 1200


def test_update_upset_favours_underdog():
    # underdog (1000) vence al favorito (1400): el underdog sube mucho
    new_u, new_fav = updated_ratings(1000, 1400, 1.0, k=32)
    assert new_u > 1000 and new_fav < 1400
    assert (new_u - 1000) > 16  # gana más que en un combate parejo


def test_gap_label_thresholds():
    assert gap_label(0) == "parejo"
    assert gap_label(99) == "parejo"
    assert gap_label(100) == "notable"
    assert gap_label(-250) == "notable"
    assert gap_label(301) == "gran diferencia"
