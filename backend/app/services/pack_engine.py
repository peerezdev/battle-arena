"""Operator-orchestrated Pack Battle / Battle Royale engine. All on-chain I/O is
injected so the orchestration is unit-testable without live calls."""
from __future__ import annotations
import asyncio
import logging
from dataclasses import dataclass
from typing import Optional

from app.services.provably_fair import pick_index, client_seed_from_nfts
from app.services.nft_transfer import UnsupportedNftStandard

logger = logging.getLogger(__name__)


@dataclass
class PullOutcome:
    player_wallet: str
    memo: str
    nft_address: str
    insured_value: float
    grade: Optional[int]
    auto_sold: bool = False


def determine_winner(pulls: list[PullOutcome], *, server_seed: str, client_seed: str) -> tuple[str, Optional[int]]:
    # Sum insured_value per player; highest TOTAL wins. (Single-box battles have one pull
    # per player, so the total == that pull's value — identical to the prior behavior.)
    totals: dict[str, float] = {}
    for p in pulls:
        totals[p.player_wallet] = totals.get(p.player_wallet, 0.0) + (p.insured_value or 0)
    maxv = max(totals.values())
    candidates = sorted([w for w, t in totals.items() if t == maxv])
    if len(candidates) == 1:
        return candidates[0], None
    if not server_seed:   # a tie needs the Provably-Fair seed (set at lobby creation)
        raise ValueError("server_seed must be set before a tie-break draw")
    idx = pick_index(server_seed, client_seed, len(candidates))
    return candidates[idx], idx


async def _wait_in_escrow(confirm_in_escrow, escrow_address, nft_address, sleep_fn, max_attempts, delay):
    """Poll until the NFT is confirmed in the escrow on-chain; raise if it never appears."""
    for _ in range(max_attempts):
        if await confirm_in_escrow(escrow_address, nft_address):
            return
        await sleep_fn(delay)
    raise RuntimeError(f"nft {nft_address} not confirmed in escrow")


async def settle_cards_to_winner(session, battle, *, escrow_wallet_id, escrow_address, winner,
                                 build_transfer_tx, submit_tx, signer, confirm_in_escrow,
                                 build_usdc_sweep_tx, sleep_fn, wait_max_attempts, wait_delay,
                                 max_attempts=3) -> None:
    """Resilient settle (call ONLY after the winner is decided — never voids):
    transfer each non-auto-sold escrow NFT to the winner with max_attempts total attempts per card
    (set transferred=True on success; on UnsupportedNftStandard or exhausted max_attempts leave
    transferred=False and continue), then sweep the escrow USDC to the winner with max_attempts total
    attempts. Never raises."""
    from app.models import BattlePull
    pulls = session.query(BattlePull).filter_by(battle_id=battle.id).all()
    for p in pulls:
        if p.auto_sold or not p.nft_address:
            continue
        for _ in range(max_attempts):
            try:
                await _wait_in_escrow(confirm_in_escrow, escrow_address, p.nft_address,
                                      sleep_fn, wait_max_attempts, wait_delay)
                tx = await build_transfer_tx(escrow_address, winner, p.nft_address)
                signed = await signer.sign_solana(escrow_wallet_id, tx)
                await submit_tx(signed)
                p.transferred = True
                break
            except UnsupportedNftStandard as exc:
                logger.warning("settle: unsupported nft %s in battle %s: %s — flagging",
                               p.nft_address, battle.id, exc)
                break
            except Exception as exc:
                logger.warning("settle transfer retry for %s in battle %s: %s",
                               p.nft_address, battle.id, exc)
                await sleep_fn(wait_delay)
        try:
            session.commit()
        except Exception as exc:
            logger.warning("settle commit failed in battle %s: %s", battle.id, exc)
    if build_usdc_sweep_tx is not None:
        for _ in range(max_attempts):
            try:
                sweep = await build_usdc_sweep_tx(escrow_address, winner)
                if sweep:
                    signed = await signer.sign_solana(escrow_wallet_id, sweep)
                    await submit_tx(signed)
                break
            except Exception as exc:
                logger.warning("settle usdc sweep retry in battle %s: %s", battle.id, exc)
                await sleep_fn(wait_delay)


async def run_battle(session, battle, *, gacha, signer, resolve_wallet_id, build_transfer_tx,
                     submit_tx, prepare_escrow, confirm_in_escrow, can_play, now_fn,
                     sponsor: bool = False,
                     open_max_attempts: int = 20, open_delay: float = 3.0,
                     escrow_max_attempts: int = 20, escrow_delay: float = 3.0,
                     sleep_fn=None, build_usdc_sweep_tx=None) -> str:
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

    try:
        await prepare_escrow(esc["address"])
    except Exception as exc:
        logger.warning("escrow seed failed for battle %s: %s — voiding", battle.id, exc)
        battle.status = "voided"; session.commit(); return "voided"

    # Pull each player → escrow. On any failure → void + return already-pulled NFTs.
    outcomes: list[PullOutcome] = []
    for w in players:
        try:
            pack = await gacha.generate_pack(player_address=w, pack_type=battle.machine_code,
                                             alt_player_address=esc["address"], turbo=True)
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
            pull.auto_sold = bool(res.get("auto_sold"))
            pull.buyback_amount = res.get("buyback_amount")
            session.commit()
            outcomes.append(PullOutcome(w, pack["memo"], res["nft_address"],
                                        res.get("insured_value") or 0, res.get("grade"),
                                        auto_sold=bool(res.get("auto_sold"))))
        except Exception as exc:
            # A transient failure here may have consumed the player's CC pack memo — log it so the
            # void is traceable (no secrets: wallet + battle id + error only).
            logger.warning("pull failed for %s in battle %s: %s — voiding", w, battle.id, exc)
            battle.status = "voided"; session.commit(); return "voided"

    # Winner determination can still void (e.g. tie with no server_seed). Settle itself is resilient.
    try:
        client_seed = client_seed_from_nfts([o.nft_address for o in outcomes])
        winner, tie_idx = determine_winner(outcomes, server_seed=battle.server_seed, client_seed=client_seed)
    except Exception as exc:
        logger.warning("winner determination failed in battle %s: %s — voiding", battle.id, exc)
        battle.status = "voided"; session.commit(); return "voided"

    battle.client_seed = client_seed
    battle.tie_break_index = tie_idx
    session.commit()

    await settle_cards_to_winner(
        session, battle, escrow_wallet_id=esc["id"], escrow_address=esc["address"], winner=winner,
        build_transfer_tx=build_transfer_tx, submit_tx=submit_tx, signer=signer,
        confirm_in_escrow=confirm_in_escrow, build_usdc_sweep_tx=build_usdc_sweep_tx,
        sleep_fn=sleep_fn, wait_max_attempts=escrow_max_attempts, wait_delay=escrow_delay,
    )

    battle.winner = winner; battle.status = "settled"; battle.settled_at = now_fn()
    session.commit()
    return "settled"
