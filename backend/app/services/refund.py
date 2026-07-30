"""Resilient void refunds (injected I/O, mirrors settle_cards_to_winner: bounded retries, never raises).
Called by the wiring when a run returns 'voided'. Logs no secrets."""
from __future__ import annotations
import asyncio
import logging
from datetime import datetime, timezone

from app.services.pack_engine import _wait_in_escrow
from app.services.nft_transfer import UnsupportedNftStandard
from app.services.onchain_policy import CONFIRM_POLLS, CONFIRM_DELAY

logger = logging.getLogger(__name__)


async def _sign_submit_retry(build_tx, *, signer, escrow_wallet_id, submit_tx,
                             sleep_fn, wait_delay, max_attempts, ctx, operator_wallet_id=None) -> bool:
    """build_tx() → sign(escrow [+ operator fee-payer]) → submit, with bounded retries.
    When operator_wallet_id is set the operator co-signs as fee-payer (the tx must be built with
    fee_payer=operator), so the escrow never needs SOL. UnsupportedNftStandard → give up (no
    retry). Never raises. Returns True on success."""
    for _ in range(max_attempts):
        try:
            tx = await build_tx()
            signed = await signer.sign_solana(escrow_wallet_id, tx)
            if operator_wallet_id:
                signed = await signer.sign_solana(operator_wallet_id, signed)  # operator pays the fee
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
                           confirm_in_escrow, sleep_fn=None, wait_max_attempts=CONFIRM_POLLS,
                           wait_delay=CONFIRM_DELAY, max_attempts=3, operator_wallet_id=None) -> None:
    """Pack Battle void refund: return each puller their own pull — the non-common card, or the
    auto-sold common's buyback_amount USDC. No-op if there is no escrow (pre-flight void). Never raises."""
    sleep_fn = sleep_fn or asyncio.sleep
    if not escrow_address:
        return
    from app.models import BattlePull
    pulls = session.query(BattlePull).filter_by(battle_id=battle.id).all()
    for p in pulls:
        if p.refunded:
            continue
        if p.auto_sold:
            if not p.buyback_amount:
                p.refunded = True   # nada que devolver; no re-seleccionar en barridos
                session.commit()
                continue
            # NOTE: refunded is only set to True AFTER _sign_submit_retry succeeds (below),
            # not before the submit. This ordering is deliberate: if the process crashes
            # between the submit landing and this commit, a later sweep will re-send the
            # USDC (at-least-once — the player gets paid twice at worst, which is
            # recoverable). Flipping refunded=True before the submit would risk the
            # opposite failure — a crash there means the player is marked paid but never
            # actually receives the USDC, and no sweep will ever retry it. Do not swap
            # this order "to avoid double-pay".
            ok = await _sign_submit_retry(
                lambda p=p: build_usdc_transfer_tx(escrow_address, p.player_wallet, p.buyback_amount),
                signer=signer, escrow_wallet_id=escrow_wallet_id, submit_tx=submit_tx,
                sleep_fn=sleep_fn, wait_delay=wait_delay, max_attempts=max_attempts,
                ctx=f"pack void usdc {p.player_wallet} in {battle.id}", operator_wallet_id=operator_wallet_id)
        elif p.nft_address:
            async def _build(p=p):
                await _wait_in_escrow(confirm_in_escrow, escrow_address, p.nft_address,
                                      sleep_fn, wait_max_attempts, wait_delay)
                return await build_transfer_tx(escrow_address, p.player_wallet, p.nft_address)
            ok = await _sign_submit_retry(
                _build, signer=signer, escrow_wallet_id=escrow_wallet_id, submit_tx=submit_tx,
                sleep_fn=sleep_fn, wait_delay=wait_delay, max_attempts=max_attempts,
                ctx=f"pack void card {p.nft_address} in {battle.id}",
                operator_wallet_id=operator_wallet_id)
        else:
            continue   # memo sin resolver: lo cubre la reconciliación, no hay nada que devolver aún
        if ok:
            p.refunded = True
            session.commit()


async def refund_royale_void(session, battle, *, escrow_wallet_id, escrow_address,
                             build_transfer_tx, submit_tx, signer, build_usdc_transfer_tx,
                             buyback_to_escrow, escrow_usdc_balance, confirm_in_escrow,
                             sleep_fn=None, wait_max_attempts=CONFIRM_POLLS, wait_delay=CONFIRM_DELAY, max_attempts=3,
                             operator_wallet_id=None) -> None:
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
        if p.player_wallet not in alive or p.refunded:
            continue
        if p.auto_sold:
            if not p.buyback_amount:
                p.refunded = True   # nada que devolver; no re-seleccionar en barridos
                session.commit()
                continue
            ok = await _sign_submit_retry(
                lambda p=p: build_usdc_transfer_tx(escrow_address, p.player_wallet, p.buyback_amount),
                signer=signer, escrow_wallet_id=escrow_wallet_id, submit_tx=submit_tx,
                sleep_fn=sleep_fn, wait_delay=wait_delay, max_attempts=max_attempts,
                ctx=f"royale void usdc {p.player_wallet} in {battle.id}", operator_wallet_id=operator_wallet_id)
        elif p.nft_address:
            async def _build(p=p):
                await _wait_in_escrow(confirm_in_escrow, escrow_address, p.nft_address,
                                      sleep_fn, wait_max_attempts, wait_delay)
                return await build_transfer_tx(escrow_address, p.player_wallet, p.nft_address)
            ok = await _sign_submit_retry(
                _build, signer=signer, escrow_wallet_id=escrow_wallet_id, submit_tx=submit_tx,
                sleep_fn=sleep_fn, wait_delay=wait_delay, max_attempts=max_attempts,
                ctx=f"royale void card {p.nft_address} in {battle.id}",
                operator_wallet_id=operator_wallet_id)
        else:
            continue   # memo sin resolver: lo cubre la reconciliación, no hay nada que devolver aún
        if ok:
            p.refunded = True
            session.commit()

    # 3: buy back each eliminated player's non-common cards → USDC into the escrow.
    for p in pulls:
        if p.player_wallet not in eliminated or p.refunded:
            continue
        if p.auto_sold or not p.nft_address:
            p.refunded = True   # su USDC/nada quedó en el escrow por diseño; no re-seleccionar
            session.commit()
            continue
        for _ in range(max_attempts):
            try:
                await buyback_to_escrow(p.nft_address)
                p.refunded = True
                session.commit()
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
    por_wallet = {p.player_wallet: p for p in players}
    for w in alive:
        ok = await _sign_submit_retry(
            lambda w=w, share=share: build_usdc_transfer_tx(escrow_address, w, share),
            signer=signer, escrow_wallet_id=escrow_wallet_id, submit_tx=submit_tx,
            sleep_fn=sleep_fn, wait_delay=wait_delay, max_attempts=max_attempts, operator_wallet_id=operator_wallet_id,
            ctx=f"royale void leftover {w} in {battle.id}")
        # El resultado se MIRA. Antes se descartaba: un envío fallido no dejaba rastro y su parte se
        # quedaba en el escrow sin dueño conocido — medido, una royale anulada de 4 jugadores retenía
        # exactamente una parte y no había forma de saber cuál de los cuatro se quedó sin cobrar.
        fila = por_wallet.get(w)
        if ok and fila is not None:
            fila.refund_amount = (fila.refund_amount or 0) + share
            fila.refunded_at = datetime.now(timezone.utc)
            session.commit()
        elif not ok:
            logger.error("royale void: NO se pudo devolver su parte a %s en %s (queda en el escrow)",
                         w, battle.id)
