"""Encender y apagar máquinas de gacha sin reiniciar nada.

Los cambios van a la base y el backend lee la lista de apagadas en CADA petición, así que surten
efecto al instante. El frontend repregunta el catálogo cada pocos segundos, de modo que una máquina
apagada desaparece sola de la pantalla sin recargar.

Apagar afecta al catálogo: deja de ofrecerse y no se pueden empezar partidas nuevas con ella. NO
toca el histórico — lo ya jugado con esa máquina conserva su nombre y su imagen.

Uso (desde backend/):
  PYTHONPATH=. .venv/bin/python3 scripts/machines.py list
  PYTHONPATH=. .venv/bin/python3 scripts/machines.py hide sweet_99 --reason "miniatura rota"
  PYTHONPATH=. .venv/bin/python3 scripts/machines.py show sweet_99

Con APP_NETWORK=mainnet trabaja sobre mainnet.
"""
import argparse
import asyncio
import sys

from app.config import get_settings
from app.db import init_db, make_engine, make_session_factory
from app.models import HiddenMachine
from app.services.gacha import GachaService
from app.services.machine_visibility import hidden_codes, hide, show


def _session_factory():
    st = get_settings()
    engine = make_engine(st.database_url)
    init_db(engine)
    return make_session_factory(engine), st


async def _catalogo(st):
    """El catálogo crudo de CC. Vacío si el gacha no está configurado o no responde."""
    g = GachaService(base_url=st.gacha_base_url, api_key=st.gacha_api_key,
                     nft_base_url=st.cc_nft_base_url)
    try:
        return await g.machines()
    except Exception as exc:
        print(f"aviso: no se pudo leer el catálogo de CC ({exc})", file=sys.stderr)
        return []


def cmd_list(args) -> int:
    Session, st = _session_factory()
    s = Session()
    try:
        ocultas = hidden_codes(s)
        ms = asyncio.run(_catalogo(st))
        if not ms and not ocultas:
            print("(sin máquinas)")
            return 0
        print(f"{'estado':<9}{'código':<18}{'precio':>7}  nombre")
        for m in sorted(ms, key=lambda m: (m.get("price") or 0)):
            code = m.get("code") or "?"
            marca = "APAGADA" if code in ocultas else ("cerrada" if m.get("available") is False else "ok")
            print(f"{marca:<9}{code:<18}{str(m.get('price')):>7}  {m.get('name')}")
        # Apagadas que CC ya no sirve: si no se listaran, quedarían invisibles para siempre.
        huerfanas = ocultas - {m.get("code") for m in ms}
        for code in sorted(huerfanas):
            print(f"{'APAGADA':<9}{code:<18}{'—':>7}  (ya no está en el catálogo de CC)")
        return 0
    finally:
        s.close()


def cmd_hide(args) -> int:
    Session, st = _session_factory()
    s = Session()
    try:
        ms = asyncio.run(_catalogo(st))
        codigos = {m.get("code") for m in ms}
        # No se bloquea si no aparece: puede ser una que CC aún no publica y se quiere dejar
        # apagada de antemano. Pero se avisa, porque lo normal es que sea una errata.
        if ms and args.code not in codigos:
            print(f"aviso: '{args.code}' no está en el catálogo de CC. "
                  f"Se apaga igualmente (¿errata?).", file=sys.stderr)
        hide(s, args.code, reason=args.reason)
        print(f"apagada {args.code}" + (f" ({args.reason})" if args.reason else ""))
        return 0
    finally:
        s.close()


def cmd_show(args) -> int:
    Session, _ = _session_factory()
    s = Session()
    try:
        if show(s, args.code):
            print(f"encendida {args.code}")
            return 0
        print(f"'{args.code}' no estaba apagada", file=sys.stderr)
        return 1
    finally:
        s.close()


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="encender/apagar máquinas de gacha")
    sub = p.add_subparsers(dest="cmd", required=True)

    pl = sub.add_parser("list", help="catálogo de CC marcando las apagadas")
    pl.set_defaults(func=cmd_list)

    ph = sub.add_parser("hide", help="dejar de ofrecer una máquina")
    ph.add_argument("code")
    ph.add_argument("--reason", default=None, help="por qué, para acordarse luego")
    ph.set_defaults(func=cmd_hide)

    ps = sub.add_parser("show", help="volver a ofrecer una máquina")
    ps.add_argument("code")
    ps.set_defaults(func=cmd_show)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
