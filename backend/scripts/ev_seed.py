"""Siembra el EV tracker con lo que Collector Crypt tenga a mano, y enseña cómo va.

    cd backend
    PYTHONPATH=. .venv/bin/python3 scripts/ev_seed.py                 # solo mira, no escribe
    PYTHONPATH=. .venv/bin/python3 scripts/ev_seed.py --go            # siembra
    APP_NETWORK=mainnet PYTHONPATH=. .venv/bin/python3 scripts/ev_seed.py --go

QUÉ HACE. Pide a CC las últimas tiradas de cada máquina y las guarda. Sirve para arrancar en frío
sin esperar a que el ingestor acumule, y para ver de un vistazo cuánta historia tenemos ya.

LO QUE NO PUEDE HACER, Y CONVIENE SABERLO. CC solo sirve 200 por máquina, y las de la máquina más
movida cubren apenas cuarenta y cinco minutos. Esto NO rellena las 48 horas de la ventana: da un
empujón inicial y poco más. La historia de verdad la construye el ingestor escuchando el feed en
vivo, y hasta que acumule dos días las tarjetas dirán que la ventana está a medias, que es la
verdad.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import datetime, timezone

from app.config import get_settings
from app.db import init_db, make_engine, make_session_factory
from app.services.gacha import GachaService
from app.services import winners_ingest, winners_store
from scripts._destino import anunciar


async def _sembrar(gacha, Session, escribir: bool) -> None:
    maquinas = [m for m in await gacha.machines() if m.get("code")]
    print(f"máquinas en el catálogo: {len(maquinas)}\n")
    print(f"{'máquina':<18}{'trae':>6}{'nuevas':>8}{'abarca':>10}  cobertura")
    total_nuevas = 0
    for m in maquinas:
        code = m["code"]
        with Session() as s:
            desde = winners_store.ultima_vista(s, code)
        try:
            filas = await winners_ingest.traer_rest(gacha, code, desde=desde)
        except Exception as e:
            print(f"  {code:<16}{'—':>6}  {type(e).__name__}")
            continue
        if not filas:
            print(f"  {code:<16}{0:>6}{0:>8}{'—':>10}")
            continue
        abarca = (filas[-1]["created_at"] - filas[0]["created_at"]).total_seconds() / 3600.0
        hueco = winners_ingest.hay_hueco(filas, desde)
        nuevas = 0
        if escribir:
            with Session() as s:
                nuevas = winners_store.guardar(s, filas)
                winners_store.anotar_tramo(s, code, filas[0]["created_at"],
                                           filas[-1]["created_at"], enlaza=not hueco)
                v = winners_store.ventana(s, code)
            cob = f"{v['horas_cubiertas']}h de {v['horas_ventana']}h" + (" · HUECO" if hueco else "")
        else:
            cob = "(dry-run)" + (" · habría hueco" if hueco else "")
        total_nuevas += nuevas
        print(f"  {code:<16}{len(filas):>6}{nuevas:>8}{abarca:>9.1f}h  {cob}")
    print(f"\ntiradas nuevas guardadas: {total_nuevas}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--go", action="store_true", help="escribir de verdad (por defecto: dry-run)")
    args = ap.parse_args()

    st = get_settings()
    anunciar(st)
    if not st.gacha_base_url:
        print("gacha deshabilitado (GACHA_BASE_URL vacío)", file=sys.stderr)
        return 1

    engine = make_engine(st.database_url)
    init_db(engine)
    Session = make_session_factory(engine)
    gacha = GachaService(base_url=st.gacha_base_url, api_key=st.gacha_api_key,
                         nft_base_url=st.cc_nft_base_url)
    print(f"ahora: {datetime.now(timezone.utc).isoformat(timespec='seconds')}\n")
    asyncio.run(_sembrar(gacha, Session, args.go))
    if not args.go:
        print("\n(dry-run: no se ha escrito nada — repite con --go)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
