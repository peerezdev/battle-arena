from __future__ import annotations

from typing import Optional
from sqlalchemy import select, desc, func
from sqlalchemy.orm import Session
from ..models import User, RatingHistory


class AliasTakenError(Exception):
    """Otro usuario ya tiene ese username (case-insensitive)."""


def read_user_view(session: Session, wallet: str, elo_start: int) -> dict:
    """Lectura sin efectos: devuelve el usuario si existe, o una vista por defecto (sin persistir)."""
    u = session.get(User, wallet)
    if u is None:
        return {"wallet": wallet, "alias": None, "elo": elo_start, "games_played": 0,
                "gimmighouls": 0, "referred_by": None, "withdraw_address": None}
    return {"wallet": u.wallet, "alias": u.alias, "elo": u.elo, "games_played": u.games_played,
            "gimmighouls": u.gimmighouls, "referred_by": u.referred_by, "withdraw_address": u.withdraw_address}


def get_or_create_user(session: Session, wallet: str, elo_start: int) -> User:
    user = session.get(User, wallet)
    if user is None:
        user = User(wallet=wallet, elo=elo_start, games_played=0)
        session.add(user)
        session.flush()
    return user


def set_alias(session: Session, wallet: str, alias: str) -> None:
    user = session.get(User, wallet)
    if user is None:
        raise ValueError("usuario no existe")
    clash = session.scalar(
        select(User).where(func.lower(User.alias) == alias.lower(), User.wallet != wallet)
    )
    if clash is not None:
        raise AliasTakenError(alias)
    user.alias = alias


def leaderboard(session: Session, limit: int = 50) -> list[User]:
    return list(session.scalars(
        select(User).order_by(desc(User.gimmighouls), desc(User.elo)).limit(limit)
    ))


def history(session: Session, wallet: str) -> list[RatingHistory]:
    return list(session.scalars(
        select(RatingHistory).where(RatingHistory.wallet == wallet).order_by(desc(RatingHistory.ts))
    ))


def read_user_stats(session: Session, wallet: str) -> dict:
    """Aggregate profile stats from settled battles + pulls. Computed on read (no schema):
    battles/wins/win_rate/total_wagered, the best single card pulled, and the biggest loot
    (combined insured value) of a battle the wallet won."""
    from ..models import PackBattle, BattlePlayer, BattlePull
    USDC = 1_000_000  # USDC base units → dollars

    battles = list(session.scalars(
        select(PackBattle)
        .join(BattlePlayer, BattlePlayer.battle_id == PackBattle.id)
        .where(BattlePlayer.player_wallet == wallet, PackBattle.status == "settled")
    ))
    n_battles = len(battles)
    wins = sum(1 for b in battles if b.winner == wallet)
    wagered_usd = sum(b.price for b in battles) / USDC

    # best hit — the single highest-value card this wallet ever pulled
    best_pull = session.scalars(
        select(BattlePull)
        .where(BattlePull.player_wallet == wallet, BattlePull.insured_value.isnot(None))
        .order_by(desc(BattlePull.insured_value)).limit(1)
    ).first()
    best_hit = None
    if best_pull is not None:
        best_hit = {"name": best_pull.name, "grade": best_pull.grade, "rarity": best_pull.rarity,
                    "year": best_pull.year, "valueUsd": best_pull.insured_value}

    # best victory — biggest combined loot (all cards) of a battle this wallet won
    best_victory = None
    for b in battles:
        if b.winner != wallet:
            continue
        loot = session.scalar(
            select(func.coalesce(func.sum(BattlePull.insured_value), 0.0))
            .where(BattlePull.battle_id == b.id)
        ) or 0.0
        if best_victory is None or loot > best_victory["amountUsd"]:
            opponents = [w for (w,) in session.execute(
                select(BattlePlayer.player_wallet)
                .where(BattlePlayer.battle_id == b.id, BattlePlayer.player_wallet != wallet)
            )]
            best_victory = {"amountUsd": loot, "mode": b.mode, "machineCode": b.machine_code,
                            "opponents": opponents}

    return {
        "wallet": wallet,
        "battles": n_battles,
        "wins": wins,
        "winRate": (wins / n_battles) if n_battles else 0.0,
        "totalWageredUsd": wagered_usd,
        "bestHit": best_hit,
        "bestVictory": best_victory,
    }


def read_user_battles(session: Session, wallet: str, limit: int = 20) -> list[dict]:
    """The wallet's most recent settled battles for the History tab. amountUsd is signed:
    a win = the battle's combined loot (all cards won); a loss = minus the entry buy-in."""
    from ..models import PackBattle, BattlePlayer, BattlePull
    USDC = 1_000_000

    battles = list(session.scalars(
        select(PackBattle)
        .join(BattlePlayer, BattlePlayer.battle_id == PackBattle.id)
        .where(BattlePlayer.player_wallet == wallet, PackBattle.status == "settled")
        .order_by(desc(PackBattle.settled_at), desc(PackBattle.created_at))
        .limit(limit)
    ))
    out = []
    for b in battles:
        won = b.winner == wallet
        if won:
            amount = session.scalar(
                select(func.coalesce(func.sum(BattlePull.insured_value), 0.0))
                .where(BattlePull.battle_id == b.id)
            ) or 0.0
        else:
            amount = -(b.price / USDC)
        cards = session.scalar(
            select(func.count()).select_from(BattlePull)
            .where(BattlePull.battle_id == b.id, BattlePull.player_wallet == wallet)
        ) or 0
        opponents = [w for (w,) in session.execute(
            select(BattlePlayer.player_wallet)
            .where(BattlePlayer.battle_id == b.id, BattlePlayer.player_wallet != wallet)
        )]
        out.append({
            "battleId": b.id, "mode": b.mode, "machineCode": b.machine_code,
            "result": "win" if won else "loss", "amountUsd": amount,
            "cards": cards, "opponents": opponents,
            "ts": (b.settled_at or b.created_at).timestamp() if (b.settled_at or b.created_at) else None,
        })
    return out


def set_withdraw_address(session: Session, wallet: str, address: Optional[str]) -> None:
    user = session.get(User, wallet)
    if user is None:
        raise ValueError("usuario no existe")
    user.withdraw_address = address
