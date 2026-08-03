"""Reserved-balance ledger. Pure DB: a player's available balance is computed by the caller
as on-chain USDC minus reserved_total (the RPC read stays in the endpoint/wiring)."""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import select, func, update, and_, or_
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
# Una partida en la que el dinero del jugador todavía tiene destino: apuntado y esperando, o
# jugándose. Lo usan royale_locked_total (para enseñarlo) y battle_in_progress (para cerrar el
# retiro). Deliberadamente el mismo par: si algún día se añade un estado intermedio, los dos
# tienen que enterarse a la vez.
_EN_JUEGO = ("lobby", "running")


def royale_locked_total(session, wallet: str) -> int:
    """USDC (base units) this wallet has locked in OPEN royales — buy-ins already collected on-chain
    into escrow. Unlike pack-battle reservations, this money has ALREADY left the wallet's on-chain
    balance, so it must NOT be subtracted from available a second time. It's for display only:
    surfaced alongside reserved_total so the user sees every battle their funds are tied up in."""
    from app.services.royale_funding import royale_buyin  # lazy: keeps solana deps out of module load
    battles = session.execute(
        select(PackBattle.id, PackBattle.max_players, PackBattle.price)
        .where(PackBattle.mode == "royale", PackBattle.status.in_(_EN_JUEGO))
    ).all()
    if not battles:
        return 0
    ids = [b.id for b in battles]
    joined = set(session.execute(
        select(BattlePlayer.battle_id)
        .where(BattlePlayer.player_wallet == wallet, BattlePlayer.battle_id.in_(ids))
    ).scalars().all())
    return sum(royale_buyin(b.max_players, b.price) for b in battles if b.id in joined)


def battle_in_progress(session, wallet: str) -> Optional[str]:
    """Id de una partida de este wallet cuyo dinero está EXPUESTO, o None si no hay ninguna.

    Cierra el retiro solo mientras haga falta de verdad, y eso depende del modo, porque el dinero
    vive en sitios distintos:

      · pack, en `lobby` o `running` → el buy-in SIGUE en la wallet del jugador, cubierto por una
        reserva (`reserve()` en crear/unirse). Se bloquea igualmente: es el importe con el que va
        a pagar su caja, y dejarlo salir convierte la tirada en un fallo y la partida en anulada.

      · royale, en `running` → aquí está el agujero que cerró esta guarda. El escrow le manda a la
        wallet el precio de cada caja JUSTO ANTES de tirar, y ese importe no lleva reserva: el
        buy-in ya salió al entrar al lobby, así que no hay hold que lo cubra. Sin esto, quien
        sondeara su wallet lo sacaría en la ventana entre el reparto y la tirada — la tirada
        fallaría, la partida se anularía y el escrow quedaría corto justo por esa cantidad. Ese
        agujero no lo paga la plataforma: lo pagan los reembolsos de los DEMÁS jugadores.

      · royale, en `lobby` → NO se bloquea. El buy-in ya está en el escrow y todavía no ha habido
        ningún reparto, así que lo que le queda en la wallet es suyo y no tiene destino. Antes se
        bloqueaba también este caso, y era de más: un jugador esperando a que se llene una royale
        se quedaba sin poder tocar su propio dinero, a veces durante horas.
    """
    expuesta = or_(
        and_(PackBattle.mode != "royale", PackBattle.status.in_(_EN_JUEGO)),
        and_(PackBattle.mode == "royale", PackBattle.status == "running"),
    )
    return session.execute(
        select(PackBattle.id)
        .join(BattlePlayer, BattlePlayer.battle_id == PackBattle.id)
        .where(BattlePlayer.player_wallet == wallet, expuesta)
        .limit(1)
    ).scalars().first()


def release_reservations(session, battle_id: str) -> int:
    res = session.execute(
        update(Reservation)
        .where(Reservation.battle_id == battle_id, Reservation.status == "active")
        .values(status="released", released_at=datetime.now(timezone.utc))
    )
    session.commit()
    return res.rowcount
