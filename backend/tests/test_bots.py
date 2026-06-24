import random

from app.services.bots import eligible_bots, pick_bot

BOTS = [{"id": "i1", "address": "A"}, {"id": "i2", "address": "B"}, {"id": "i3", "address": "C"}]


def test_eligible_excludes_in_battle_and_underfunded():
    bals = {"A": 300_000_000, "B": 60_000_000, "C": 0}
    elig = eligible_bots(BOTS, in_battle={"A"}, balances=bals, min_units=50_000_000)
    # A excluded (already in battle), C excluded (0 < min), only B qualifies
    assert [b["address"] for b in elig] == ["B"]


def test_pick_bot_none_when_nobody_funded():
    bals = {"A": 0, "B": 0, "C": 0}
    assert pick_bot(BOTS, set(), bals, 50_000_000) is None


def test_pick_bot_returns_an_eligible_one():
    bals = {"A": 100_000_000, "B": 0, "C": 100_000_000}
    b = pick_bot(BOTS, set(), bals, 50_000_000, rng=random.Random(0))
    assert b is not None and b["address"] in {"A", "C"}
