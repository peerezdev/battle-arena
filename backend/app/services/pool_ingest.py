"""Trae el pool de cartas de cada máquina y guarda el resumen por rareza.

Es un barrido caro y por eso va aparte del feed en vivo: son 106.251 cartas en las 48 máquinas,
unas 1.100 peticiones a 100 por página. Pero se puede ir despacio sin perder nada, porque el pool
cambia muy poco de un rato para otro: `pokemon_25` hace ~500 tiradas al día sobre 15.277 cartas,
un 3%, y encima el buyback devuelve al bote buena parte de lo que sale.

Lo que NO se guarda son las cartas. De cada rareza solo hacen falta cuántas hay y cuánto valen, así
que guardar las 106.251 sería copiar el catálogo de Collector Crypt para calcular cuatro medias.
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from ..models import GachaPoolTier
from .pool_model import TIERS, resumen_por_rareza

logger = logging.getLogger(__name__)

#: Tope por página de `getNfts`. Pedir más no devuelve más.
POR_PAGINA = 100
#: Cortafuegos por rareza. La mayor es `pokemon_25` con 15.277 cartas repartidas en cuatro, así que
#: 200 páginas (20.000 cartas) sobra de largo. Está para que un `hasMore` mal contestado no deje
#: al barrido pidiendo páginas para siempre.
MAX_PAGINAS = 200
#: Respiro entre peticiones. No es por nosotros: es no dispararle mil peticiones seguidas a CC.
PAUSA_S = 0.15


def valor(v) -> Optional[float]:
    """El valor asegurado, que CC sirve como número o como texto de dinero ('$5,000.00')."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[^0-9.\-]", "", str(v))
    try:
        return float(s) if s else None
    except ValueError:
        return None


async def traer_pool(gacha, machine: str, odds: Dict[str, float], *,
                     pausa_s: float = PAUSA_S) -> Dict[str, dict]:
    """El resumen por rareza de una máquina, paginando `getNfts` hasta agotar cada una.

    Se pagina hasta que una página venga incompleta. `getNfts` sí trae `hasMore`, pero nuestro
    cliente devuelve solo la lista, y "vino menos de lo que cabía" es la misma señal sin tener que
    tocar el cliente para esto.
    """
    salida: Dict[str, dict] = {}
    for clave, _ in TIERS:
        valores: List[float] = []
        for pagina in range(1, MAX_PAGINAS + 1):
            cartas = await gacha.get_nfts(machine, rarity=clave, page=pagina, limit=POR_PAGINA)
            valores += [v for v in (valor(c.get("insured_value")) for c in cartas) if v is not None]
            if len(cartas) < POR_PAGINA:
                break
            if pausa_s:
                await asyncio.sleep(pausa_s)
        else:
            logger.warning("pool de %s/%s: se alcanzó el tope de páginas", machine, clave)
        salida[clave] = resumen_por_rareza(valores, odds.get(clave))
    return salida


def guardar_pool(session: Session, machine: str, resumenes: Dict[str, dict],
                 *, ahora: Optional[datetime] = None) -> None:
    """Deja el resumen guardado, creando o pisando lo que hubiera.

    Una rareza que ahora viene VACÍA se guarda igualmente con sus ceros en vez de dejar la fila
    vieja: si CC agota un tier, lo que había deja de ser cierto, y conservarlo daría un EV de
    modelo calculado sobre cartas que ya no están.
    """
    ahora = ahora or datetime.now(timezone.utc)
    for clave, datos in resumenes.items():
        fila = session.get(GachaPoolTier, (machine, clave))
        if fila is None:
            fila = GachaPoolTier(machine=machine, tier=clave)
            session.add(fila)
        fila.probability = datos.get("probability")
        fila.n_cards = datos.get("n_cards") or 0
        fila.avg_value = datos.get("avg_value")
        fila.min_value = datos.get("min_value")
        fila.max_value = datos.get("max_value")
        fila.updated_at = ahora
    session.commit()


def desfase(nuestro: Optional[float], suyo: Optional[float]) -> Optional[float]:
    """Diferencia relativa entre nuestro EV bruto y el `ev` que publica Collector Crypt.

    Sale gratis y es la mejor comprobación que tenemos de este cálculo: si su número y el nuestro
    dejan de cuadrar, o han cambiado las odds, o han cambiado el pool, o uno de los dos se ha
    equivocado. Verificado en `comic_25`: 26.998 los dos, desfase 0.
    """
    if not nuestro or not suyo:
        return None
    return round((nuestro - suyo) / suyo, 4)
