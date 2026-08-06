"""Reconstruye la firma de compra de las tiradas anteriores a la columna `tx_signature`.

    cd backend
    PYTHONPATH=. .venv/bin/python3 scripts/backfill_pull_signatures.py          # dry-run
    PYTHONPATH=. .venv/bin/python3 scripts/backfill_pull_signatures.py --go     # escribe

POR QUÉ SE PUEDE. Cada tirada guarda su `memo`, y ese memo VIAJA dentro de la transacción de
compra (instrucción spl-memo, visible en los logs). Así que buscando en el historial de la wallet
del jugador la transacción que contiene su memo, se recupera la firma exacta. No es adivinar: el
memo es un UUID y solo puede estar en una transacción.

QUÉ DEMUESTRA esa firma. En la misma transacción van el memo de la tirada Y la firma de la wallet
del jugador. Es prueba pública y permanente de que ESE jugador compró ESE sobre, verificable en
cualquier explorador sin fiarse de nuestra base ni de Collector Crypt — que en su feed atribuye la
tirada al escrow, porque es el `altPlayerAddress`.

LÍMITE CONOCIDO. `getSignaturesForAddress` pagina hacia atrás de 1000 en 1000. Una wallet con
muchísimo movimiento puede tener la tirada más atrás de lo que se recorre; esas quedan sin firma y
se listan al final. La prueba sigue existiendo en la cadena: solo que no la hemos localizado.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from collections import defaultdict

from app.config import get_settings
from app.db import make_engine, make_session_factory, init_db
from app.models import BattlePull

PAGINAS = 5          # 5 × 1000 firmas por wallet: de sobra para el histórico actual
POR_PAGINA = 1000
PAUSA = 0.08         # no machacar el RPC; el lector de saldos ya nos dio 429 una vez


def _rpc(url: str, method: str, params: list) -> dict:
    req = urllib.request.Request(
        url, method="POST", headers={"content-type": "application/json"},
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode())
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)


def firmas_de(url: str, wallet: str) -> list[str]:
    """Todas las firmas recientes de una wallet, de la más nueva a la más vieja."""
    out: list[str] = []
    antes = None
    for _ in range(PAGINAS):
        params: list = [wallet, {"limit": POR_PAGINA}]
        if antes:
            params[1]["before"] = antes
        res = _rpc(url, "getSignaturesForAddress", params).get("result") or []
        if not res:
            break
        out.extend(s["signature"] for s in res)
        antes = res[-1]["signature"]
        time.sleep(PAUSA)
        if len(res) < POR_PAGINA:
            break
    return out


def memo_de(url: str, firma: str) -> str | None:
    """El memo que lleva esa transacción, si lleva alguno."""
    res = _rpc(url, "getTransaction",
               [firma, {"maxSupportedTransactionVersion": 0, "encoding": "jsonParsed"}]).get("result")
    if not res:
        return None
    for linea in (res.get("meta") or {}).get("logMessages") or []:
        if 'Memo (len' in linea and '"' in linea:
            return linea.split('"')[1]
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--go", action="store_true", help="escribir de verdad (por defecto: dry-run)")
    ap.add_argument("--limit", type=int, default=0, help="parar tras N tiradas (para probar)")
    args = ap.parse_args()

    s = get_settings()
    url = s.solana_rpc_url
    if not url:
        print("falta SOLANA_RPC_URL"); return 1

    # `init_db` antes de consultar, y no solo por costumbre: la columna `tx_signature` la crea
    # `_ENSURE_COLUMNS`, que solo corre al arrancar el backend. Una base traída de una máquina con
    # código anterior no la tiene, y la consulta de abajo revienta con "no such column" — que es
    # justo el caso en el que hace falta este script. Es idempotente.
    engine = make_engine(s.database_url)
    init_db(engine)
    Session = make_session_factory(engine)
    ses = Session()
    pendientes = (ses.query(BattlePull)
                  .filter(BattlePull.tx_signature.is_(None))
                  .order_by(BattlePull.player_wallet, BattlePull.id).all())
    if args.limit:
        pendientes = pendientes[: args.limit]
    print(f"tiradas sin firma: {len(pendientes)}")
    if not pendientes:
        return 0

    # Agrupadas por wallet: el historial se pide UNA vez por jugador, no una por tirada.
    por_wallet: dict[str, list[BattlePull]] = defaultdict(list)
    for p in pendientes:
        por_wallet[p.player_wallet].append(p)
    print(f"wallets a recorrer: {len(por_wallet)}\n")

    encontradas = fallidas = 0
    sin_localizar: list[tuple[str, str]] = []
    for wallet, tiradas in por_wallet.items():
        buscados = {t.memo: t for t in tiradas if t.memo}
        sigs = firmas_de(url, wallet)
        print(f"{wallet[:6]}…{wallet[-4:]}  {len(tiradas):>4} tiradas · {len(sigs):>5} tx en la cadena", end="", flush=True)
        for firma in sigs:
            if not buscados:
                break
            m = memo_de(url, firma)
            time.sleep(PAUSA)
            if not m:
                continue
            # El memo on-chain lleva sufijo (":open"); el nuestro es el prefijo.
            base = m.split(":")[0]
            t = buscados.pop(base, None)
            if t is not None:
                t.tx_signature = firma
                encontradas += 1
        fallidas += len(buscados)
        sin_localizar.extend((wallet, m) for m in buscados)
        # Se guarda al terminar CADA wallet, no al final del todo. Recorrer devnet entero son
        # decenas de minutos contra un RPC que ya se ha caído una vez a mitad: con un único commit
        # final, un corte de red tiraba todo el trabajo. Guardando por wallet, relanzarlo continúa
        # donde se quedó, porque la consulta solo pide las tiradas que siguen sin firma.
        if args.go:
            ses.commit()
        print(f"  → {len(tiradas) - len(buscados)} localizadas")

    print(f"\nlocalizadas {encontradas} · sin localizar {fallidas}")
    if sin_localizar:
        print("\nsin localizar (la prueba sigue on-chain, solo que más atrás del historial leído):")
        for w, m in sin_localizar[:20]:
            print(f"  {w[:6]}…  {m}")

    if args.go:
        ses.commit()   # por si quedó algo suelto; lo gordo ya se guardó wallet a wallet
        print("\nescrito.")
    else:
        print("\n(dry-run: no se ha escrito nada — repite con --go)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
