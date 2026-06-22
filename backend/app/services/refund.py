"""Resilient void refunds (injected I/O, mirrors settle_cards_to_winner: bounded retries, never raises).
Called by the wiring when a run returns 'voided'. Logs no secrets."""
from __future__ import annotations
import asyncio
import logging

from app.services.pack_engine import _wait_in_escrow
from app.services.nft_transfer import UnsupportedNftStandard

logger = logging.getLogger(__name__)


async def _sign_submit_retry(build_tx, *, signer, escrow_wallet_id, submit_tx,
                             sleep_fn, wait_delay, max_attempts, ctx) -> bool:
    """build_tx() → sign(escrow) → submit, with bounded retries. UnsupportedNftStandard → give up (no
    retry). Never raises. Returns True on success."""
    for _ in range(max_attempts):
        try:
            tx = await build_tx()
            signed = await signer.sign_solana(escrow_wallet_id, tx)
            await submit_tx(signed)
            return True
        except UnsupportedNftStandard as exc:
            logger.warning("%s: unsupported — flagging: %s", ctx, exc)
            return False
        except Exception as exc:
            logger.warning("%s: retry: %s", ctx, exc)
            await sleep_fn(wait_delay)
    return False


async def refund_pack_void(session, battle, *, escrow_wallet_id, escrow_address,
                           build_transfer_tx, submit_tx, signer, build_usdc_transfer_tx,
                           confirm_in_escrow, sleep_fn=None, wait_max_attempts=20,
                           wait_delay=3.0, max_attempts=3) -> None:
    """Pack Battle void refund: return each puller their own pull — the non-common card, or the
    auto-sold common's buyback_amount USDC. No-op if there is no escrow (pre-flight void). Never raises."""
    sleep_fn = sleep_fn or asyncio.sleep
    if not escrow_address:
        return
    from app.models import BattlePull
    pulls = session.query(BattlePull).filter_by(battle_id=battle.id).all()
    for p in pulls:
        if p.auto_sold:
            if not p.buyback_amount:
                continue
            await _sign_submit_retry(
                lambda p=p: build_usdc_transfer_tx(escrow_address, p.player_wallet, p.buyback_amount),
                signer=signer, escrow_wallet_id=escrow_wallet_id, submit_tx=submit_tx,
                sleep_fn=sleep_fn, wait_delay=wait_delay, max_attempts=max_attempts,
                ctx=f"pack void usdc {p.player_wallet} in {battle.id}")
        elif p.nft_address:
            async def _build(p=p):
                await _wait_in_escrow(confirm_in_escrow, escrow_address, p.nft_address,
                                      sleep_fn, wait_max_attempts, wait_delay)
                return await build_transfer_tx(escrow_address, p.player_wallet, p.nft_address)
            await _sign_submit_retry(
                _build, signer=signer, escrow_wallet_id=escrow_wallet_id, submit_tx=submit_tx,
                sleep_fn=sleep_fn, wait_delay=wait_delay, max_attempts=max_attempts,
                ctx=f"pack void card {p.nft_address} in {battle.id}")


async def refund_royale_void(session, battle, *, escrow_wallet_id, escrow_address,
                             build_transfer_tx, submit_tx, signer, build_usdc_transfer_tx,
                             buyback_to_escrow, escrow_usdc_balance, confirm_in_escrow,
                             sleep_fn=None, wait_max_attempts=20, wait_delay=3.0, max_attempts=3) -> None:
    """Battle Royale void refund: alive players (eliminated_round IS NULL) get their own pulls (non-common
    cards + auto-sold commons' USDC); each eliminated player's non-common cards are bought back; the leftover
    escrow USDC is split equally among the alive. Eliminated get nothing. No-op if no escrow. Never raises."""
    sleep_fn = sleep_fn or asyncio.sleep
    if not escrow_address:
        return
    from app.models import BattlePull, BattlePlayer
    players = session.query(BattlePlayer).filter_by(battle_id=battle.id).all()
    alive = sorted({p.player_wallet for p in players if p.eliminated_round is None})
    eliminated = {p.player_wallet for p in players if p.eliminated_round is not None}
    pulls = session.query(BattlePull).filter_by(battle_id=battle.id).all()

    # 1+2: return alive players' own pulls (cards + auto-sold commons' USDC).
    for p in pulls:
        if p.player_wallet not in alive:
            continue
        if p.auto_sold:
            if p.buyback_amount:
                await _sign_submit_retry(
                    lambda p=p: build_usdc_transfer_tx(escrow_address, p.player_wallet, p.buyback_amount),
                    signer=signer, escrow_wallet_id=escrow_wallet_id, submit_tx=submit_tx,
                    sleep_fn=sleep_fn, wait_delay=wait_delay, max_attempts=max_attempts,
                    ctx=f"royale void usdc {p.player_wallet} in {battle.id}")
        elif p.nft_address:
            async def _build(p=p):
                await _wait_in_escrow(confirm_in_escrow, escrow_address, p.nft_address,
                                      sleep_fn, wait_max_attempts, wait_delay)
                return await build_transfer_tx(escrow_address, p.player_wallet, p.nft_address)
            await _sign_submit_retry(
                _build, signer=signer, escrow_wallet_id=escrow_wallet_id, submit_tx=submit_tx,
                sleep_fn=sleep_fn, wait_delay=wait_delay, max_attempts=max_attempts,
                ctx=f"royale void card {p.nft_address} in {battle.id}")

    # 3: buy back each eliminated player's non-common cards → USDC into the escrow.
    for p in pulls:
        if p.player_wallet in eliminated and not p.auto_sold and p.nft_address:
            for _ in range(max_attempts):
                try:
                    await buyback_to_escrow(p.nft_address)
                    break
                except Exception as exc:
                    logger.warning("royale void buyback %s in %s: retry: %s", p.nft_address, battle.id, exc)
                    await sleep_fn(wait_delay)

    # 4+5: split the leftover escrow USDC equally among the alive.
    if not alive:
        return
    leftover = await escrow_usdc_balance(escrow_address)
    share = leftover // len(alive)
    if share <= 0:
        return
    for w in alive:
        await _sign_submit_retry(
            lambda w=w, share=share: build_usdc_transfer_tx(escrow_address, w, share),
            signer=signer, escrow_wallet_id=escrow_wallet_id, submit_tx=submit_tx,
            sleep_fn=sleep_fn, wait_delay=wait_delay, max_attempts=max_attempts,
            ctx=f"royale void leftover {w} in {battle.id}")
