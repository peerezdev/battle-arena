"""Lobbies de la casa: mantener siempre una Battle Royale abierta a la que unirse.

Un lobby vacío es un reclamo, no una apuesta: se abre SIN creador y sin cobrarle a nadie, y el
primer jugador que entra ocupa la primera plaza. La alternativa —que lo cree un bot— haría que la
casa pusiera el buy-in (70 $ en pokemon_25 de 5) cada vez que abre uno.

Se enciende y apaga con el flag `auto_royale`, cuyo valor es el código de máquina. Ausente = apagado.
"""
from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy.orm import Session

from ..models import BattlePlayer, PackBattle
from .flags import get_flag

logger = logging.getLogger(__name__)

FLAG = "auto_royale"
#: Se abren al mínimo de plazas a propósito: 5 es lo que menos tarda en llenarse, y un lobby que no
#: se llena no entretiene a nadie.
PLAZAS = 5


def hace_falta_una(session: Session, machine_code: str) -> bool:
    """¿No hay ninguna royale de esa máquina esperando ni en juego?

    Cuenta 'lobby' y 'running': mientras haya una en curso, la gente tiene algo que mirar y abrir
    otra solo parte a los jugadores entre dos salas medio vacías.
    """
    return session.query(PackBattle).filter(
        PackBattle.mode == "royale",
        PackBattle.machine_code == machine_code,
        PackBattle.status.in_(("lobby", "running")),
    ).count() == 0


def es_de_la_casa(battle: PackBattle) -> bool:
    """Un lobby sin creador es de la casa. Nadie puede cancelarlo desde la interfaz — el endpoint
    exige ser el creador — así que se retira desde consola."""
    return battle.creator_wallet is None


def maquina_configurada(session: Session) -> Optional[str]:
    """Código de máquina del flag, o None si está apagado."""
    valor = (get_flag(session, FLAG) or "").strip()
    return valor or None
