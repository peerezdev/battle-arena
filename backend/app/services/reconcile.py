"""Reconciliación de pulls sin resolver: una pull con memo pero sin nft_address pudo quedar
pagada sin carta (CC resolvió tarde, o crash entre submit y open). Re-consultamos el memo y,
si ya resolvió, persistimos la carta para que el refund de void la devuelva a su dueño.
Nunca lanza (misma filosofía que refund/settle)."""
from __future__ import annotations
import asyncio
import logging

from app.models import BattlePull

logger = logging.getLogger(__name__)


async def reconcile_unresolved_pulls(session, battle, *, gacha, sleep_fn=None,
                                     max_attempts=5, delay=3.0) -> int:
    """Re-poll open_pack(memo) para cada pull sin resolver del battle. Devuelve cuántas
    quedaron resueltas (campos persistidos). Las que sigan pendientes se dejan tal cual
    para el próximo barrido."""
    sleep_fn = sleep_fn or asyncio.sleep
    resolved = 0
    pulls = session.query(BattlePull).filter_by(battle_id=battle.id).all()
    for p in pulls:
        if p.nft_address or not p.memo:
            continue
        try:
            res = await gacha.open_pack(p.memo)
            attempts = 0
            while res.get("pending") and attempts < max_attempts:
                await sleep_fn(delay)
                res = await gacha.open_pack(p.memo)
                attempts += 1
            if res.get("pending") or not res.get("nft_address"):
                logger.warning("reconcile: pull %s in battle %s still unresolved", p.memo, battle.id)
                continue
            p.nft_address = res["nft_address"]
            p.insured_value = res.get("insured_value") or 0
            p.grade = res.get("grade")
            p.rarity = res.get("rarity")
            p.year = res.get("year")
            p.name = res.get("name")
            p.auto_sold = bool(res.get("auto_sold"))
            p.buyback_amount = res.get("buyback_amount")
            session.commit()
            resolved += 1
            logger.info("reconcile: pull %s in battle %s resolved late to %s",
                        p.memo, battle.id, p.nft_address)
        except Exception as exc:
            logger.warning("reconcile: open_pack failed for %s in battle %s: %s",
                           p.memo, battle.id, exc)
    return resolved


def has_pending_refunds(session, battle) -> bool:
    """True si alguna pull del battle sigue sin refund (guía del barrido post-void)."""
    pulls = session.query(BattlePull).filter_by(battle_id=battle.id).all()
    return any(not p.refunded for p in pulls)
