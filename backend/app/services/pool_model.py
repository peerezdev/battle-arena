"""Lo que una máquina DEBERÍA pagar, según las cartas que tiene dentro.

Es la otra mitad del EV tracker. El feed de ganadores dice lo que la máquina pagó de verdad; esto
dice lo que se espera de ella, y solo teniendo las dos se puede decir si lo realizado va por encima
o por debajo de lo prometido.

    gross_tier = probabilidad × valor medio de las cartas de esa rareza
    model_ev   = Σ gross

Verificado contra Collector Crypt sobre las 481 cartas de `comic_25`: la suma de gross da 26.998 y
el `ev` que ellos publican es 26.998. O sea que su número es exactamente esto, y calcularlo por
nuestra cuenta no es desconfianza gratuita: es lo que permite ENSEÑAR el desglose por rareza (una
máquina puede tener el mismo EV con las cartas buenas concentradas en un tier casi imposible) y, de
paso, notarlo si algún día dejara de cuadrar.

AQUÍ NO ENTRA EL BUYBACK, y es una decisión. Sale en VALOR DE CARTA, la misma base en la que se mide
lo realizado, para que las dos mitades sean comparables tal y como vienen. Aplicar la recompra es
cosa del interruptor de la pantalla, que la aplica a las dos por igual; si el modelo llegara con la
recompra ya puesta y lo realizado no, el interruptor tendría que hacer una cosa distinta con cada
una y cualquier despiste se vería como una diferencia entre modelo y realidad que no existe.
"""
from __future__ import annotations

from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from ..models import GachaPoolTier

#: De cómo los nombra CC en `odds` a cómo se enseñan. El orden es el de lectura, de más común a
#: menos, igual que en `tier_gaps`.
TIERS = (("common", "Common"), ("uncommon", "Uncommon"), ("rare", "Rare"), ("epic", "Epic"))


def _fila(p: GachaPoolTier, nombre: str) -> dict:
    # `gross` solo existe si hay las dos cosas. Con el pool vacío (CC tiene máquinas a cero) o sin
    # odds, un 0 se leería como "esta rareza no aporta valor", que es muy distinto de "no se sabe".
    gross = (None if p.probability is None or p.avg_value is None
             else round(p.probability * p.avg_value, 4))
    return {"tier": nombre, "probability": p.probability, "n_cards": p.n_cards,
            "value": None if p.avg_value is None else round(p.avg_value, 2),
            "gross": gross, "min_value": p.min_value, "max_value": p.max_value}


def modelo(session: Session, machine: str, *, precio: float) -> dict:
    """El EV del modelo y su desglose por rareza, EN VALOR DE CARTA. Sin pool guardado, todo a `None`.

    Devolver ceros sería peor que devolver nada: un `model_ratio` de 0 pintaría la aguja al fondo
    de la escala como si la máquina fuera un robo, cuando lo único que pasa es que todavía no hemos
    mirado sus cartas.
    """
    filas = {p.tier: p for p in session.query(GachaPoolTier)
             .filter(GachaPoolTier.machine == machine).all()}
    tiers = [_fila(filas[clave], nombre) for clave, nombre in TIERS if clave in filas]

    brutos = [t["gross"] for t in tiers if t["gross"] is not None]
    # Se exige el desglose COMPLETO. Con tres rarezas de cuatro la suma sale igual de limpia y es
    # sistemáticamente baja, así que publicarla sería inventar una máquina peor de lo que es.
    if len(brutos) != len(TIERS) or not precio:
        return {"model_ev": None, "model_ratio": None, "model_edge_pct": None, "model_tiers": tiers}

    ev = sum(brutos)
    ratio = ev / precio
    return {"model_ev": round(ev, 2), "model_ratio": round(ratio, 4),
            "model_edge_pct": round((ratio - 1) * 100, 3), "model_tiers": tiers}


def resumen_por_rareza(cartas: List[float], probabilidad: Optional[float]) -> Dict[str, Optional[float]]:
    """Lo que se guarda de una rareza: cuántas cartas y cuánto valen.

    Se queda con el mínimo y el máximo además de la media porque el EV de un tier con una carta de
    50.000 $ entre cien de 200 $ no se parece en nada al de cien cartas de 700 $, y la media sola no
    distingue esos dos casos.
    """
    if not cartas:
        return {"n_cards": 0, "avg_value": None, "min_value": None, "max_value": None,
                "probability": probabilidad}
    return {"n_cards": len(cartas), "avg_value": sum(cartas) / len(cartas),
            "min_value": min(cartas), "max_value": max(cartas), "probability": probabilidad}
