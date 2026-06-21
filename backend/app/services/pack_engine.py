"""Operator-orchestrated Pack Battle / Battle Royale engine. All on-chain I/O is
injected so the orchestration is unit-testable without live calls."""
from __future__ import annotations
import asyncio
import logging
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class PullOutcome:
    player_wallet: str
    memo: str
    nft_address: str
    insured_value: float
    grade: Optional[int]


def determine_winner(pulls: list[PullOutcome], join_order: list[str]) -> str:
    def key(p: PullOutcome):
        # higher value, then higher grade, then earliest join (smaller index)
        return (p.insured_value or 0, p.grade or 0, -join_order.index(p.player_wallet))
    return max(pulls, key=key).player_wallet


async def _wait_in_escrow(confirm_in_escrow, escrow_address, nft_address, sleep_fn, max_attempts, delay):
    """Poll until the NFT is confirmed in the escrow on-chain; raise if it never appears."""
    for _ in range(max_attempts):
        if await confirm_in_escrow(escrow_address, nft_address):
            return
        await sleep_fn(delay)
    raise RuntimeError(f"nft {nft_address} not confirmed in escrow")


async def run_battle(session, battle, *, gacha, signer, resolve_wallet_id, build_transfer_tx,
                     submit_tx, confirm_in_escrow, can_play, now_fn, sponsor: bool = False,
                     open_max_attempts: int = 20, open_delay: float = 3.0,
                     escrow_max_attempts: int = 20, escrow_delay: float = 3.0,
                     sleep_fn=None) -> str:
    # sponsor=False → user-pays (the fee-payer wallet needs SOL). sponsor=True requires
    # Privy "App pays" gas sponsorship to be enabled for the cluster.
    # NOTE: sponsor is no longer used in settle (transfers go via our-RPC submit_tx);
    # kept in signature for API stability.
    sleep_fn = sleep_fn or asyncio.sleep
    from app.models import BattlePlayer, BattlePull
    players = [p.player_wallet for p in
               session.query(BattlePlayer).filter_by(battle_id=battle.id).order_by(BattlePlayer.joined_at).all()]

    # Pre-flight: every player must still be able to play (session signer + USDC). Else void, no charge.
    if not all(can_play(w) for w in players):
        battle.status = "voided"; session.commit(); return "voided"

    # Escrow
    esc = await signer.create_solana_wallet()
    battle.escrow_wallet_id = esc["id"]; battle.escrow_address = esc["address"]
    battle.status = "running"; session.commit()

    # Pull each player → escrow. On any failure → void + return already-pulled NFTs.
    outcomes: list[PullOutcome] = []
    for w in players:
        try:
            pack = await gacha.generate_pack(player_address=w, pack_type=battle.machine_code,
                                             alt_player_address=esc["address"])
            pull = BattlePull(battle_id=battle.id, player_wallet=w, memo=pack["memo"])
            session.add(pull); session.commit()
            # CC broadcasts the pull on its own RPC (Privy signAndSend fails — different RPC, blockhash not
            # found). CC owns the pull tx fee, so `sponsor` does NOT apply to pulls — only escrow transfers.
            signed = await signer.sign_solana(resolve_wallet_id(w), pack["transaction"])
            sub = await gacha.submit_tx(signed)
            if not sub.get("signature"):
                raise RuntimeError("pull submit returned no signature")
            # CC opens via webhook → poll while pending (don't void on a not-yet-ready pull).
            res = await gacha.open_pack(pack["memo"])
            attempts = 0
            while res.get("pending") and attempts < open_max_attempts:
                await sleep_fn(open_delay)
                res = await gacha.open_pack(pack["memo"])
                attempts += 1
            if res.get("pending") or not res.get("nft_address"):
                raise RuntimeError("pull did not resolve")
            pull.nft_address = res["nft_address"]
            pull.insured_value = res.get("insured_value") or 0
            pull.grade = res.get("grade")
            pull.rarity = res.get("rarity")
            session.commit()
            outcomes.append(PullOutcome(w, pack["memo"], res["nft_address"],
                                        res.get("insured_value") or 0, res.get("grade")))
        except Exception as exc:
            # A transient failure here may have consumed the player's CC pack memo — log it so the
            # void is traceable (no secrets: wallet + battle id + error only).
            logger.warning("pull failed for %s in battle %s: %s — voiding", w, battle.id, exc)
            await _void_return(signer, esc, outcomes, build_transfer_tx, submit_tx)
            battle.status = "voided"; session.commit(); return "voided"

    # Winner + settle: all escrow NFTs → winner.
    # Any failure mid-settle (e.g. UnsupportedNftStandard) voids the battle and returns NFTs to players.
    try:
        winner = determine_winner(outcomes, players)
        for o in outcomes:
            await _wait_in_escrow(confirm_in_escrow, esc["address"], o.nft_address,
                                  sleep_fn, escrow_max_attempts, escrow_delay)
            tx = await build_transfer_tx(esc["address"], winner, o.nft_address)
            signed = await signer.sign_solana(esc["id"], tx)
            await submit_tx(signed)
    except Exception as exc:
        logger.warning("settle failed in battle %s: %s — voiding", battle.id, exc)
        await _void_return(signer, esc, outcomes, build_transfer_tx, submit_tx)
        battle.status = "voided"; session.commit(); return "voided"

    battle.winner = winner; battle.status = "settled"; battle.settled_at = now_fn()
    session.commit()
    return "settled"


async def _void_return(signer, esc, outcomes, build_transfer_tx, submit_tx):
    # Return each already-pulled NFT to its original puller (nobody robbed).
    for o in outcomes:
        try:
            tx = await build_transfer_tx(esc["address"], o.player_wallet, o.nft_address)
            signed = await signer.sign_solana(esc["id"], tx)
            await submit_tx(signed)
        except Exception:
            logger.warning("void-return transfer failed: escrow=%s nft=%s player=%s",
                           esc.get("id"), o.nft_address, o.player_wallet)
