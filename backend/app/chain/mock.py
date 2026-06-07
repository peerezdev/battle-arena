from __future__ import annotations

from typing import Optional
from .base import BattleState, BattleNotFound


class MockChainSource:
    """ChainSource en memoria para dev/tests."""

    def __init__(self) -> None:
        self._battles: dict[str, BattleState] = {}

    def set_battle(self, battle: str, player_a: str, stake: int) -> None:
        self._battles[battle] = {
            "battle": battle, "player_a": player_a, "player_b": None,
            "stake": stake, "phase": "Created", "winner": None, "is_draw": False,
        }

    def join(self, battle: str, player_b: str) -> None:
        if battle not in self._battles:
            raise BattleNotFound(battle)
        b = self._battles[battle]
        b["player_b"] = player_b
        b["phase"] = "Committing"

    def settle(self, battle: str, winner: Optional[str] = None, is_draw: bool = False) -> None:
        if battle not in self._battles:
            raise BattleNotFound(battle)
        b = self._battles[battle]
        b["phase"] = "Settled"
        b["winner"] = winner
        b["is_draw"] = is_draw

    async def get_battle(self, battle: str) -> BattleState:
        if battle not in self._battles:
            raise BattleNotFound(battle)
        return dict(self._battles[battle])  # copia defensiva
