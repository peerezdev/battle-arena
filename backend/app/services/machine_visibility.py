"""Qué máquinas de gacha se ofrecen. Se apagan a mano; ver `scripts/machines.py`.

La distinción que gobierna el módulo: ocultar toca el CATÁLOGO, no las consultas por código. Una
partida ya jugada con una máquina que luego se apagó tiene que seguir enseñando su nombre y su
imagen; lo que se impide es empezar partidas nuevas con ella. Por eso hay una función para filtrar
la lista y ninguna para "buscar máquina", que sigue viendo todo.
"""
from __future__ import annotations

import logging
from typing import List, Optional, Set

from sqlalchemy.orm import Session

from ..models import HiddenMachine

logger = logging.getLogger(__name__)


def hidden_codes(session: Session) -> Set[str]:
    """Códigos apagados. Ante un fallo de base devuelve vacío: que el catálogo se vea de más es
    mucho menos grave que quedarse sin catálogo."""
    try:
        return {h.code for h in session.query(HiddenMachine).all()}
    except Exception:
        logger.exception("visibilidad de máquinas: no se pudo leer, se ofrecen todas")
        return set()


def visible(session: Session, machines: List[dict]) -> List[dict]:
    """El catálogo sin las apagadas."""
    ocultas = hidden_codes(session)
    return [m for m in machines if m.get("code") not in ocultas]


def hide(session: Session, code: str, reason: Optional[str] = None) -> HiddenMachine:
    fila = session.get(HiddenMachine, code)
    if fila is None:
        fila = HiddenMachine(code=code, reason=reason)
        session.add(fila)
    else:
        fila.reason = reason
    session.commit()
    return fila


def show(session: Session, code: str) -> bool:
    """True si estaba oculta y se ha encendido."""
    fila = session.get(HiddenMachine, code)
    if fila is None:
        return False
    session.delete(fila)
    session.commit()
    return True
