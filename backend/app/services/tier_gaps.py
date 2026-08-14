"""Cuántas tiradas lleva cada rareza sin salir en una máquina, y cuánto suele tardar.

SOBRE TODO EL HISTÓRICO GUARDADO, NO SOBRE LA VENTANA DEL EV. Es deliberado, y es la diferencia
con el resto de la fila: el EV es un ritmo y se mide en una ventana de tiempo corta, porque mezclar
tiradas de hace un mes compara precios de carta viejos. Una racha no es eso: es un CONTADOR DE
TIRADAS, y recortarlo a 48 h no lo hace más actual, lo hace ciego.

Se veía en `comic_25`, que hace unas 3 tiradas al día: dentro de la ventana salían seis tiradas y
Rare y Epic quedaban en `current: None`, que se lee como "lleva mucho sin salir" cuando en realidad
significaba "no he mirado lo suficiente". Con el histórico entero se puede decir lo que de verdad
importa, que es "lleva 190 tiradas, y son 30 días".

Es también la diferencia con `rarity_gaps.py`, que solo puede dar la racha actual porque trabaja
sobre una foto: con la tabla acumulada se puede además decir cuánto tarda NORMALMENTE esa rareza, y
sin esa referencia un "39" no significa nada.

LO QUE ESTO NO ES: una predicción. El gacha de CC usa VRF y cada tirada es independiente, así que
una rareza que lleva 87 sin salir tiene exactamente la misma probabilidad en la 88 que en la 1.
Es telemetría —"esta máquina viene fría"—, y por eso la API habla de `racha` y jamás de "toca".
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy.orm import Session

from ..models import GachaWinner

#: `prize_tier` de Collector Crypt. Se ordenan de más común a menos, que es el orden de lectura.
TIERS = ((4, "Common"), (3, "Uncommon"), (2, "Rare"), (1, "Epic"))

#: Tope de tiradas que se miran hacia atrás. Acota el coste en las máquinas calientes, donde el
#: histórico crece sin parar, sin recortar a las lentas: en `pokemon_50` son unos cuatro días y en
#: `comic_25` es su historia entera. De sobra para estimar el ritmo de un Epic (~1 de cada 100).
LIMITE = 2000


def _sin_zona(d: Optional[datetime]) -> Optional[datetime]:
    """SQLite devuelve los datetime sin zona aunque se guarden con ella; compararlos con uno que sí
    la lleva revienta. Se les vuelve a poner UTC, que es como se guardaron."""
    if d is None:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _rachas(recientes: List[tuple], tier: int, ahora: datetime) -> dict:
    """Racha de una rareza sobre una lista ordenada de MÁS RECIENTE a más antigua.

    La racha actual es la posición de su última aparición: 0 = salió en la última tirada.

    La media sale de `(N − apariciones) / apariciones`, que es el espacio medio entre apariciones.
    Converge a `(1−p)/p`, así que para un tier de p=0.04 da ~24 sin necesitar conocer las odds:
    se mide, no se asume. Eso importa porque las odds publicadas podrían no ser las reales, y este
    número es de los pocos que permitiría notarlo.
    """
    n = len(recientes)
    posiciones = [i for i, (t, _) in enumerate(recientes) if t == tier]
    k = len(posiciones)
    if k == 0:
        # No apareció en toda la muestra. La racha es MAYOR que la muestra, no igual: redondearla a
        # n daría por medido algo que no se ha medido.
        return {"current": None, "average": None, "seen": 0, "sample": n, "days_since": None}
    ultima = _sin_zona(recientes[posiciones[0]][1])
    # Los días acompañan a la racha porque sin ellos "190" no se puede leer: son tres horas en una
    # máquina caliente y un mes en una lenta, y esa diferencia cambia por completo lo que significa.
    dias = None if ultima is None else round(max(0.0, (ahora - ultima).total_seconds()) / 86400, 1)
    return {"current": posiciones[0], "average": round((n - k) / k, 1),
            "seen": k, "sample": n, "days_since": dias}


def rachas_por_tier(session: Session, machine: str, *, limite: int = LIMITE,
                    ahora: Optional[datetime] = None) -> List[dict]:
    """Una fila por rareza con su racha actual, su media, cuántas veces salió y desde cuándo."""
    ahora = ahora or datetime.now(timezone.utc)
    filas = (session.query(GachaWinner.prize_tier, GachaWinner.created_at)
             .filter(GachaWinner.machine == machine,
                     GachaWinner.prize_tier.isnot(None))
             .order_by(GachaWinner.created_at.desc())
             .limit(limite)
             .all())
    recientes = [(t, c) for (t, c) in filas]
    salida = []
    for codigo, nombre in TIERS:
        r = _rachas(recientes, codigo, ahora)
        r["tier"] = nombre
        # "Fría" es solo que va por encima de su propio ritmo. No implica nada sobre la siguiente
        # tirada; es la forma honesta de decir "lleva más de lo habitual".
        r["cold"] = (r["current"] is not None and r["average"] is not None
                     and r["current"] > r["average"])
        salida.append(r)
    return salida
