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


def consume(session, wallet: str, battle_id: str, amount: int) -> int:
    """Gasta parte del hold porque ese dinero ACABA DE SALIR de la wallet on-chain.

    Las tiradas las paga la wallet del jugador, caja a caja, así que su saldo on-chain baja
    durante la partida. El hold solo tiene sentido mientras el dinero sigue dentro: si se
    mantuviera entero, `disponible = on-chain − reservado` restaría lo mismo dos veces y el
    jugador vería evaporarse el importe de la partida sin haberla perdido (y no podría
    gastarlo, porque `_require_available` hace esa misma cuenta).

    Devuelve lo realmente consumido. Nunca baja de cero, y al vaciarse marca la fila
    `released` para que un `release_reservations` posterior sea un no-op limpio.
    """
    rows = session.execute(
        select(Reservation)
        .where(Reservation.wallet == wallet, Reservation.battle_id == battle_id,
               Reservation.status == "active")
        .order_by(Reservation.id)
    ).scalars().all()
    pendiente, gastado = max(0, int(amount)), 0
    for r in rows:
        if pendiente <= 0:
            break
        corte = min(r.amount, pendiente)
        r.amount -= corte
        pendiente -= corte
        gastado += corte
        if r.amount <= 0:
            r.status = "released"
            r.released_at = datetime.now(timezone.utc)
    session.commit()
    return gastado


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
