"""Saca el USDC que se quedó atascado en escrows y lo manda a quien le toca.

El barrido del settle leía el saldo una sola vez y, si en ese instante estaba a cero, se rendía. El
USDC de las auto-ventas lo ingresa Collector Crypt de forma asíncrona, así que llegar tarde es lo
normal: lo que aterrizaba después se quedaba dentro y nadie volvía a mirar. Medido en devnet: 24
escrows retenían dinero, uno con $3.500. El código ya está arreglado (reintenta y hace una segunda
pasada tras el bucle de cartas); esto recupera lo que quedó atrás antes del arreglo.

A dónde va el dinero, según cómo acabó la partida:

  · settled con ganador   → entero al ganador, que es de quien era el bote
  · voided / cancelled    → el buy-in de vuelta a cada jugador que se apuntó

Paga el operador (fee-payer + co-firma): un escrow cancelado antes de arrancar no tiene SOL.

    python scripts/recover_escrow_usdc.py          # dry-run: solo dice qué haría
    python scripts/recover_escrow_usdc.py --go     # ejecuta

Con APP_NETWORK=mainnet trabaja contra mainnet.
"""
from __future__ import annotations

import asyncio
import sys

from app.config import get_settings
from app.db import make_engine, make_session_factory
from app.models import BattlePlayer, EscrowWallet, PackBattle
from app.services.escrow_pool import EstadoDesconocido, contenido
from app.services.nft_transfer import sin_secretos, submit_signed_tx
from app.services.pack_orchestration import fetch_latest_blockhash
from app.services.privy_signer import PrivySigner
from app.services.royale_funding import refund_buyin, royale_buyin
from app.services.solana_tx import build_token_transfer
from scripts._destino import anunciar

GO = "--go" in sys.argv


def _log(m: str = "") -> None:
    print(m, flush=True)


async def _mandar(st, signer, escrow, escrow_wallet_id, destino, base_units) -> str:
    """escrow → destino. El operador paga la fee porque el escrow puede no tener SOL."""
    bh = await fetch_latest_blockhash(st.solana_rpc_url)
    return await refund_buyin(st.solana_rpc_url, signer, escrow_wallet_id, escrow,
                              st.privy_operator_wallet_id, st.privy_operator_address,
                              destino, st.cc_usdc_mint, base_units, bh)


async def main() -> None:
    st = get_settings()
    anunciar(st)
    s = make_session_factory(make_engine(st.database_url))()
    signer = PrivySigner(app_id=st.privy_app_id, app_secret=st.privy_app_secret,
                         auth_key_pem=st.privy_auth_key, cluster_caip2=st.privy_solana_caip2)

    _log("MODO: " + ("EJECUCIÓN REAL" if GO else "dry-run (no se mueve nada)"))
    _log(f"BASE: {st.database_url}\n")

    retenidos = (s.query(EscrowWallet)
                 .filter(EscrowWallet.status == "retained")
                 .filter(EscrowWallet.unavailable_reason.like("%USDC%")).all())
    if not retenidos:
        _log("No hay escrows retenidos con USDC. Nada que hacer.")
        return

    total_movido = 0
    sin_destino = []
    for fila in retenidos:
        b = s.query(PackBattle).filter_by(escrow_address=fila.address).first()
        if b is None:
            sin_destino.append((fila.address, "sin batalla en la base"))
            continue

        # El saldo se relee AHORA: unavailable_reason es una foto de cuando se censó.
        try:
            _, usdc = await contenido(st.solana_rpc_url, fila.address, st.cc_usdc_mint)
        except EstadoDesconocido as exc:
            _log(f"  {fila.address[:12]}…  no se pudo leer el saldo: {sin_secretos(exc)}")
            continue
        if usdc <= 0:
            _log(f"  {fila.address[:12]}…  ya está a cero, nada que mover")
            continue

        if b.status == "settled" and b.winner:
            destinos = [(b.winner, usdc)]
            que = f"al ganador {b.winner[:8]}…"
        elif b.status in ("voided", "cancelled"):
            jugadores = [p.player_wallet for p in
                         s.query(BattlePlayer).filter_by(battle_id=b.id)
                         .order_by(BattlePlayer.joined_at).all()]
            if not jugadores:
                sin_destino.append((fila.address, f"{b.status} sin jugadores apuntados"))
                continue
            cuota = royale_buyin(b.max_players, b.price) if b.mode == "royale" else b.price
            # SOLO se reparte cuando el saldo es exactamente el buy-in de todos los apuntados, o
            # sea cuando está claro que no se reembolsó a nadie.
            #
            # Si el saldo es menor, alguien ya cobró y NO hay forma de saber quién: el reembolso del
            # buy-in de royale no deja registro por jugador (la tabla reservations está vacía en
            # estas partidas). Repartir por orden de llegada pagaría dos veces a quien ya cobró y
            # dejaría al que falta igual de sin cobrar. Medido: una voided de 4 jugadores retiene
            # justo un buy-in. Eso se mira en el histórico on-chain del escrow, no se adivina aquí.
            esperado = cuota * len(jugadores)
            if usdc != esperado:
                sin_destino.append((
                    fila.address,
                    f"{b.status}: hay {usdc / 1e6:.2f} y {len(jugadores)} jugadores × "
                    f"{cuota / 1e6:.2f} = {esperado / 1e6:.2f}. Alguien ya cobró y no consta quién; "
                    f"hace falta el histórico on-chain del escrow"))
                continue
            destinos = [(pw, cuota) for pw in jugadores]
            que = f"{cuota / 1e6:.2f} a cada uno de los {len(jugadores)} jugadores"
        else:
            sin_destino.append((fila.address, f"estado {b.status}: no sé a quién dárselo"))
            continue

        _log(f"  {fila.address[:12]}…  {b.status:<10} {usdc / 1e6:>10,.2f} USDC → {que}")
        if not GO:
            continue
        for destino, cantidad in destinos:
            try:
                sig = await _mandar(st, signer, fila.address, fila.wallet_id, destino, cantidad)
                total_movido += cantidad
                _log(f"      {cantidad / 1e6:>10,.2f} → {destino[:8]}…  ok ({sig[:16]}…)")
            except Exception as exc:
                _log(f"      {cantidad / 1e6:>10,.2f} → {destino[:8]}…  FALLÓ: {sin_secretos(exc)}")

    _log("\n" + "─" * 60)
    if sin_destino:
        _log("  Sin destino claro (hay que decidirlo a mano):")
        for addr, por_que in sin_destino:
            _log(f"    {addr[:12]}…  {por_que}")
    if GO:
        _log(f"\n  movido: {total_movido / 1e6:,.2f} USDC")
        _log("  Repite scripts/escrow_pool_sync.py para que los escrows vacíos vuelvan al pool.")
    else:
        _log("\n  Nada se ha movido. Repite con --go para ejecutar.")


if __name__ == "__main__":
    asyncio.run(main())
