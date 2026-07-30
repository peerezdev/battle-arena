"""Pool de wallets de escrow: reclamar una libre en vez de crear otra en Privy.

Cada wallet de escrow cuenta como usuario activo en Privy, y hasta ahora se creaba una por partida
sin reciclarla nunca — 79 partidas dieron 79 wallets, 26 de ellas para lobbies que nadie jugó.

La regla que gobierna todo esto: **una wallet vuelve al pool solo cuando se ha comprobado on-chain
que está vacía.** Reutilizar una que aún tenga algo dentro significa que el settle de la partida
siguiente barrería ese saldo hacia su ganador. Medido en devnet antes de escribir esto: había 18
escrows con USDC (uno con $3.500) y 10 con cartas.

De ahí la decisión menos obvia del módulo: `esta_vacio` LEVANTA una excepción cuando no puede
comprobarlo, en vez de devolver "vacío". Los helpers que ya existían (`usdc_balance_base_units`,
`sol_balance`) devuelven 0 cuando la petición falla, que para un saldo es un valor por defecto
razonable pero aquí sería catastrófico: un 429 de Helius convertiría un escrow con dinero en
reutilizable. Aquí "no lo sé" nunca puede parecerse a "está vacío".
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from solders.pubkey import Pubkey
from solders.token.associated import get_associated_token_address

from app.models import EscrowWallet
from app.services.nft_transfer import sin_secretos

logger = logging.getLogger(__name__)


class EstadoDesconocido(Exception):
    """No se pudo determinar si el escrow está vacío. No es un 'sí' ni un 'no'."""


async def _rpc(rpc_url: str, method: str, params, *, intentos: int = 3) -> dict:
    """Una llamada RPC que insiste y, si no lo consigue, lo dice."""
    ultimo = None
    for _ in range(intentos):
        try:
            async with httpx.AsyncClient(timeout=25) as c:
                r = await c.post(rpc_url, json={"jsonrpc": "2.0", "id": 1,
                                                "method": method, "params": params})
                r.raise_for_status()
                return r.json()
        except Exception as exc:      # red, 429, 5xx…
            ultimo = exc
    raise EstadoDesconocido(f"{method}: {sin_secretos(ultimo)}")


async def contenido(rpc_url: str, address: str, usdc_mint: str) -> tuple:
    """(nº de cartas, USDC en base units) que hay dentro del escrow.

    Las cartas se cuentan con DAS `getAssetsByOwner`, que es la única consulta que ve los tres
    estándares de una vez — comprobado: devuelve MplBubblegumV2 (cNFT), MplCoreAsset y
    ProgrammableNFT en la misma respuesta. Preguntando por token accounts, un Core o un cNFT serían
    invisibles y el escrow parecería vacío teniendo cartas dentro.
    """
    j = await _rpc(rpc_url, "getAssetsByOwner",
                   {"ownerAddress": address, "page": 1, "limit": 1000})
    res = j.get("result")
    if not isinstance(res, dict) or not isinstance(res.get("items"), list):
        raise EstadoDesconocido(f"getAssetsByOwner sin items para {address}: {j.get('error')}")
    cartas = len(res["items"])

    ata = str(get_associated_token_address(Pubkey.from_string(address),
                                           Pubkey.from_string(usdc_mint)))
    j2 = await _rpc(rpc_url, "getTokenAccountBalance", [ata, {"commitment": "confirmed"}])
    valor = (j2.get("result") or {}).get("value")
    if valor is None:
        # La ATA no existe → nunca tuvo USDC. Es el único caso en que un "no hay dato" significa
        # de verdad cero, y el RPC lo distingue de un fallo porque responde 200 con value:null.
        if j2.get("error") and "could not find" not in str(j2["error"]).lower():
            raise EstadoDesconocido(f"getTokenAccountBalance {address}: {j2['error']}")
        return cartas, 0
    return cartas, int(valor["amount"])


async def motivo_retencion(rpc_url: str, address: str, usdc_mint: str) -> Optional[str]:
    """None si el escrow está vacío; si no, en qué se ha quedado algo. Levanta EstadoDesconocido."""
    cartas, usdc = await contenido(rpc_url, address, usdc_mint)
    partes = []
    if cartas:
        partes.append(f"{cartas} carta(s)")
    if usdc:
        partes.append(f"{usdc / 1e6:.2f} USDC")
    return " y ".join(partes) if partes else None


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


def reclamar_del_pool(session, battle_id: str) -> Optional[dict]:
    """Coge una wallet libre y la marca en uso. None si el pool está vacío.

    El UPDATE condicionado es lo que evita que dos partidas que arrancan a la vez se lleven la misma
    wallet: quien pierda la carrera verá rowcount 0 y probará con otra.

    Los candidatos ya intentados se descartan explícitamente en vez de reconsultar a ciegas. Con un
    `while True` que repite la misma consulta basta con que el SELECT y el UPDATE dejen de coincidir
    en su condición para girar eternamente — y eso no sería un test en rojo, sería el servidor
    colgado al empezar una partida. Así el bucle termina siempre: cada vuelta quita un candidato.
    """
    intentados: set = set()
    while True:
        q = (session.query(EscrowWallet)
             .filter(EscrowWallet.status == "free")
             .order_by(EscrowWallet.released_at.is_(None).desc(), EscrowWallet.released_at))
        if intentados:
            q = q.filter(EscrowWallet.address.notin_(intentados))
        libre = q.first()
        if libre is None:
            return None
        intentados.add(libre.address)
        n = (session.query(EscrowWallet)
             .filter(EscrowWallet.address == libre.address, EscrowWallet.status == "free")
             .update({"status": "in_use", "battle_id": battle_id, "claimed_at": _ahora(),
                      "released_at": None, "unavailable_reason": None,
                      "times_used": EscrowWallet.times_used + 1},
                     synchronize_session=False))
        session.commit()
        if n == 1:
            session.refresh(libre)
            logger.info("escrow pool: reutilizada %s para %s (uso nº %d)",
                        libre.address, battle_id, libre.times_used)
            return {"id": libre.wallet_id, "address": libre.address}
        # Otra partida se la llevó entre el SELECT y el UPDATE: a por otra.


async def adquirir(session, signer, battle_id: str) -> dict:
    """Wallet de escrow para esta partida: del pool si hay, y solo si no, una nueva en Privy."""
    del_pool = reclamar_del_pool(session, battle_id)
    if del_pool is not None:
        return del_pool

    esc = await signer.create_solana_wallet()
    session.add(EscrowWallet(address=esc["address"], wallet_id=esc["id"], status="in_use",
                             battle_id=battle_id, claimed_at=_ahora(), times_used=1))
    session.commit()
    logger.info("escrow pool: vacío, creada wallet nueva %s para %s", esc["address"], battle_id)
    return {"id": esc["id"], "address": esc["address"]}


async def liberar(session, rpc_url: str, address: str, usdc_mint: str) -> bool:
    """Devuelve la wallet al pool si está vacía on-chain. True si se liberó.

    Nunca levanta: liberar es una tarea de limpieza que corre al cerrar la partida y no debe tumbar
    el cierre. Lo que no se pueda liberar queda como `retained` con su motivo escrito, así que se
    puede auditar después — y si el motivo es USDC, lo que hay detrás es un barrido incompleto.
    """
    fila = session.get(EscrowWallet, address)
    if fila is None:
        return False
    try:
        motivo = await motivo_retencion(rpc_url, address, usdc_mint)
    except EstadoDesconocido as exc:
        fila.status = "retained"
        # Redactado otra vez a propósito: `exc` ya viene limpio de _rpc, pero depender de eso hace
        # que un EstadoDesconocido nuevo desde otro sitio se lleve la clave a la base sin avisar.
        fila.unavailable_reason = f"sin comprobar: {sin_secretos(exc)}"
        session.commit()
        logger.warning("escrow pool: no se pudo comprobar %s, se retiene: %s", address, exc)
        return False
    except Exception as exc:
        fila.status = "retained"
        fila.unavailable_reason = f"error: {sin_secretos(exc)}"
        session.commit()
        logger.warning("escrow pool: error comprobando %s: %s", address, exc)
        return False

    if motivo:
        fila.status = "retained"
        fila.unavailable_reason = motivo
        session.commit()
        logger.warning("escrow pool: %s retenida, tiene %s", address, motivo)
        return False

    fila.status = "free"
    fila.battle_id = None
    fila.unavailable_reason = None
    fila.released_at = _ahora()
    session.commit()
    logger.info("escrow pool: %s liberada", address)
    return True


TERMINALES = ("settled", "voided", "cancelled")


async def liberar_al_terminar(session, rpc_url: str, battle, usdc_mint: str) -> bool:
    """Intenta devolver el escrow de esta partida al pool. No hace nada si la partida sigue viva.

    Se llama al final de cada camino del wiring. Es deliberadamente tolerante: una partida sin
    escrow (anulada antes de crearlo) o una que aún corre simplemente no liberan nada.
    """
    if not getattr(battle, "escrow_address", None) or battle.status not in TERMINALES:
        return False
    return await liberar(session, rpc_url, battle.escrow_address, usdc_mint)
