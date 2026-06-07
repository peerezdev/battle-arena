import pytest
from app.pricing.base import ValueUnavailable, parse_insured_value, parse_grade


def test_parse_insured_value_rounds_half_up():
    assert parse_insured_value("125") == 125
    assert parse_insured_value("124.50") == 125
    assert parse_insured_value("124.49") == 124


def test_parse_insured_value_rejects_bad():
    for bad in [None, "", "0", "-5", "abc"]:
        with pytest.raises(ValueUnavailable):
            parse_insured_value(bad)


def test_parse_grade_ok_and_bad():
    assert parse_grade(9) == 9
    for bad in [None, 0, 11, -1]:
        with pytest.raises(ValueUnavailable):
            parse_grade(bad)
