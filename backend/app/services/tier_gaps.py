"""Cuántas tiradas lleva cada rareza sin salir en una máquina, y cuánto suele tardar.

SOBRE NUESTRO HISTÓRICO, no sobre las 200 últimas de Collector Crypt. Esa es la diferencia con
`rarity_gaps.py`, que solo puede dar la racha actual porque trabaja sobre una foto: con la tabla
acumulada se puede además decir cuánto tarda NORMALMENTE esa rareza, y sin esa referencia un "39"
no significa nada.

LO QUE ESTO NO ES: una predicción. El gacha de CC usa VRF y cada tirada es independiente, así que
una rareza que lleva 87 sin salir tiene exactamente la misma probabilidad en la 88 que en la 1.
Es telemetría —"esta máquina viene fría"—, y por eso la API habla de `racha` y jamás de "toca".
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import List, Optional

from sqlalchemy.orm import Session

from ..models import GachaWinner

#: `prize_tier` de Collector Crypt. Se ordenan de más común a menos, que es el orden de lectura.
TIERS = ((4, "Common"), (3, "Uncommon"), (2, "Rare"), (1, "Epic"))


def _rachas(tiers_recientes: List[int], tier: int) -> dict:
    """Racha actual y media de una rareza sobre una lista ordenada de MÁS RECIENTE a más antigua.

    La racha actual es la posición de su última aparición: 0 = salió en la última tirada.

    La media sale de `(N − apariciones) / apariciones`, que es el espacio medio entre apariciones.
    Converge a `(1−p)/p`, así que para un tier de p=0.04 da ~24 sin necesitar conocer las odds:
    se mide, no se asume. Eso importa porque las odds publicadas podrían no ser las reales, y este
    número es de los pocos que permitiría notarlo.
    """
    n = len(tiers_recientes)
    posiciones = [i for i, t in enumerate(tiers_recientes) if t == tier]
    k = len(posiciones)
    if k == 0:
        # No apareció en toda la muestra. La racha es MAYOR que la muestra, no igual: redondearla a
        # n daría por medido algo que no se ha medido.
        return {"current": None, "average": None, "seen": 0, "sample": n}
    return {"current": posiciones[0], "average": round((n - k) / k, 1), "seen": k, "sample": n}


def rachas_por_tier(session: Session, machine: str, *, horas: int = 48,
                    ahora: Optional[datetime] = None) -> List[dict]:
    """Una fila por rareza con su racha actual, su media y cuántas veces salió."""
    ahora = ahora or datetime.now(timezone.utc)
    filas = (session.query(GachaWinner.prize_tier)
             .filter(GachaWinner.machine == machine,
                     GachaWinner.created_at >= ahora - timedelta(hours=horas),
                     GachaWinner.prize_tier.isnot(None))
             .order_by(GachaWinner.created_at.desc())
             .all())
    recientes = [t for (t,) in filas]
    salida = []
    for codigo, nombre in TIERS:
        r = _rachas(recientes, codigo)
        r["tier"] = nombre
        # "Fría" es solo que va por encima de su propio ritmo. No implica nada sobre la siguiente
        # tirada; es la forma honesta de decir "lleva más de lo habitual".
        r["cold"] = (r["current"] is not None and r["average"] is not None
                     and r["current"] > r["average"])
        salida.append(r)
    return salida
