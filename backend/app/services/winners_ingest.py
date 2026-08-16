"""Trae las tiradas del gacha de Collector Crypt: en vivo por Ably, y REST para rellenar huecos.

CÓMO FUNCIONA. CC publica cada tirada en un canal de Ably por máquina
(`recent-winners-{codigo}`, evento `new-winner`). Nos suscribimos y las guardamos según llegan:
sin sondeo, en tiempo real y sin huecos mientras la conexión aguante. El token lo da el propio CC
en `/api/ably/token` y **no hace falta clave**, aunque su documentación diga lo contrario: medido
contra las dos redes.

POR QUÉ HACE FALTA ADEMÁS EL REST. Ably solo entrega lo que pasa mientras estás conectado. Al
reconectar se pide `rewind`, que replica lo reciente (verificado: con `rewind=5m` entrega al
instante lo de los últimos minutos). Para una caída más larga que eso, el único sitio donde
preguntar por el pasado es `getAllWinners`, y ahí sí manda el tope de 200 por máquina: si en el
hueco cupieron más de 200 tiradas, ese tramo se pierde y hay que decirlo.

POR QUÉ SSE Y NO EL SDK DE ABLY. El protocolo por HTTP nos evita una dependencia nueva en un
despliegue que corre en un mini PC. `httpx` ya está.
"""
from __future__ import annotations

import json
import time
import logging
from datetime import datetime, timedelta, timezone
from typing import Callable, Iterable, Iterator, List, Optional, Sequence

import httpx

from .cc_feed import normalizar_rest, normalizar_vivo

logger = logging.getLogger(__name__)

ABLY_REST = "https://rest.ably.io"
ABLY_REALTIME = "https://realtime.ably.io"
#: Cuánto pasado se pide al reconectar. Cubre un reinicio o un corte breve sin tocar el REST.
REWIND = "2m"
#: Tope que sirve CC por máquina. No es configurable por nosotros: pedir más devuelve 200 igual.
TOPE_REST = 200
#: Margen para dar dos tramos por enlazados. Ver `winners_store.HOLGURA`.
HOLGURA = timedelta(seconds=5)


# ── piezas puras ──────────────────────────────────────────────────────────────

def eventos_sse(lineas: Iterable[str]) -> Iterator[dict]:
    """Extrae los `new-winner` de un flujo SSE de Ably.

    Se separa de la red para poder probarla: el formato de Ably anida el evento dentro de `data:`
    y el payload de la tirada puede venir como objeto o como cadena JSON, según por dónde salga.
    Lo segundo es fácil de pasar por alto y deja el ingestor mudo sin ningún error.
    """
    for linea in lineas:
        linea = (linea or "").strip()
        if not linea.startswith("data:"):
            continue
        try:
            sobre = json.loads(linea[5:])
        except (ValueError, TypeError):
            continue
        if not isinstance(sobre, dict) or sobre.get("name") != "new-winner":
            continue
        datos = sobre.get("data")
        if isinstance(datos, str):
            try:
                datos = json.loads(datos)
            except (ValueError, TypeError):
                continue
        if isinstance(datos, dict):
            yield datos


def hay_hueco(filas: Sequence[dict], ultima_vista: Optional[datetime], *, tope: int = TOPE_REST) -> bool:
    """¿Se perdieron tiradas entre lo que teníamos y lo que acaba de llegar?

    La respuesta depende de UNA cosa: si CC nos recortó por el tope. Si devolvió menos de 200,
    nos dio todo lo que había desde entonces y no falta nada, por muy separadas que estén las
    fechas. Si devolvió exactamente 200 y la más antigua es POSTERIOR a lo último que teníamos,
    entre medias hubo algo que ya no podemos recuperar.

    Sin datos previos no hay hueco: es el primer arranque, no una pérdida.
    """
    if ultima_vista is None or not filas:
        return False
    if len(filas) < tope:
        return False
    mas_antigua = min(f["created_at"] for f in filas)
    return mas_antigua > ultima_vista + HOLGURA


# ── red ───────────────────────────────────────────────────────────────────────

async def token_ably(gacha, *, timeout: float = 20.0) -> Optional[str]:
    """Canjea el `TokenRequest` de CC por un token real de Ably.

    Son dos pasos y el primero no es de Ably: CC firma la petición y Ably la convierte en token.
    Devuelve None si algo falla, porque quedarse sin feed en vivo no debe tumbar el backend: el
    relleno REST sigue funcionando.
    """
    try:
        peticion = await gacha.ably_token_request()
        nombre = peticion.get("keyName")
        if not nombre:
            return None
        async with httpx.AsyncClient(timeout=timeout) as c:
            r = await c.post(f"{ABLY_REST}/keys/{nombre}/requestToken", json=peticion,
                             headers={"content-type": "application/json"})
            r.raise_for_status()
            return (r.json() or {}).get("token")
    except Exception:
        logger.warning("EV tracker: no se pudo obtener token de Ably", exc_info=False)
        return None


#: Silencio máximo tolerado antes de dar la conexión por muerta. Ably manda keepalives cada ~15 s:
#: medido en mainnet sobre 47 canales, el mayor hueco entre bytes en dos minutos fue de 19.3 s. 90
#: es casi cinco veces eso, así que no puede saltar por una racha tranquila.
SILENCIO_MAX_S = 90.0

#: Cuánto se deja vivir una conexión antes de rehacerla. EL TOKEN DE ABLY DURA 60 MINUTOS, y esto
#: es lo que de verdad rompió la ingesta: al caducar, Ably DEJA DE ENTREGAR PERO NO CIERRA. La
#: conexión sigue ESTABLISHED, nadie da error, y el tracker se queda cinco horas sin una sola
#: tirada mientras aparenta estar bien. Reconectar antes de que caduque lo evita de raíz, y no
#: cuesta nada: al reconectar se rellena por REST lo que se haya perdido.
VIDA_MAX_S = 45 * 60


async def escuchar(token: str, maquinas: Sequence[str], al_llegar: Callable[[dict], None],
                   *, rewind: str = REWIND, timeout: float = 300.0,
                   silencio_max_s: float = SILENCIO_MAX_S, vida_max_s: float = VIDA_MAX_S) -> None:
    """Escucha los canales de esas máquinas y llama `al_llegar` con cada tirada ya normalizada.

    Un solo flujo para todas: Ably admite varios canales por conexión, así que 47 máquinas son una
    conexión y no 47. Vuelve cuando el flujo se corta; reconectar es cosa de quien llama.

    VUELVE SIEMPRE, aunque el otro lado no diga nada. Antes esperaba indefinidamente (`read=None`) y
    un flujo que dejaba de entregar sin cerrarse dejaba la ingesta parada para siempre, sin un solo
    aviso en el log. Ahora hay dos relojes: uno corta si no llega NADA en `silencio_max_s`, y otro
    obliga a rehacer la conexión cada `vida_max_s` para que el token nunca llegue a caducar dentro.
    """
    canales = ",".join(f"recent-winners-{m}" for m in maquinas)
    url = f"{ABLY_REALTIME}/sse?v=1.2&channels={canales}&rewind={rewind}&accessToken={token}"
    limite = time.monotonic() + vida_max_s
    tiempos = httpx.Timeout(timeout, read=silencio_max_s)
    try:
        async with httpx.AsyncClient(timeout=tiempos) as c:
            async with c.stream("GET", url, headers={"accept": "text/event-stream"}) as r:
                r.raise_for_status()
                async for linea in r.aiter_lines():
                    for crudo in eventos_sse([linea]):
                        fila = normalizar_vivo(crudo)
                        if fila is not None:
                            al_llegar(fila)
                    if time.monotonic() >= limite:
                        logger.info("EV tracker: se renueva la conexión antes de que caduque el token")
                        return
    except httpx.ReadTimeout:
        # No es un fallo del que haya que asustarse, es JUSTO lo que se quería detectar: el otro
        # lado dejó de hablar sin cerrar. Se avisa y quien llama reconecta.
        logger.warning("EV tracker: %.0f s sin recibir nada de Ably, se reconecta", silencio_max_s)


async def traer_rest(gacha, machine: str, desde: Optional[datetime] = None) -> List[dict]:
    """Las últimas tiradas de una máquina por REST, normalizadas y de más antigua a más nueva.

    `desde` usa el parámetro `timestamp` de CC, que acota a lo posterior a ese instante. Reduce el
    tamaño de la respuesta pero NO levanta el tope de 200, así que no elimina la posibilidad de
    hueco: solo la hace menos probable.
    """
    marca = None
    if desde is not None:
        marca = desde.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    crudas = await gacha.winners_raw(pack_type=machine, count=TOPE_REST, timestamp=marca)
    filas = [f for f in (normalizar_rest(x) for x in crudas) if f is not None]
    filas.sort(key=lambda f: f["created_at"])
    return filas
