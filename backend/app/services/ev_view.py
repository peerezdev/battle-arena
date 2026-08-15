"""Arma la fila que consume la pantalla del EV tracker.

Junta las tres piezas —lo guardado, la cobertura y la estadística— en un solo diccionario por
máquina. Aquí no se calcula nada nuevo: se decide QUÉ se publica y, sobre todo, qué NO.

LA REGLA QUE MANDA: sin ventana completa no hay veredicto. Con seis horas de datos se puede
calcular un intervalo perfectamente estrecho, y publicarlo como `CONFIDENT` sería exactamente el
error que hunde la credibilidad de una pantalla cuyo argumento es la verificación. Lo mismo con un
hueco dentro de la ventana: la media sale igual de limpia y por eso mismo engaña.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from .ev_stats import intervalo, tiradas_para_concluir, veredicto
from .pool_model import modelo
from .tier_gaps import rachas_por_tier
from .winners_store import ventana

#: Muestra por debajo de la cual ni se intenta: el intervalo saldría tan ancho que no diría nada, y
#: gastar el bootstrap en ello es tirar segundos de CPU por máquina.
MINIMO = 30

CONSTRUYENDO = "BUILDING"
CON_HUECO = "GAP IN WINDOW"
SIN_MUESTRA = "NOT ENOUGH DATA"


def _fundir(rachas: list, del_modelo: list) -> list:
    """Una fila por rareza con lo observado y lo esperado juntos.

    Manda `rachas`: siempre trae las cuatro rarezas, mientras que el modelo puede faltar entero
    (una máquina cuyo pool no se ha barrido todavía). Al revés se perdería la tabla de rachas, que
    es útil desde la primera hora, esperando a un barrido que tarda.
    """
    por_nombre = {t["tier"]: t for t in del_modelo}
    return [{**r, **{k: v for k, v in por_nombre.get(r["tier"], {}).items() if k != "tier"}}
            for r in rachas]


def fila_ev(session: Session, machine: str, *, precio: float, buyback_pct: Optional[float] = None,
            horas: int = 48, remuestreos: int = 4000,
            ahora: Optional[datetime] = None) -> dict:
    """Todo lo que necesita una tarjeta de una máquina, con su estado de cobertura por delante."""
    v = ventana(session, machine, horas=horas, ahora=ahora)
    base = {
        "machine": machine,
        "pack_price": precio,
        "buyback_pct": buyback_pct,
        "realized_n_pulls": v["n"],
        "realized_window_hours": horas,
        "window_complete": v["completa"],
        "hours_covered": v["horas_cubiertas"],
        "gaps": v["huecos"],
        "realized_edge_pct": None, "realized_ci_lo_pct": None, "realized_ci_hi_pct": None,
        "realized_verdict": None, "pulls_to_conclude": None,
        # Las rachas van SIEMPRE, incluso sin veredicto: se miden sobre las tiradas observadas y no
        # dependen de que la ventana esté completa. Es información útil desde la primera hora.
        #
        # Y van SOBRE EL HISTÓRICO ENTERO, no sobre `horas`: una racha se cuenta en tiradas, no en
        # tiempo, así que recortarla a la ventana del EV no la hace más actual, la deja ciega. En
        # una máquina de tres tiradas al día, la ventana solo alcanzaba a decir "no he mirado".
        "tiers": [],
    }
    # Lo que la máquina DEBERÍA pagar, según sus cartas y las odds que publica CC.
    #
    # El EV del modelo va al nivel de la fila y NO se mezcla con lo realizado: son dos afirmaciones
    # distintas, y el valor de la pantalla está justo en poder compararlas. El desglose por rareza
    # sí se funde con las rachas, porque en la tarjeta es una sola tabla: "esta rareza sale un 4%
    # de las veces, vale 70 de media, aporta 2.81 al EV, y lleva 8 tiradas sin salir".
    m = modelo(session, machine, precio=precio)
    base["tiers"] = _fundir(rachas_por_tier(session, machine, ahora=ahora), m.pop("model_tiers"))
    base.update(m)

    if v["n"] < MINIMO:
        # Se distingue de "todavía llenándose": aquí la ventana puede estar completa y aun así no
        # haber datos, porque la máquina simplemente no se juega.
        base["realized_verdict"] = CONSTRUYENDO if not v["completa"] else SIN_MUESTRA
        return base

    # La semilla es la máquina: dos refrescos seguidos dan el mismo intervalo, así que un veredicto
    # no cambia por el ruido del muestreo mientras alguien mira la pantalla.
    r = intervalo(v["valores"], precio, remuestreos=remuestreos, semilla=hash(machine) & 0xFFFF)
    if r is None:
        base["realized_verdict"] = SIN_MUESTRA
        return base

    base.update(realized_edge_pct=round(r["edge_pct"], 3),
                realized_ci_lo_pct=round(r["ci_lo_pct"], 3),
                realized_ci_hi_pct=round(r["ci_hi_pct"], 3))

    # El hueco manda sobre "todavía llenándose", y el orden importa: un agujero EMPUJA el inicio
    # de la continuidad, así que una máquina que perdió datos siempre parece además joven. Las dos
    # cosas son ciertas, pero solo una explica por qué, y decir "llevamos poco" cuando en realidad
    # se perdió un trozo es esconder lo que ha pasado.
    if v["huecos"]:
        # Se retira el veredicto A PROPÓSITO aunque el intervalo salga estrecho: sería un número
        # limpio sobre una muestra con agujeros, y nadie podría saber que le falta un trozo.
        base["realized_verdict"] = CON_HUECO
    elif not v["completa"]:
        base["realized_verdict"] = CONSTRUYENDO
    else:
        base["realized_verdict"] = veredicto(r["ci_lo_pct"], r["ci_hi_pct"])
        base["pulls_to_conclude"] = tiradas_para_concluir(
            r["n"], r["edge_pct"], r["ci_lo_pct"], r["ci_hi_pct"])
    return base
