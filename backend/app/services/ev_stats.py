"""EV realizado de una máquina y cuánta confianza merece.

QUÉ SE MIDE. Cada tirada devuelve una carta con un valor asegurado. El `edge` realizado es
`media(valor) / precio_del_sobre − 1`: lo que de verdad ha pagado la máquina frente a lo que
cuesta.

POR QUÉ BOOTSTRAP Y NO LA FÓRMULA DE SIEMPRE. El valor de una tirada tiene una cola larguísima:
tres de cada cuatro son commons baratas y una de cada cien es un epic que vale doscientas veces
más. Con esa forma, la media muestral NO se distribuye simétrica, y el intervalo normal
`media ± 1,96·SE` sale centrado cuando la realidad no lo está. Se ve en los datos del proyecto de
referencia: sus intervalos son asimétricos, y tanto más cuanto menor es la muestra.

El bootstrap no asume forma ninguna: remuestrea lo observado y mira dónde cae la media. Es más
caro de calcular y no hace falta que sea rápido, porque esto corre en segundo plano y se cachea.

EL VEREDICTO NO TIENE UMBRALES INVENTADOS. Sale solo de dónde queda el intervalo respecto al cero.
Si lo cruza, la respuesta honesta es que no se sabe.
"""
from __future__ import annotations

import random
from typing import List, Optional, Sequence

#: Nivel de confianza del intervalo. 95% es lo estándar y es lo que usa la referencia.
CONFIANZA = 0.95
#: Remuestreos por defecto. 10.000 es el número habitual: por debajo, los extremos del intervalo
#: bailan entre ejecuciones lo bastante como para que el veredicto cambie sin que cambien los datos.
REMUESTREOS = 10_000

CONFIRMADO_NEG = "CONFIDENT -EV"
CONFIRMADO_POS = "CONFIDENT +EV"
SIN_CONCLUIR = "unclear (CI crosses zero)"


def edge_pct(valores: Sequence[float], precio: float) -> Optional[float]:
    """Cuánto paga la máquina frente a lo que cuesta, en porcentaje. None si no se puede calcular."""
    if not valores or not precio:
        return None
    return (sum(valores) / len(valores) / precio - 1.0) * 100.0


def intervalo(valores: Sequence[float], precio: float, *,
              remuestreos: int = REMUESTREOS, semilla: Optional[int] = None) -> Optional[dict]:
    """Punto e intervalo del edge, por bootstrap percentil.

    `semilla` fija el generador. Se usa en los tests y también en producción con la máquina como
    semilla: así dos ejecuciones seguidas sobre los mismos datos dan el mismo intervalo, y un
    veredicto no cambia por el ruido del muestreo mientras el jugador mira la pantalla.

    Devuelve porcentajes, no proporciones, porque es lo que se pinta.
    """
    n = len(valores)
    if n < 2 or not precio:
        return None
    rnd = random.Random(semilla)
    datos = list(valores)
    medias: List[float] = []
    for _ in range(remuestreos):
        medias.append(sum(rnd.choices(datos, k=n)) / n)
    medias.sort()
    cola = (1.0 - CONFIANZA) / 2.0
    lo = medias[int(cola * remuestreos)]
    hi = medias[min(remuestreos - 1, int((1.0 - cola) * remuestreos))]
    return {
        "edge_pct": edge_pct(datos, precio),
        "ci_lo_pct": (lo / precio - 1.0) * 100.0,
        "ci_hi_pct": (hi / precio - 1.0) * 100.0,
        "n": n,
    }


def veredicto(ci_lo_pct: float, ci_hi_pct: float) -> str:
    """Dónde queda el intervalo respecto al cero, y nada más.

    Cruzar el cero significa que los datos son compatibles con ganar y con perder. Decirlo es la
    respuesta correcta, no un fallo de la medición: con una cola tan larga hacen falta muchísimas
    tiradas para separar un −3% de un +3%.
    """
    if ci_hi_pct < 0:
        return CONFIRMADO_NEG
    if ci_lo_pct > 0:
        return CONFIRMADO_POS
    return SIN_CONCLUIR


def tiradas_para_concluir(n: int, edge_pct_: float, ci_lo_pct: float, ci_hi_pct: float) -> Optional[int]:
    """Estimación de cuántas tiradas harían falta para que el intervalo dejara de cruzar el cero.

    El ancho del intervalo encoge con la raíz de la muestra, así que para reducirlo en un factor k
    hace falta k² veces más muestra. Es una ESTIMACIÓN, no una promesa: supone que el edge medido
    se mantiene, y si el edge real está más cerca de cero nunca se separará.

    Devuelve None si ya está concluido o si el edge medido es cero, donde la pregunta no tiene
    respuesta.
    """
    if not n or not edge_pct_:
        return None
    if ci_hi_pct < 0 or ci_lo_pct > 0:
        return None
    medio = (ci_hi_pct - ci_lo_pct) / 2.0
    if medio <= 0:
        return None
    factor = (medio / abs(edge_pct_)) ** 2
    objetivo = int(n * factor)
    return objetivo if objetivo > n else None
