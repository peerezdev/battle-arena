"""Quita los tokens de las URLs que uvicorn escribe en su log de acceso.

El WebSocket del chat manda el token de identidad de Privy en la query string
(`/ws/chat?token=…`) y el log de acceso de uvicorn registra la URL entera. En el mini PC de
producción el journal lo lee el grupo `adm`, no solo root: ahí quedaba un bearer válido 24 horas
por cada conexión de cada jugador, en claro y acumulándose.

Esto es la mitad barata del arreglo. La buena es no mandar el token por la URL —cabecera
`Sec-WebSocket-Protocol`, o primer mensaje tras conectar—, pero eso toca frontend y backend a la
vez. Redactar en el log corta la fuga hoy y no estorba a ese cambio cuando llegue.

Se filtra por `record.args` y no por el mensaje ya formateado porque uvicorn registra con `%s`
perezoso: cuando el filtro corre, la URL todavía vive en los argumentos.
"""
from __future__ import annotations

import logging
import re

#: Nombres de parámetro que nunca deben acabar escritos. `token` es el del chat; los demás van
#: por delante, porque el coste de cubrirlos es cero y el de descubrir que faltaba uno no.
_SENSIBLES = re.compile(
    r"((?:token|access_token|id_token|identity_token|auth|apikey|api_key)=)[^&\s\"']+",
    re.IGNORECASE,
)
_OCULTO = r"\1<oculto>"

_LOGGERS = ("uvicorn.access", "uvicorn.error", "uvicorn")
_MARCA = "_battlearena_redaccion"


def _limpia(valor):
    return _SENSIBLES.sub(_OCULTO, valor) if isinstance(valor, str) else valor


class RedactaTokens(logging.Filter):
    """Reescribe el registro en vez de descartarlo: devuelve siempre True."""

    def filter(self, record: logging.LogRecord) -> bool:  # noqa: A003
        args = record.args
        if isinstance(args, dict):
            record.args = {k: _limpia(v) for k, v in args.items()}
        elif isinstance(args, tuple):
            record.args = tuple(_limpia(a) for a in args)
        elif args is not None:
            record.args = _limpia(args)
        record.msg = _limpia(record.msg)
        return True


def instalar() -> None:
    """Idempotente: llamarlo dos veces no encadena dos filtros."""
    for nombre in _LOGGERS:
        log = logging.getLogger(nombre)
        if any(getattr(f, _MARCA, False) for f in log.filters):
            continue
        filtro = RedactaTokens()
        setattr(filtro, _MARCA, True)
        log.addFilter(filtro)
