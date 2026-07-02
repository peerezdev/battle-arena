"""Platform fee on battles: pct-per-player (capped) over the buyback value of the winner's
loot, collected in USDC from the winner's wallet after settle. Never blocks a settle."""
from __future__ import annotations
import asyncio
import logging

from app.config import get_settings
from app.models import BattlePull, BattlePack

logger = logging.getLogger(__name__)

USDC = 1_000_000


def fee_pct_total(n_players: int) -> float:
    """Total fee percentage for a battle: rate × players, capped."""
    s = get_settings()
    return min(s.battle_fee_pct_per_player * n_players, s.battle_fee_pct_cap)


async def compute_fee_base_units(session, battle, gacha) -> int:
    """Fee base in USDC base units over ALL the battle's pulls (winner takes the whole loot):
    auto-sold cards count their real buyback_amount; kept-as-NFT cards count
    insured_value × instantBuyback% of the pack they were pulled from (round ↔ pack sequence;
    no BattlePack rows → battle.machine_code). Unknown pct → the NFT card contributes 0."""
    pulls = session.query(BattlePull).filter_by(battle_id=battle.id).all()
    packs = session.query(BattlePack).filter_by(battle_id=battle.id).all()
    code_by_round = {p.sequence: p.machine_code for p in packs}

    try:
        ib_by_code = {m.get("code"): m.get("instantBuyback") for m in await gacha.machines()}
    except Exception as exc:
        logger.warning("fee base: machines fetch failed for battle %s: %s — NFT cards drop out",
                       battle.id, exc)
        ib_by_code = {}

    base = 0
    for p in pulls:
        if p.auto_sold:
            base += p.buyback_amount or 0
            continue
        if not p.nft_address or not p.insured_value:
            continue
        code = code_by_round.get(p.round_number, battle.machine_code)
        ib = ib_by_code.get(code)
        if not ib:
            logger.warning("fee base: no instantBuyback for machine %s (battle %s) — card %s drops out",
                           code, battle.id, p.nft_address)
            continue
        base += int(round(p.insured_value * (ib / 100.0) * USDC))
    return base
