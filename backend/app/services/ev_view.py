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
from .tier_gaps import rachas_por_tier
from .winners_store import ventana

#: Muestra por debajo de la cual ni se intenta: el intervalo saldría tan ancho que no diría nada, y
#: gastar el bootstrap en ello es tirar segundos de CPU por máquina.
MINIMO = 30

CONSTRUYENDO = "BUILDING"
CON_HUECO = "GAP IN WINDOW"
SIN_MUESTRA = "NOT ENOUGH DATA"


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
        "tiers": rachas_por_tier(session, machine, horas=horas, ahora=ahora),
    }

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
