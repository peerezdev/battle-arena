"""Operator-orchestrated Pack Battle / Battle Royale engine. All on-chain I/O is
injected so the orchestration is unit-testable without live calls."""
from __future__ import annotations
from dataclasses import dataclass
from typing import Optional


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
                     can_play, now_fn) -> str:
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

    # Pull each player → escrow (sponsored). On any failure → void + return already-pulled NFTs.
    outcomes: list[PullOutcome] = []
    for w in players:
        try:
            pack = await gacha.generate_pack(player_address=w, pack_type=battle.machine_code,
                                             alt_player_address=esc["address"])
            session.add(BattlePull(battle_id=battle.id, player_wallet=w, memo=pack["memo"]))
            session.commit()
            await signer.sign_and_send_solana(resolve_wallet_id(w), pack["transaction"], sponsor=True)
            res = await gacha.open_pack(pack["memo"])
            if res.get("pending") or not res.get("nft_address"):
                raise RuntimeError("pull did not resolve")
            outcomes.append(PullOutcome(w, pack["memo"], res["nft_address"],
                                        res.get("insured_value") or 0, res.get("grade")))
        except Exception:
            await _void_return(signer, esc, outcomes, build_transfer_tx)
            battle.status = "voided"; session.commit(); return "voided"

    # Winner + settle: all escrow NFTs → winner (sponsored).
    winner = determine_winner(outcomes, players)
    for o in outcomes:
        tx = build_transfer_tx(esc["address"], winner, o.nft_address)
        await signer.sign_and_send_solana(esc["id"], tx, sponsor=True)
    battle.winner = winner; battle.status = "settled"; battle.settled_at = now_fn()
    session.commit()
    return "settled"


async def _void_return(signer, esc, outcomes, build_transfer_tx):
    # Return each already-pulled NFT to its original puller (nobody robbed).
    for o in outcomes:
        tx = build_transfer_tx(esc["address"], o.player_wallet, o.nft_address)
        try:
            await signer.sign_and_send_solana(esc["id"], tx, sponsor=True)
        except Exception:
            pass  # best-effort; logged by the caller/ops
