"""Carga el inventario compartido de escrows a partir del pool de una red.

    cd backend
    PYTHONPATH=. .venv/bin/python3 scripts/seed_escrow_inventory.py --desde sqlite:///battlearena.db
    PYTHONPATH=. .venv/bin/python3 scripts/seed_escrow_inventory.py --desde sqlite:///battlearena.db --go

QUÉ HACE. Copia al inventario la IDENTIDAD de cada wallet de escrow —dirección y `wallet_id` de
Privy— y nada más. El estado (libre, en uso, retenida) NO se copia: depende de lo que la wallet
tenga en cada cadena, y eso lo sigue llevando `escrow_wallets` de cada red.

POR QUÉ HACE FALTA UNA VEZ. Las wallets ya existen en Privy, pero la única lista de cuáles son
escrows vive en la base de devnet. Con el inventario cargado, mainnet deja de depender de ella y
deja de crear wallets nuevas teniendo decenas hechas sin estrenar.

SE PUEDE REPETIR. Una dirección que ya esté no se duplica ni da error, así que volver a lanzarlo
tras jugar más partidas solo añade lo que falte.

NO CREA NINGUNA WALLET. No habla con Privy. Solo lee una base y escribe en el inventario.
"""
from __future__ import annotations

import argparse
import sys

from sqlalchemy import create_engine, text

from app.config import get_settings
from app.services import escrow_inventory
from scripts._destino import ruta_de


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--desde", required=True,
                    help="URL de la base de la que leer el pool (p.ej. sqlite:///battlearena.db)")
    ap.add_argument("--go", action="store_true", help="escribir de verdad (por defecto: dry-run)")
    args = ap.parse_args()

    destino = (get_settings().escrow_inventory_url or "").strip()
    if not destino:
        print("falta ESCROW_INVENTORY_URL: sin inventario configurado no hay a dónde escribir.",
              file=sys.stderr)
        return 1

    # El mismo aviso que el resto de scripts, y aquí importa el doble: una ruta relativa haría dos
    # inventarios distintos según desde dónde se lance, y dos inventarios reparten la misma wallet
    # a dos partidas.
    print(f"· origen:    {ruta_de(args.desde)}", file=sys.stderr)
    print(f"· inventario:{ruta_de(destino)}", file=sys.stderr)
    if destino.startswith("sqlite:///") and not destino.startswith("sqlite:////"):
        print("  ¡OJO! la ruta del inventario es RELATIVA al directorio actual.", file=sys.stderr)

    origen = create_engine(args.desde, future=True)
    with origen.connect() as c:
        filas = list(c.execute(text(
            "select address, wallet_id from escrow_wallets order by created_at")))
    print(f"\nescrows en el origen: {len(filas)}")
    if not filas:
        return 0

    ya = {w["address"] for w in escrow_inventory.todas()}
    nuevas = [(a, w) for a, w in filas if a not in ya]
    print(f"ya en el inventario : {len(filas) - len(nuevas)}")
    print(f"por añadir          : {len(nuevas)}")
    for a, _ in nuevas[:10]:
        print(f"   + {a}")
    if len(nuevas) > 10:
        print(f"   … y {len(nuevas) - 10} más")

    if not args.go:
        print("\n(dry-run: no se ha escrito nada — repite con --go)")
        return 0

    for a, w in nuevas:
        escrow_inventory.registrar(a, w)
    print(f"\nañadidas {len(nuevas)}. Inventario total: {len(escrow_inventory.todas())}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
