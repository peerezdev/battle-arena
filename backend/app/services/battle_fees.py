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


async def collect_battle_fee(session, battle, winner, n_players, *, gacha, signer,
                             resolve_wallet_id, submit_tx, usdc_balance,
                             build_usdc_transfer_tx, operator_wallet_id="",
                             sleep_fn=None, max_attempts=3, delay=1.0) -> int:
    """Charge the platform fee from the winner's wallet (post-sweep) into the fee wallet.
    charged = min(fee, winner balance); zero balance still flips the idempotency flag.
    NEVER raises and never blocks the settle: exhausted retries → fee_charged stays False
    (retryable) + ERROR log. Returns the base units actually charged."""
    sleep_fn = sleep_fn or asyncio.sleep
    try:
        if battle.fee_charged:
            return 0
        s = get_settings()
        fee_wallet = s.fee_wallet_address or s.privy_operator_address
        if not fee_wallet:
            logger.warning("fee: no fee wallet configured — skipping battle %s", battle.id)
            return 0
        pct = fee_pct_total(n_players)
        if pct <= 0:
            return 0
        base = await compute_fee_base_units(session, battle, gacha)
        fee = int(round(base * pct))
        if fee <= 0:
            battle.fee_charged = True
            battle.fee_base_units = 0
            battle.fee_pct = pct
            session.commit()
            return 0

        balance = await usdc_balance(winner)
        charged = min(fee, balance)
        if charged < fee:
            logger.warning("fee: winner %s balance %s < fee %s in battle %s — charging balance",
                           winner, balance, fee, battle.id)
        if charged <= 0:
            battle.fee_charged = True
            battle.fee_base_units = 0
            battle.fee_pct = pct
            session.commit()
            return 0

        for attempt in range(max_attempts):
            try:
                tx = await build_usdc_transfer_tx(winner, fee_wallet, charged)
                signed = await signer.sign_solana(resolve_wallet_id(winner), tx)
                if operator_wallet_id:
                    signed = await signer.sign_solana(operator_wallet_id, signed)  # operator pays gas
                await submit_tx(signed)
                battle.fee_charged = True
                battle.fee_base_units = charged
                battle.fee_pct = pct
                session.commit()
                logger.info("fee: charged %s from %s in battle %s (pct=%s)",
                            charged, winner, battle.id, pct)
                return charged
            except Exception as exc:
                logger.warning("fee: transfer attempt %s/%s failed in battle %s: %s",
                               attempt + 1, max_attempts, battle.id, exc)
                await sleep_fn(delay)
        logger.error("fee: UNCOLLECTED after %s attempts in battle %s (winner %s, amount %s)",
                     max_attempts, battle.id, winner, charged)
        return 0
    except Exception as exc:  # money path: absolutely never break the caller's settle
        logger.error("fee: unexpected error in battle %s: %s — skipping", battle.id, exc)
        return 0
