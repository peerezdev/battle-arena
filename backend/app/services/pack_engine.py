"""Operator-orchestrated Pack Battle / Battle Royale engine. All on-chain I/O is
injected so the orchestration is unit-testable without live calls."""
from __future__ import annotations
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


async def run_battle(session, battle, *, gacha, signer, resolve_wallet_id, build_transfer_tx,
                     can_play, now_fn, sponsor: bool = False) -> str:
    # sponsor=False → user-pays (the fee-payer wallet needs SOL). sponsor=True requires
    # Privy "App pays" gas sponsorship to be enabled for the cluster.
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
            await signer.sign_and_send_solana(resolve_wallet_id(w), pack["transaction"], sponsor=sponsor)
            res = await gacha.open_pack(pack["memo"])
            if res.get("pending") or not res.get("nft_address"):
                raise RuntimeError("pull did not resolve")
            pull.nft_address = res["nft_address"]
            pull.insured_value = res.get("insured_value") or 0
            pull.grade = res.get("grade")
            pull.rarity = res.get("rarity")
            session.commit()
            outcomes.append(PullOutcome(w, pack["memo"], res["nft_address"],
                                        res.get("insured_value") or 0, res.get("grade")))
        except Exception:
            await _void_return(signer, esc, outcomes, build_transfer_tx, sponsor)
            battle.status = "voided"; session.commit(); return "voided"

    # Winner + settle: all escrow NFTs → winner.
    winner = determine_winner(outcomes, players)
    for o in outcomes:
        tx = build_transfer_tx(esc["address"], winner, o.nft_address)
        await signer.sign_and_send_solana(esc["id"], tx, sponsor=sponsor)
    battle.winner = winner; battle.status = "settled"; battle.settled_at = now_fn()
    session.commit()
    return "settled"


async def _void_return(signer, esc, outcomes, build_transfer_tx, sponsor):
    # Return each already-pulled NFT to its original puller (nobody robbed).
    for o in outcomes:
        tx = build_transfer_tx(esc["address"], o.player_wallet, o.nft_address)
        try:
            await signer.sign_and_send_solana(esc["id"], tx, sponsor=sponsor)
        except Exception:
            logger.warning("void-return transfer failed: battle escrow=%s nft=%s player=%s",
                           esc.get("id"), o.nft_address, o.player_wallet)
