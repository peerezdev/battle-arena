import pytest
from app.chain.mock import MockChainSource
from app.chain.base import BattleNotFound


async def test_get_battle_found():
    src = MockChainSource()
    src.set_battle("B1", player_a="WALLET_A", stake=100)
    b = await src.get_battle("B1")
    assert b["player_a"] == "WALLET_A" and b["phase"] == "Created" and b["player_b"] is None


async def test_get_battle_missing():
    src = MockChainSource()
    with pytest.raises(BattleNotFound):
        await src.get_battle("NOPE")


async def test_advance_joined_and_settled():
    src = MockChainSource()
    src.set_battle("B1", player_a="A", stake=100)
    src.join("B1", player_b="B")
    assert (await src.get_battle("B1"))["player_b"] == "B"
    src.settle("B1", winner="A")
    b = await src.get_battle("B1")
    assert b["phase"] == "Settled" and b["winner"] == "A" and b["is_draw"] is False
