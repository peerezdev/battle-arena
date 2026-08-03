"""Puebla y audita el pool de escrows a partir de las wallets que ya existen.

Hay 79 wallets de escrow creadas de partidas anteriores, una por partida y ninguna reciclada. Este
script las mete en el pool clasificándolas por lo que tienen dentro AHORA MISMO, on-chain:

  · free      → ni cartas ni USDC: reutilizable
  · in_use    → su partida sigue viva (lobby o running): no se toca
  · retained  → tiene algo dentro, con el motivo escrito

Repetirlo es seguro y sirve de auditoría: reevalúa las retenidas, así que una que se vacíe después
(por ejemplo tras completar un barrido) pasa a free sola.

Lo que NO hace: mover nada. Si un escrow tiene USDC dentro, eso es dinero que su barrido no llegó a
entregar y se reporta para mirarlo, no se reasigna.

    python scripts/escrow_pool_sync.py          # dry-run: solo informa
    python scripts/escrow_pool_sync.py --go     # escribe en la base

Con APP_NETWORK=mainnet trabaja contra mainnet.
"""
from __future__ import annotations

import asyncio
import sys

from app.config import get_settings
from app.db import make_engine, make_session_factory, init_db
from app.models import EscrowWallet, PackBattle
from app.services.escrow_pool import EstadoDesconocido, motivo_retencion
from scripts._destino import anunciar

GO = "--go" in sys.argv
VIVAS = ("lobby", "running")


def _log(m: str = "") -> None:
    print(m, flush=True)


async def main() -> None:
    st = get_settings()
    anunciar(st)
    engine = make_engine(st.database_url)
    init_db(engine)                     # crea escrow_wallets si aún no existe
    s = make_session_factory(engine)()

    _log("MODO: " + ("ESCRITURA" if GO else "dry-run (no se escribe nada)"))
    _log(f"BASE: {st.database_url}\n")

    # Una dirección puede aparecer en varias filas; interesa si ALGUNA de sus partidas sigue viva.
    por_dir: dict = {}
    for addr, wid, estado in (s.query(PackBattle.escrow_address, PackBattle.escrow_wallet_id,
                                     PackBattle.status)
                              .filter(PackBattle.escrow_address.isnot(None)).all()):
        d = por_dir.setdefault(addr, {"wallet_id": wid, "estados": []})
        d["estados"].append(estado)
        d["wallet_id"] = d["wallet_id"] or wid

    _log(f"{len(por_dir)} direcciones de escrow en el histórico")

    # Las que ya están en el pool y en uso no se re-consultan: gastar RPC en ellas no aporta.
    ya = {w.address: w for w in s.query(EscrowWallet).all()}
    sem = asyncio.Semaphore(4)          # el RPC limita; ir a lo bruto devuelve 429 = datos falsos

    async def clasificar(addr: str, info: dict):
        if any(e in VIVAS for e in info["estados"]):
            return addr, "in_use", None
        async with sem:
            try:
                motivo = await motivo_retencion(st.solana_rpc_url, addr, st.cc_usdc_mint)
            except EstadoDesconocido as exc:
                return addr, "retained", f"sin comprobar: {exc}"
            except Exception as exc:
                return addr, "retained", f"error: {exc}"
        return addr, ("retained" if motivo else "free"), motivo

    res = await asyncio.gather(*[clasificar(a, i) for a, i in por_dir.items()])

    cuenta = {"free": 0, "in_use": 0, "retained": 0}
    nuevas = actualizadas = 0
    retenidas = []
    for addr, estado, motivo in res:
        cuenta[estado] += 1
        if estado == "retained":
            retenidas.append((addr, motivo))
        if not GO:
            continue
        fila = ya.get(addr)
        if fila is None:
            s.add(EscrowWallet(address=addr, wallet_id=por_dir[addr]["wallet_id"] or "",
                               status=estado, unavailable_reason=motivo))
            nuevas += 1
        elif fila.status != "in_use" or estado == "in_use":
            # Nunca se pisa una wallet que el pool ya tiene entregada a una partida en curso.
            fila.status = estado
            fila.unavailable_reason = motivo
            actualizadas += 1
    if GO:
        s.commit()

    _log("")
    _log(f"  libres (reutilizables)  {cuenta['free']:>4}")
    _log(f"  en uso (partida viva)   {cuenta['in_use']:>4}")
    _log(f"  retenidas               {cuenta['retained']:>4}")
    if retenidas:
        _log("\n  retenidas, motivo por motivo:")
        for addr, motivo in sorted(retenidas, key=lambda t: str(t[1])):
            _log(f"    {addr[:12]}…  {motivo}")
        _log("\n  Las que digan USDC son barridos que no completaron: es dinero sin entregar.")
    if GO:
        _log(f"\n  escritas: {nuevas} nuevas, {actualizadas} actualizadas")
    else:
        _log("\n  Nada escrito. Repite con --go.")


if __name__ == "__main__":
    asyncio.run(main())
