"""Quién puede ver el Machine Tracker.

El tracker mide lo que paga de verdad cada máquina del gacha, y eso es información que cuesta
dinero producir: escuchar el feed sin parar, barrer 106.000 cartas, y 48 h de datos antes de poder
afirmar nada. Se reserva para quien juega en las mesas, no para quien pasa a mirar.

LA REGLA ES UNA VENTANA RODANTE, NO UN CARNET. Se suma lo apostado en los ÚLTIMOS 7 DÍAS cada vez
que se pregunta, así que no hay nada que caducar ni ningún estado que mantener:

  · hoy apuesto 100 → entro
  · siete días después, sin apostar más, esos 100 ya no están dentro de la ventana → vuelve el aviso
  · si al cuarto día aposté 50, al reaparecer el aviso esos 50 SIGUEN contando, porque siguen
    dentro de los últimos 7 días. El aviso pedirá 50, no 100.

Esa última parte es la que hace que no se pueda implementar con una fecha de caducidad: lo que vale
no es "cuándo llegó a 100", es cuánto lleva apostado en los últimos siete días, mirado ahora.

SOLO PACK BATTLE Y BATTLE ROYALE. El gacha NO cuenta: abrir un sobre no es apostar contra nadie, y
además el tracker existe precisamente para decidir si abrirlo merece la pena. Contarlo sería pedir
que gastes en gacha para poder ver si el gacha te conviene.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import BattlePlayer, PackBattle

#: Cuánto hay que llevar apostado, en USDC.
MINIMO_USD = 100.0
#: Hacia atrás. Rodante: se mira desde "ahora", no desde el lunes ni desde que te dieron acceso.
VENTANA_DIAS = 7

USDC = 1_000_000


def _sin_zona(d: Optional[datetime]) -> Optional[datetime]:
    """SQLite devuelve los datetime sin zona aunque se guarden con ella; compararlos con uno que sí
    la lleva revienta. Se les vuelve a poner UTC, que es como se guardaron."""
    if d is None:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def wager_reciente_usd(session: Session, wallet: str, *, dias: int = VENTANA_DIAS,
                       ahora: Optional[datetime] = None) -> float:
    """Lo apostado en batallas por esa wallet en los últimos `dias`, en USDC.

    Solo partidas LIQUIDADAS. Una anulada se devolvió, así que contarla sería contar dinero que el
    jugador recuperó; y una en curso todavía puede anularse.

    Se fecha por `settled_at`, con `created_at` de respaldo para las filas que el backend liquidó
    antes de empezar a guardar esa marca. Sin el respaldo esas partidas no contarían nunca.
    """
    ahora = ahora or datetime.now(timezone.utc)
    desde = ahora - timedelta(days=dias)
    from .users import _entry_base_units

    batallas = session.scalars(
        select(PackBattle)
        .join(BattlePlayer, BattlePlayer.battle_id == PackBattle.id)
        .where(BattlePlayer.player_wallet == wallet, PackBattle.status == "settled")
    ).all()

    total = 0
    for b in batallas:
        cuando = _sin_zona(b.settled_at) or _sin_zona(b.created_at)
        if cuando is not None and cuando >= desde:
            total += _entry_base_units(b)
    return total / USDC


def acceso(session: Session, wallet: Optional[str], *, minimo_usd: float = MINIMO_USD,
           dias: int = VENTANA_DIAS, ahora: Optional[datetime] = None) -> dict:
    """Si esa wallet puede ver el tracker, y cuánto le falta si no.

    Sin wallet no hay acceso, pero tampoco es un error: es alguien que no ha entrado, y lo que
    procede es enseñarle qué es esto y qué hace falta, no un 401.

    `missing_usd` se redondea hacia ARRIBA al céntimo. Si faltan 0.004, decir "te faltan 0.00" es
    una trampa: el jugador apostaría creyendo que ya está y seguiría fuera.
    """
    apostado = wager_reciente_usd(session, wallet, dias=dias, ahora=ahora) if wallet else 0.0
    falta = max(0.0, minimo_usd - apostado)
    return {
        "allowed": apostado >= minimo_usd,
        "wagered_usd": round(apostado, 2),
        "required_usd": minimo_usd,
        "missing_usd": math.ceil(falta * 100) / 100,
        "window_days": dias,
    }
