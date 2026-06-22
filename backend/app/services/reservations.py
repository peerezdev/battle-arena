"""Reserved-balance ledger. Pure DB: a player's available balance is computed by the caller
as on-chain USDC minus reserved_total (the RPC read stays in the endpoint/wiring)."""
from __future__ import annotations
from datetime import datetime, timezone
from sqlalchemy import select, func, update
from app.models import Reservation


def reserve(session, wallet: str, battle_id: str, amount: int) -> Reservation:
    r = Reservation(wallet=wallet, battle_id=battle_id, amount=amount, status="active")
    session.add(r)
    session.commit()
    return r


def reserved_total(session, wallet: str) -> int:
    total = session.execute(
        select(func.coalesce(func.sum(Reservation.amount), 0))
        .where(Reservation.wallet == wallet, Reservation.status == "active")
    ).scalar_one()
    return int(total)


def release_reservations(session, battle_id: str) -> int:
    res = session.execute(
        update(Reservation)
        .where(Reservation.battle_id == battle_id, Reservation.status == "active")
        .values(status="released", released_at=datetime.now(timezone.utc))
    )
    session.commit()
    return res.rowcount
