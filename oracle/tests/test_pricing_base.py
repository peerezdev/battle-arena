import pytest
from app.pricing.base import ValueUnavailable, parse_insured_value, parse_grade


def test_parse_insured_value_rounds_half_up():
    assert parse_insured_value("125") == 125
    assert parse_insured_value("124.50") == 125
    assert parse_insured_value("124.49") == 124
    assert parse_insured_value("0.5") == 1  # half-up, positivo -> aceptado


def test_parse_insured_value_rejects_bad():
    for bad in [None, "", "0", "-5", "abc"]:
        with pytest.raises(ValueUnavailable):
            parse_insured_value(bad)


def test_parse_insured_value_rejects_overflow_u64():
    with pytest.raises(ValueUnavailable):
        parse_insured_value("99999999999999999999999999")


def test_parse_grade_ok_and_bad():
    assert parse_grade(9) == 9
    # bool es subclase de int en Python (True == 1): el guard debe rechazarlos
    for bad in [None, 0, 11, -1, True, False]:
        with pytest.raises(ValueUnavailable):
            parse_grade(bad)
