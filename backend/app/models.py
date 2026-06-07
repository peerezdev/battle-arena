from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, Integer, Boolean, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    wallet: Mapped[str] = mapped_column(String, primary_key=True)
    alias: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    elo: Mapped[int] = mapped_column(Integer, default=1200)
    games_played: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class Match(Base):
    __tablename__ = "matches"
    battle_pubkey: Mapped[str] = mapped_column(String, primary_key=True)
    creator: Mapped[str] = mapped_column(String, index=True)
    opponent: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    stake: Mapped[int] = mapped_column(Integer)
    min_elo: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    max_elo: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String, default="open", index=True)  # open|joined|settled
    winner: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    is_draw: Mapped[bool] = mapped_column(Boolean, default=False)
    elo_applied: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    settled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class RatingHistory(Base):
    __tablename__ = "rating_history"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    wallet: Mapped[str] = mapped_column(String, index=True)
    battle_pubkey: Mapped[str] = mapped_column(String)
    elo_before: Mapped[int] = mapped_column(Integer)
    elo_after: Mapped[int] = mapped_column(Integer)
    result: Mapped[str] = mapped_column(String)  # win|loss|draw
    ts: Mapped[datetime] = mapped_column(DateTime, default=_now)
