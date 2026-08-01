"""Cuántas tiradas lleva cada rareza sin salir en una máquina.

Se cuenta sobre el feed público de ganadores de Collector Crypt, que llega ordenado de más reciente
a más antiguo: el hueco de una rareza es su posición en esa lista. 0 = salió en la última tirada.

Lo que este dato NO es: una predicción. El gacha de CC usa VRF y cada tirada es independiente, así
que una rareza que lleva 87 sin salir tiene exactamente la misma probabilidad en la 88 que en la 1.
Es telemetría —"esta máquina viene fría"—, y por eso la API habla de `sin_salir` y nunca de "toca".
"""
from __future__ import annotations

from typing import Dict, List, Optional

#: Las cuatro del gacha, de más común a menos. El orden es el de presentación.
RAREZAS = ("Common", "Uncommon", "Rare", "Epic")


def gaps(filas: List[dict], rarezas=RAREZAS) -> Dict[str, Optional[int]]:
    """{rareza: tiradas desde la última vez que salió}, o None si no salió en toda la muestra.

    `filas` son los ganadores de MÁS RECIENTE a más antiguo, cada uno con su clave `rarity`.
    None se distingue de un número a propósito: "no ha salido en las 200 últimas" no es lo mismo
    que un hueco concreto, y redondearlo a 200 daría por medido algo que no se ha medido.
    """
    out: Dict[str, Optional[int]] = {r: None for r in rarezas}
    pendientes = set(rarezas)
    for i, f in enumerate(filas):
        r = f.get("rarity")
        if r in pendientes:
            out[r] = i
            pendientes.discard(r)
            if not pendientes:
                break
    return out
