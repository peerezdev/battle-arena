"""Interruptores de producto: encender y apagar sin reiniciar nada.

El backend relee cada flag en cada uso, así que un cambio surte efecto en la siguiente vuelta —
para el auto-royale, en menos de un minuto.

Un flag AUSENTE está apagado. "No configurado" y "desactivado" son el mismo estado.

Uso (desde backend/):
  PYTHONPATH=. .venv/bin/python3 scripts/flags.py list
  PYTHONPATH=. .venv/bin/python3 scripts/flags.py on auto_royale pokemon_25
  PYTHONPATH=. .venv/bin/python3 scripts/flags.py off auto_royale

Con APP_NETWORK=mainnet trabaja sobre mainnet.

Flags que entiende el backend hoy:
  auto_royale=<código de máquina>   abre una Battle Royale de la casa cuando no hay ninguna de esa
                                    máquina esperando ni en juego. El lobby va SIN creador y sin
                                    cobrar a nadie: el primer jugador que entra ocupa la primera
                                    plaza. Se abre siempre con 5 plazas, que es lo que antes se
                                    llena.
"""
import argparse
import sys

from app.config import get_settings
from app.db import init_db, make_engine, make_session_factory
from app.services.flags import all_flags, clear_flag, get_flag, set_flag


def _session():
    engine = make_engine(get_settings().database_url)
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
