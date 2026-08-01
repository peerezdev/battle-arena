"""Interruptores de producto, encendibles y apagables desde consola sin reiniciar.

Se leen en cada uso: un cambio en la base surte efecto en la siguiente vuelta, sin desplegar ni
reiniciar nada. Ver `scripts/flags.py`.

Regla que gobierna el módulo: **un flag ausente está apagado**. Así "todavía no configurado" y
"desactivado" son el mismo estado, y encender algo es siempre un acto explícito — nada se queda
encendido por omisión.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy.orm import Session

from ..models import AppFlag

logger = logging.getLogger(__name__)


def get_flag(session: Session, key: str) -> Optional[str]:
    """Valor del flag, o None si está apagado (ausente).

    Ante un fallo de base devuelve None: si no se puede leer el interruptor, lo seguro es
    considerarlo apagado en vez de actuar a ciegas.
    """
    try:
        fila = session.get(AppFlag, key)
        return fila.value if fila is not None else None
    except Exception:
        logger.exception("flags: no se pudo leer %s — se toma como apagado", key)
        return None


def is_on(session: Session, key: str) -> bool:
    return get_flag(session, key) is not None


def set_flag(session: Session, key: str, value: str = "on") -> AppFlag:
    fila = session.get(AppFlag, key)
    if fila is None:
        fila = AppFlag(key=key, value=value)
        session.add(fila)
    else:
        fila.value = value
        fila.updated_at = datetime.now(timezone.utc)
    session.commit()
    return fila


def clear_flag(session: Session, key: str) -> bool:
    """Apaga el flag borrándolo. True si estaba encendido."""
    fila = session.get(AppFlag, key)
    if fila is None:
        return False
    session.delete(fila)
    session.commit()
    return True


def all_flags(session: Session) -> List[AppFlag]:
    return session.query(AppFlag).order_by(AppFlag.key).all()
