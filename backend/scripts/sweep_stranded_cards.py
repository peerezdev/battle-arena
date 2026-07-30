"""Barrido de cartas que se quedaron en el escrow y nunca llegaron a su ganador.

El settle mueve las cartas al ganador con una ventana de espera acotada. Si una carta llega al
escrow más tarde que esa ventana, el bucle se rinde, deja `transferred=0` y sigue: la batalla se
cierra y nadie se entera de que faltan cartas. Se midió que esas cartas SÍ estaban en el escrow
al consultarlas después — no se pierden, quedan pendientes.

Esto las termina de entregar. Recorre TODAS las batallas cerradas con ganador (no una fija),
comprueba on-chain dónde está cada carta y actúa según lo que encuentre:

  · en su escrow          → la transfiere a su ganador y marca transferred=1
  · ya en el ganador      → solo marca transferred=1 (llegó, pero no se registró)
  · en cualquier otro     → no la toca y lo dice: eso necesita mirarse a mano

El gas lo pone el OPERADOR (`fee_payer` + co-firma), no el escrow: al escrow le queda ~1,8M
lamports después de su batalla y crear la token account del ganador cuesta 2.039.280.

Idempotente: lo ya entregado se detecta y se salta, así que se puede repetir sin miedo.

    python scripts/sweep_stranded_cards.py                # dry-run: solo enumera
    python scripts/sweep_stranded_cards.py --go           # ejecuta de verdad
    python scripts/sweep_stranded_cards.py --battle <id>   # limita a una batalla

Con APP_NETWORK=mainnet trabaja contra mainnet (misma superposición de .env que el backend).
"""
from __future__ import annotations

import asyncio
import sys

from app.config import get_settings
from app.db import make_engine, make_session_factory
from app.models import BattlePull, PackBattle
from app.services.nft_transfer import (UnsupportedNftStandard, build_transfer, nft_in_owner,
                                       submit_signed_tx)
from app.services.pack_orchestration import fetch_latest_blockhash, sol_balance
from app.services.privy_signer import PrivySigner

GO = "--go" in sys.argv
ONLY = None
if "--battle" in sys.argv:
    ONLY = sys.argv[sys.argv.index("--battle") + 1]

# El traspaso lo paga el OPERADOR, no el escrow. Medido: crear la token account del ganador cuesta
# 2.039.280 lamports de rent, y un escrow que ya jugó su batalla llega al barrido con ~1,8M — se
# queda corto justo por ahí y los 26 traspasos fallaban con `insufficient lamports … need 2039280`.
# Con `fee_payer=operator` + co-firma del operador (mismo patrón que refund.py) el saldo del escrow
# deja de importar: solo firma como dueño de la carta.
MIN_LAMPORTS = 2_100_000


def _log(m: str = "") -> None:
    print(m, flush=True)


def _pendientes(s, only: str | None):
    """Cartas sin entregar de batallas CERRADAS y con ganador.

    Se excluyen las anuladas y canceladas a propósito: ahí no hay ganador a quien entregar — esas
    van por el camino del reembolso, que es otro problema.
    """
    q = (s.query(BattlePull, PackBattle)
         .join(PackBattle, PackBattle.id == BattlePull.battle_id)
         .filter(BattlePull.nft_address.isnot(None),
                 BattlePull.transferred == False,   # noqa: E712  (SQLAlchemy)
                 BattlePull.auto_sold == False,      # noqa: E712
                 BattlePull.refunded == False,       # noqa: E712
                 PackBattle.status == "settled",
                 PackBattle.winner.isnot(None)))
    if only:
        q = q.filter(PackBattle.id == only)
    return q.all()


async def _entregar(s, st, signer, pull, battle) -> str:
    """Devuelve qué se hizo con esta carta: 'entregada' | 'ya-estaba' | 'fuera' | 'error'."""
    mint, esc, winner = pull.nft_address, battle.escrow_address, battle.winner

    if await nft_in_owner(st.solana_rpc_url, winner, mint):
        # Llegó en su día pero no se registró: basta con anotarlo, sin mover nada ni gastar gas.
        if GO:
            pull.transferred = True
            s.commit()
        return "ya-estaba"

    if not await nft_in_owner(st.solana_rpc_url, esc, mint):
        return "fuera"

    if not GO:
        return "entregada"      # en dry-run se cuenta como entregable

    try:
        bh = await fetch_latest_blockhash(st.solana_rpc_url)
        tx = await build_transfer(st.solana_rpc_url, esc, winner, mint, bh,
                                  fee_payer=st.privy_operator_address)
        signed = await signer.sign_solana(battle.escrow_wallet_id, tx)      # dueño de la carta
        signed = await signer.sign_solana(st.privy_operator_wallet_id, signed)  # paga rent y fee
        await submit_signed_tx(st.solana_rpc_url, signed)
        pull.transferred = True
        s.commit()               # por carta: un fallo más adelante no pierde lo ya hecho
        return "entregada"
    except UnsupportedNftStandard as exc:
        _log(f"      estándar no soportado: {exc}")
        return "error"
    except Exception as exc:
        _log(f"      falló: {exc}")
        return "error"


async def main() -> None:
    st = get_settings()
    s = make_session_factory(make_engine(st.database_url))()
    signer = PrivySigner(app_id=st.privy_app_id, app_secret=st.privy_app_secret,
                         auth_key_pem=st.privy_auth_key, cluster_caip2=st.privy_solana_caip2)

    _log("MODO: " + ("EJECUCIÓN REAL" if GO else "dry-run (nada se mueve)"))
    _log(f"RPC:  {st.solana_rpc_url.split('api-key')[0]}")
    _log(f"BASE: {st.database_url}")

    filas = _pendientes(s, ONLY)
    if not filas:
        _log("\nNo hay cartas pendientes. Nada que hacer.")
        return

    # Por batalla, para comprobar el gas del escrow una sola vez por cada una.
    por_batalla: dict[str, list] = {}
    batallas: dict[str, PackBattle] = {}
    for pull, battle in filas:
        por_batalla.setdefault(battle.id, []).append(pull)
        batallas[battle.id] = battle

    _log(f"\n{len(filas)} cartas pendientes en {len(por_batalla)} batallas\n")
    total = {"entregada": 0, "ya-estaba": 0, "fuera": 0, "error": 0}

    # El gas sale del operador, así que se mira su saldo UNA vez: si no llega para todas, mejor
    # saberlo antes de dejar la mitad entregada.
    op_lam = await sol_balance(st.solana_rpc_url, st.privy_operator_address)
    necesario = MIN_LAMPORTS * len(filas)
    _log(f"  operador {st.privy_operator_address[:8]}…  {op_lam/1e9:.4f} SOL"
         f"  (hacen falta ~{necesario/1e9:.4f} para las {len(filas)})\n")
    if op_lam < necesario and GO:
        _log("  El operador no tiene SOL para todas: fondéalo antes de seguir.")
        return

    for bid, pulls in por_batalla.items():
        b = batallas[bid]
        _log(f"  batalla {bid[:12]}…  ganador {b.winner[:8]}…  {len(pulls)} cartas")

        for pull in pulls:
            r = await _entregar(s, st, signer, pull, b)
            total[r] += 1
            marca = {"entregada": "→ ganador", "ya-estaba": "ya la tenía",
                     "fuera": "NO está en el escrow", "error": "error"}[r]
            _log(f"    {pull.nft_address[:12]}…  {marca}")
        _log()

    _log("─" * 52)
    verbo = "entregadas" if GO else "entregables"
    _log(f"  {verbo:<22} {total['entregada']:>4}")
    _log(f"  {'ya las tenía el ganador':<22} {total['ya-estaba']:>4}")
    _log(f"  {'fuera del escrow':<22} {total['fuera']:>4}   ← requieren mirarse a mano")
    _log(f"  {'errores':<22} {total['error']:>4}")
    if not GO:
        _log("\n  Nada se ha movido. Repite con --go para ejecutar.")


if __name__ == "__main__":
    asyncio.run(main())
