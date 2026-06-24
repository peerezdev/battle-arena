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
                "gimmighouls": 0, "referred_by": None}
    return {"wallet": u.wallet, "alias": u.alias, "elo": u.elo, "games_played": u.games_played,
            "gimmighouls": u.gimmighouls, "referred_by": u.referred_by}


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
