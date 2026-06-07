from typing import Optional, Protocol, TypedDict


class BattleNotFound(Exception):
    pass


class BattleState(TypedDict):
    battle: str
    player_a: str
    player_b: Optional[str]
    stake: int
    phase: str                # 'Created'|'Committing'|'Revealing'|'RoundResolved'|'Settled'|'Closed'
    winner: Optional[str]     # wallet ganadora o None
    is_draw: bool


class ChainSource(Protocol):
    async def get_battle(self, battle: str) -> BattleState: ...
