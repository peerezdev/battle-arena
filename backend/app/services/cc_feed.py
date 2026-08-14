"""Normaliza las tiradas del gacha de Collector Crypt, que llegan en DOS formatos distintos.

CC publica lo mismo por dos sitios y con nombres diferentes:

    en vivo (Ably)          REST (/api/getAllWinners)
    ─────────────────       ─────────────────────────
    gachaCode               pack_type
    prizeTier               prize_tier
    prizeWallet / winner    winner
    timestamp               created_at
    nft.address             nft_address
    memo   (completo)       memo_slug  (¡solo el prefijo!)
    weightedInsuredValue    (no existe)

CUIDADO CON EL MEMO. En vivo llega entero (`cc-369721a8-…`, `jupiter-6a53…`), y en REST llega solo
el prefijo del integrador (`cc`, `jupiter`), compartido por miles de tiradas. Parece un
identificador y no lo es: usarlo como clave dejaría la tabla en un puñado de filas. La clave es
`nft_address`, que es único en las dos fuentes porque una carta concreta solo se entrega una vez.

Todo lo de aquí es PURO: recibe un diccionario y devuelve otro. La red vive en el ingestor.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

#: Lo que necesita una fila para servir de algo. Sin estos cuatro no se puede ni guardar ni medir.
OBLIGATORIOS = ("nft_address", "machine", "created_at", "insured_value")


def _instante(valor) -> Optional[datetime]:
    """ISO 8601 (las dos fuentes) o epoch en segundos/milisegundos, a datetime con zona.

    Se normaliza a UTC siempre: guardar unos con zona y otros sin ella hace que las comparaciones
    de la ventana fallen de formas difíciles de ver.
    """
    if valor is None:
        return None
    if isinstance(valor, (int, float)):
        # Un epoch en milisegundos es del orden de 1e12; en segundos, de 1e9.
        seg = valor / 1000.0 if valor > 1e11 else float(valor)
        return datetime.fromtimestamp(seg, tz=timezone.utc)
    if isinstance(valor, str):
        try:
            d = datetime.fromisoformat(valor.replace("Z", "+00:00"))
        except ValueError:
            return None
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    return None


def _numero(valor) -> Optional[float]:
    if valor is None or isinstance(valor, bool):
        return None
    try:
        return float(valor)
    except (TypeError, ValueError):
        return None


def _entero(valor) -> Optional[int]:
    n = _numero(valor)
    return None if n is None else int(n)


def normalizar_vivo(msg: dict) -> Optional[dict]:
    """Un evento `new-winner` del canal `recent-winners-{maquina}` de Ably."""
    if not isinstance(msg, dict):
        return None
    nft = msg.get("nft")
    direccion = nft.get("address") if isinstance(nft, dict) else None
    return _cerrar({
        "nft_address": direccion,
        "machine": msg.get("gachaCode"),
        "prize_tier": _entero(msg.get("prizeTier")),
        "insured_value": _numero(msg.get("insuredValue")),
        "weighted_insured_value": _numero(msg.get("weightedInsuredValue")),
        "memo": msg.get("memo"),
        "winner": msg.get("winner") or msg.get("prizeWallet"),
        "created_at": _instante(msg.get("timestamp")),
        "source": "live",
    })


def normalizar_rest(fila: dict) -> Optional[dict]:
    """Una fila de `/api/getAllWinners`.

    `memo` queda a None a propósito aunque la respuesta traiga `memo_slug`: guardar un prefijo en
    un campo que en vivo contiene el memo entero mezclaría dos cosas distintas bajo el mismo
    nombre, y el día que alguien filtre por memo obtendría basura.
    """
    if not isinstance(fila, dict):
        return None
    return _cerrar({
        "nft_address": fila.get("nft_address"),
        "machine": fila.get("pack_type"),
        "prize_tier": _entero(fila.get("prize_tier")),
        "insured_value": _numero(fila.get("insuredValue")),
        "weighted_insured_value": None,
        "memo": None,
        "winner": fila.get("winner"),
        "created_at": _instante(fila.get("created_at")),
        "source": "rest",
    })


def _cerrar(d: dict) -> Optional[dict]:
    """Devuelve la fila solo si sirve. Una tirada a medias contamina la media sin avisar."""
    if any(d.get(k) in (None, "") for k in OBLIGATORIOS):
        return None
    return d
