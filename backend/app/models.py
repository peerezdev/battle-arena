from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, Integer, Boolean, DateTime, Index, func, Float
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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    __table_args__ = (
        Index("ux_users_alias_lower", func.lower(alias), unique=True),
    )


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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    settled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class RatingHistory(Base):
    __tablename__ = "rating_history"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    wallet: Mapped[str] = mapped_column(String, index=True)
    battle_pubkey: Mapped[str] = mapped_column(String)
    elo_before: Mapped[int] = mapped_column(Integer)
    elo_after: Mapped[int] = mapped_column(Integer)
    result: Mapped[str] = mapped_column(String)  # win|loss|draw
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class GachaPack(Base):
    __tablename__ = "gacha_packs"
    memo: Mapped[str] = mapped_column(String, primary_key=True)
    wallet: Mapped[str] = mapped_column(String, index=True)
    pack_type: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    opened_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    nft_address: Mapped[Optional[str]] = mapped_column(String, nullable=True)


class PackBattle(Base):
    __tablename__ = "pack_battles"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    mode: Mapped[str] = mapped_column(String)  # pack|royale
    machine_code: Mapped[str] = mapped_column(String)
    price: Mapped[int] = mapped_column(Integer)  # USDC base units
    max_players: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String, default="lobby", index=True)  # lobby|running|settled|voided
    winner: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    creator_wallet: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    escrow_wallet_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    escrow_address: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    server_seed: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    server_seed_hash: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    client_seed: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    tie_break_index: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    settled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class BattlePlayer(Base):
    __tablename__ = "battle_players"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    battle_id: Mapped[str] = mapped_column(String, index=True)
    player_wallet: Mapped[str] = mapped_column(String, index=True)
    wallet_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    eliminated_round: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    accumulated_value: Mapped[float] = mapped_column(Float, default=0.0)


class BattlePull(Base):
    __tablename__ = "battle_pulls"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    battle_id: Mapped[str] = mapped_column(String, index=True)
    player_wallet: Mapped[str] = mapped_column(String, index=True)
    memo: Mapped[str] = mapped_column(String)
    nft_address: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    insured_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    grade: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    rarity: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    year: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    auto_sold: Mapped[bool] = mapped_column(Boolean, default=False)
    transferred: Mapped[bool] = mapped_column(Boolean, default=False)
    buyback_amount: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    round_number: Mapped[int] = mapped_column(Integer, default=1)


class BattlePack(Base):
    __tablename__ = "battle_packs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    battle_id: Mapped[str] = mapped_column(String, index=True)
    machine_code: Mapped[str] = mapped_column(String)
    price: Mapped[int] = mapped_column(Integer)   # USDC base units, per box
    sequence: Mapped[int] = mapped_column(Integer)  # 1..N order within the bundle


class BattleRound(Base):
    __tablename__ = "battle_rounds"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    battle_id: Mapped[str] = mapped_column(String, index=True)
    round_number: Mapped[int] = mapped_column(Integer)
    client_seed: Mapped[str] = mapped_column(String)
    eliminated_wallet: Mapped[str] = mapped_column(String)
    tie_break_index: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)


class Reservation(Base):
    __tablename__ = "reservations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    wallet: Mapped[str] = mapped_column(String, index=True)
    battle_id: Mapped[str] = mapped_column(String, index=True)
    amount: Mapped[int] = mapped_column(Integer)   # USDC base units
    status: Mapped[str] = mapped_column(String, default="active", index=True)  # active|released
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    released_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
