"""Reserved-balance ledger. Pure DB: a player's available balance is computed by the caller
as on-chain USDC minus reserved_total (the RPC read stays in the endpoint/wiring)."""
from __future__ import annotations
from datetime import datetime, timezone
from sqlalchemy import select, func, update
from app.models import Reservation, PackBattle, BattlePlayer


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


# Open royales hold the buy-in in escrow (already collected on-chain), so they are NOT in the
# reservation ledger above. Funds are released only once the battle settles or voids.
_OPEN_ROYALE_STATUSES = ("lobby", "running")


def royale_locked_total(session, wallet: str) -> int:
    """USDC (base units) this wallet has locked in OPEN royales — buy-ins already collected on-chain
    into escrow. Unlike pack-battle reservations, this money has ALREADY left the wallet's on-chain
    balance, so it must NOT be subtracted from available a second time. It's for display only:
    surfaced alongside reserved_total so the user sees every battle their funds are tied up in."""
    from app.services.royale_funding import royale_buyin  # lazy: keeps solana deps out of module load
    battles = session.execute(
        select(PackBattle.id, PackBattle.max_players, PackBattle.price)
        .where(PackBattle.mode == "royale", PackBattle.status.in_(_OPEN_ROYALE_STATUSES))
    ).all()
    if not battles:
        return 0
    ids = [b.id for b in battles]
    joined = set(session.execute(
        select(BattlePlayer.battle_id)
        .where(BattlePlayer.player_wallet == wallet, BattlePlayer.battle_id.in_(ids))
    ).scalars().all())
    return sum(royale_buyin(b.max_players, b.price) for b in battles if b.id in joined)


def release_reservations(session, battle_id: str) -> int:
    res = session.execute(
        update(Reservation)
        .where(Reservation.battle_id == battle_id, Reservation.status == "active")
        .values(status="released", released_at=datetime.now(timezone.utc))
    )
    session.commit()
    return res.rowcount
