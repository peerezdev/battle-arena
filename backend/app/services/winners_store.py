"""Guarda las tiradas del gacha y lleva la cuenta de qué tramos tenemos SIN huecos.

La parte con estado del EV tracker, separada de la red a propósito: aquí no hay sockets ni HTTP,
solo sesión y filas ya normalizadas. Es lo que permite probar la lógica de huecos sin levantar nada.

POR QUÉ IMPORTAN LOS HUECOS. Una ventana de 48 h con un agujero dentro se puede promediar
igualmente, y ese es justo el peligro: sale un número limpio calculado sobre una muestra
incompleta, y nadie —ni nosotros— puede saber que le falta un trozo. Por eso la cobertura se
guarda al lado de los datos y quien pinte la tarjeta tiene que mirarla.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Iterable, List, Optional, Sequence

from sqlalchemy.orm import Session

from ..models import GachaCoverage, GachaWinner

logger = logging.getLogger(__name__)

#: Margen para decidir si dos tramos enlazan. El feed en vivo y el REST no ordenan al milisegundo
#: y una tirada puede llegar por los dos sitios con microsegundos de diferencia; sin holgura
#: marcaríamos huecos inexistentes en cada reconexión.
HOLGURA = timedelta(seconds=5)


def guardar(session: Session, filas: Iterable[dict]) -> int:
    """Inserta las que no estén ya. Devuelve cuántas eran nuevas.

    Se deduplica por (`nft_address`, `created_at`). La dirección SOLA no sirve: una misma carta se
    entrega varias veces porque el buyback la devuelve al pool (medido en mainnet: 183 direcciones
    distintas en 200 tiradas de `onepiece_50`). Contarla una vez descontaría tiradas reales y
    sesgaría el EV a la baja.

    Se deduplica DENTRO del lote además de contra la base: el feed devuelve la misma tirada
    repetida en una sola respuesta, y sin esto la inserción entera reventaba por clave duplicada.

    La misma tirada puede llegar por el feed en vivo y por el relleno REST; la primera gana y la
    segunda se ignora, que es lo correcto: son el mismo hecho.
    """
    nuevas = 0
    vistas = set()
    for f in filas:
        if f is None:
            continue
        clave = (f["nft_address"], f["created_at"])
        if clave in vistas:
            continue
        vistas.add(clave)
        if session.get(GachaWinner, clave) is not None:
            continue
        session.add(GachaWinner(**f))
        nuevas += 1
    if nuevas:
        session.commit()
    return nuevas


def _con_zona(d: Optional[datetime]) -> Optional[datetime]:
    """SQLite devuelve los datetime SIN zona aunque se guarden con ella, y compararlos con uno que
    sí la lleva revienta. Se les vuelve a poner UTC, que es como se guardaron."""
    if d is None:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _cobertura(session: Session, machine: str) -> GachaCoverage:
    c = session.get(GachaCoverage, machine)
    if c is None:
        c = GachaCoverage(machine=machine)
        session.add(c)
    return c


def anotar_tramo(session: Session, machine: str, desde: datetime, hasta: datetime,
                 *, enlaza: bool) -> None:
    """Registra que tenemos datos continuos de `machine` entre `desde` y `hasta`.

    `enlaza` dice si ese tramo empalma con lo que ya teníamos. Es la decisión que NO se puede
    tomar aquí dentro: solo quien hizo la petición sabe si el feed le devolvió todo lo que había o
    le recortó por el tope de 200, y esa diferencia es exactamente la que distingue "no pasó nada"
    de "se perdió un trozo".

    Si no enlaza, el hueco se apunta y `continuous_since` SALTA al inicio del tramo nuevo: lo
    anterior al agujero sigue en la base, pero ya no sirve para una ventana que lo cruce.
    """
    c = _cobertura(session, machine)
    anterior_fin = _con_zona(c.last_event_at)
    if _con_zona(c.continuous_since) is None:
        c.continuous_since = desde
    elif not enlaza:
        huecos: List[list] = json.loads(c.gaps) if c.gaps else []
        anterior = anterior_fin
        if anterior is not None:
            huecos.append([anterior.isoformat(), desde.isoformat()])
            c.gaps = json.dumps(huecos[-20:])   # solo los últimos: es para enseñar, no un registro contable
            logger.warning("EV tracker: hueco en %s entre %s y %s", machine, anterior, desde)
        c.continuous_since = desde
    if anterior_fin is None or hasta > anterior_fin:
        c.last_event_at = hasta
    c.updated_at = datetime.now(timezone.utc)
    session.commit()


def ultima_vista(session: Session, machine: str) -> Optional[datetime]:
    """El instante de la tirada más reciente que tenemos. Es por donde pedir el relleno."""
    c = session.get(GachaCoverage, machine)
    return _con_zona(c.last_event_at) if c else None


def ventana(session: Session, machine: str, horas: int = 48,
            ahora: Optional[datetime] = None) -> dict:
    """Los valores de la ventana y en qué estado está su cobertura.

    Devuelve `completa` (si tenemos datos continuos desde antes del inicio de la ventana),
    `horas_cubiertas` y los huecos que caen dentro. Quien pinte decide qué hacer con eso; aquí solo
    se informa, nunca se maquilla.
    """
    ahora = ahora or datetime.now(timezone.utc)
    inicio = ahora - timedelta(hours=horas)
    filas = (session.query(GachaWinner)
             .filter(GachaWinner.machine == machine, GachaWinner.created_at >= inicio)
             .all())
    valores = [f.insured_value for f in filas if f.insured_value is not None]

    c = session.get(GachaCoverage, machine)
    desde = _con_zona(c.continuous_since) if c else None
    completa = desde is not None and desde <= inicio
    cubiertas = horas if completa else (
        round((ahora - desde).total_seconds() / 3600.0, 1) if desde else 0.0)

    dentro = []
    for a, b in (json.loads(c.gaps) if (c and c.gaps) else []):
        if datetime.fromisoformat(b) >= inicio:
            dentro.append([a, b])

    return {"valores": valores, "n": len(valores), "completa": completa,
            "horas_cubiertas": cubiertas, "horas_ventana": horas, "huecos": dentro}


def maquinas_con_datos(session: Session) -> Sequence[str]:
    return [m for (m,) in session.query(GachaWinner.machine).distinct().all()]
