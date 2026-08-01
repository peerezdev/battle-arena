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
#: Plazas por defecto si el flag no dice otra cosa.
PLAZAS = 10
#: Los límites del modo, los mismos que valida create_battle.
MIN_PLAZAS, MAX_PLAZAS = 5, 10


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


def configuracion(session: Session) -> Optional[tuple]:
    """(máquina, plazas) del flag, o None si está apagado.

    El valor es `maquina` o `maquina:plazas` — así el tamaño de la sala se cambia desde consola sin
    desplegar ni reiniciar, que es justo para lo que existe el interruptor. Sin plazas, PLAZAS.

    Unas plazas ilegibles o fuera de los límites del modo NO apagan el auto-royale: se avisa y se usa
    el valor por defecto. Dejar de abrir salas por una errata en un número sería peor que abrirlas
    del tamaño de siempre.
    """
    valor = (get_flag(session, FLAG) or "").strip()
    if not valor:
        return None
    maquina, _, crudo = valor.partition(":")
    maquina = maquina.strip()
    if not maquina:
        return None
    plazas = PLAZAS
    if crudo.strip():
        try:
            pedidas = int(crudo)
        except ValueError:
            logger.warning("auto-royale: plazas ilegibles en %r, se usan %d", valor, PLAZAS)
        else:
            if MIN_PLAZAS <= pedidas <= MAX_PLAZAS:
                plazas = pedidas
            else:
                logger.warning("auto-royale: %d plazas está fuera de %d-%d, se usan %d",
                               pedidas, MIN_PLAZAS, MAX_PLAZAS, PLAZAS)
    return maquina, plazas


def maquina_configurada(session: Session) -> Optional[str]:
    """Solo la máquina. Se conserva porque leerla sin las plazas sigue siendo útil."""
    cfg = configuracion(session)
    return cfg[0] if cfg else None
