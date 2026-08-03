"""Interruptores de producto: encender y apagar sin reiniciar nada.

El backend relee cada flag en cada uso, así que un cambio surte efecto en la siguiente vuelta —
para el auto-royale, en menos de un minuto.

Un flag AUSENTE está apagado. "No configurado" y "desactivado" son el mismo estado.

Uso (desde backend/):
  PYTHONPATH=. .venv/bin/python3 scripts/flags.py list
  PYTHONPATH=. .venv/bin/python3 scripts/flags.py on auto_royale pokemon_25
  PYTHONPATH=. .venv/bin/python3 scripts/flags.py on auto_royale pokemon_25:10
  PYTHONPATH=. .venv/bin/python3 scripts/flags.py off auto_royale

Con APP_NETWORK=mainnet trabaja sobre mainnet.

Flags que entiende el backend hoy:
  auto_royale=<máquina[:plazas]>    abre una Battle Royale de la casa cuando no hay ninguna de esa
                                    máquina esperando ni en juego. El lobby va SIN creador y sin
                                    cobrar a nadie: el primer jugador que entra ocupa la primera
                                    plaza. Sin `:plazas` usa house_lobby.PLAZAS (10); el modo
                                    admite de 5 a 10. Las plazas mueven el precio de entrada, que
                                    sale de royale_buyin(): en pokemon_25 son 70 USDC con 5 plazas
                                    y 135 con 10.
"""
import argparse
import sys

from app.config import get_settings
from app.db import init_db, make_engine, make_session_factory
from app.services.flags import all_flags, clear_flag, get_flag, set_flag
from scripts._destino import anunciar


def _session():
    st = get_settings()
    anunciar(st)
    engine = make_engine(st.database_url)
    init_db(engine)
    return make_session_factory(engine)()


def cmd_list(_args) -> int:
    s = _session()
    try:
        filas = all_flags(s)
        if not filas:
            print("(ningún flag encendido)")
            return 0
        print(f"{'flag':<20}{'valor':<24}encendido desde")
        for f in filas:
            print(f"{f.key:<20}{str(f.value):<24}{str(f.updated_at)[:19]}")
        return 0
    finally:
        s.close()


def cmd_on(args) -> int:
    s = _session()
    try:
        set_flag(s, args.key, args.value)
        print(f"encendido {args.key} = {args.value}")
        return 0
    finally:
        s.close()


def cmd_off(args) -> int:
    s = _session()
    try:
        if clear_flag(s, args.key):
            print(f"apagado {args.key}")
            return 0
        print(f"'{args.key}' ya estaba apagado (valor actual: {get_flag(s, args.key)})",
              file=sys.stderr)
        return 1
    finally:
        s.close()


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="encender/apagar interruptores de producto")
    sub = p.add_subparsers(dest="cmd", required=True)

    pl = sub.add_parser("list", help="flags encendidos")
    pl.set_defaults(func=cmd_list)

    po = sub.add_parser("on", help="encender un flag")
    po.add_argument("key")
    po.add_argument("value", nargs="?", default="on", help="valor; p.ej. el código de máquina")
    po.set_defaults(func=cmd_on)

    pf = sub.add_parser("off", help="apagar un flag")
    pf.add_argument("key")
    pf.set_defaults(func=cmd_off)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
