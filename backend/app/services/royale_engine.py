"""Battle Royale multi-round engine. Injected I/O for unit-testing. Pool funds each player
just-in-time; each player pays their own pull on-chain; eliminate the lowest accumulated
insured_value each round (Provably-Fair tie-break); winner takes all escrow cards."""
from __future__ import annotations
import asyncio
import logging

from app.models import BattlePlayer, BattlePull, BattleRound
from app.services.provably_fair import client_seed_round, pick_index
from app.services.pack_engine import _wait_in_escrow   # reuse the escrow-confirm poll

logger = logging.getLogger(__name__)


async def run_royale(
    session, battle, *,
    gacha, signer, resolve_wallet_id,
    distribute, confirm_usdc, confirm_in_escrow,
    build_transfer_tx, submit_tx, prepare_escrow,
    price_base, now_fn,
    sleep_fn=None, max_attempts=20, delay=3.0,
) -> str:
    """Run the royale loop; return 'settled' or 'voided'."""
    sleep_fn = sleep_fn or asyncio.sleep

    players = [
        p.player_wallet
        for p in session.query(BattlePlayer)
        .filter_by(battle_id=battle.id)
        .order_by(BattlePlayer.joined_at)
        .all()
    ]

    # Create escrow wallet (reuse pre-created one if it already exists)
    if battle.escrow_wallet_id and battle.escrow_address:
        esc = {"id": battle.escrow_wallet_id, "address": battle.escrow_address}
    else:
        esc = await signer.create_solana_wallet()
        battle.escrow_wallet_id = esc["id"]
        battle.escrow_address = esc["address"]
        session.commit()

    # Seed escrow — if this fails, void immediately (no funds moved yet)
    try:
        await prepare_escrow(esc["address"])
    except Exception as exc:
        logger.warning("royale escrow seed failed %s: %s", battle.id, exc)
        return await _void(session, battle)

    remaining = list(players)
    accumulated = {w: 0.0 for w in players}
    round_number = 0

    try:
        while len(remaining) > 1:
            round_number += 1
            round_nfts = []

            for w in remaining:
                # 1. Fund player from pool
                await distribute(esc["address"], w, price_base)

                # 2. Wait for funds to arrive
                for _ in range(max_attempts):
                    if await confirm_usdc(w, price_base):
                        break
                    await sleep_fn(delay)
                else:
                    raise RuntimeError(f"usdc not delivered to {w}")

                # 3. Player pulls (pays their own pull on-chain)
                pack = await gacha.generate_pack(
                    player_address=w,
                    pack_type=battle.machine_code,
                    alt_player_address=esc["address"],
                )
                pull = BattlePull(
                    battle_id=battle.id,
                    player_wallet=w,
                    memo=pack["memo"],
                    round_number=round_number,
                )
                session.add(pull)
                session.commit()

                signed = await signer.sign_solana(resolve_wallet_id(w), pack["transaction"])
                sub = await gacha.submit_tx(signed)
                if not sub.get("signature"):
                    raise RuntimeError("pull submit failed")

                # 4. Poll until pack opens
                res = await gacha.open_pack(pack["memo"])
                attempts = 0
                while res.get("pending") and attempts < max_attempts:
                    await sleep_fn(delay)
                    res = await gacha.open_pack(pack["memo"])
                    attempts += 1
                if res.get("pending") or not res.get("nft_address"):
                    raise RuntimeError("pull did not resolve")

                # 5. Persist result and accumulate
                pull.nft_address = res["nft_address"]
                pull.insured_value = res.get("insured_value") or 0
                pull.grade = res.get("grade")
                session.commit()

                accumulated[w] += res.get("insured_value") or 0
                round_nfts.append(res["nft_address"])

            # Eliminate the player with the lowest accumulated insured_value
            minv = min(accumulated[w] for w in remaining)
            losers = sorted([w for w in remaining if accumulated[w] == minv])

            if len(losers) == 1:
                elim, tie_idx, cs = losers[0], None, ""
            else:
                cs = client_seed_round(round_number, round_nfts)
                tie_idx = pick_index(battle.server_seed, cs, len(losers))
                elim = losers[tie_idx]

            remaining.remove(elim)

            # Persist elimination and accumulated values
            bp = session.query(BattlePlayer).filter_by(
                battle_id=battle.id, player_wallet=elim
            ).first()
            bp.eliminated_round = round_number

            for w in remaining + [elim]:
                p = session.query(BattlePlayer).filter_by(
                    battle_id=battle.id, player_wallet=w
                ).first()
                p.accumulated_value = accumulated[w]

            session.add(BattleRound(
                battle_id=battle.id,
                round_number=round_number,
                client_seed=cs,
                eliminated_wallet=elim,
                tie_break_index=tie_idx,
            ))
            session.commit()

        # Settle: transfer all escrow NFTs to winner
        winner = remaining[0]
        nfts = [
            p.nft_address
            for p in session.query(BattlePull).filter_by(battle_id=battle.id).all()
            if p.nft_address
        ]
        for nft in nfts:
            await _wait_in_escrow(
                confirm_in_escrow, esc["address"], nft, sleep_fn, max_attempts, delay
            )
            tx = await build_transfer_tx(esc["address"], winner, nft)
            signed = await signer.sign_solana(esc["id"], tx)
            await submit_tx(signed)

        battle.winner = winner
        battle.status = "settled"
        battle.settled_at = now_fn()
        session.commit()
        return "settled"

    except Exception as exc:
        logger.warning("royale failed %s: %s — voiding", battle.id, exc)
        return await _void(session, battle)


async def _void(session, battle) -> str:
    """Mark battle voided (engine-side only). Refund is handled by the wiring layer."""
    battle.status = "voided"
    session.commit()
    return "voided"
