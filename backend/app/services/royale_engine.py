"""Battle Royale multi-round engine. Injected I/O for unit-testing. Pool funds each player
just-in-time; each player pays their own pull on-chain; eliminate the lowest accumulated
insured_value each round (Provably-Fair tie-break); winner takes all escrow cards."""
from __future__ import annotations
import asyncio
import logging

from app.models import BattlePlayer, BattlePull, BattleRound
from app.services.provably_fair import client_seed_round, pick_index
from app.services.pack_engine import _wait_in_escrow, settle_cards_to_winner
from app.services.battle_fees import collect_battle_fee

logger = logging.getLogger(__name__)


async def run_royale(
    session, battle, *,
    gacha, signer, resolve_wallet_id,
    distribute, confirm_usdc, confirm_in_escrow,
    build_transfer_tx, submit_tx, prepare_escrow,
    price_base, now_fn,
    sleep_fn=None, max_attempts=20, delay=3.0, build_usdc_sweep_tx=None,
    escrow_usdc_balance=None, operator_wallet_id="",
    usdc_balance=None, build_usdc_transfer_tx=None,
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

    # Fail safe: the escrow must hold what the rounds will distribute (sum over rounds =
    # price_base * (n(n+1)/2 - 1)). If a buy-in is missing, void cleanly NOW — after the SOL
    # seed so the refund works — instead of draining the escrow and failing mid-distribute.
    if escrow_usdc_balance is not None and len(players) > 1:
        n = len(players)
        expected = price_base * (n * (n + 1) // 2 - 1)
        have = 0
        for _ in range(max_attempts):  # tolerate confirmation lag before deciding it's short
            have = await escrow_usdc_balance(esc["address"])
            if have >= expected:
                break
            await sleep_fn(delay)
        logger.warning("royale %s funding check: have=%s expected=%s players=%s", battle.id, have, expected, n)
        if have < expected:
            logger.warning("royale %s underfunded escrow: have %s need %s — voiding", battle.id, have, expected)
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
                    turbo=True,
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
                pull.rarity = res.get("rarity")
                pull.auto_sold = bool(res.get("auto_sold"))
                pull.buyback_amount = res.get("buyback_amount")
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

        # Settle: transfer all non-auto-sold escrow NFTs + the escrow USDC to the winner (resilient).
        winner = remaining[0]
        await settle_cards_to_winner(
            session, battle, escrow_wallet_id=esc["id"], escrow_address=esc["address"], winner=winner,
            build_transfer_tx=build_transfer_tx, submit_tx=submit_tx, signer=signer,
            confirm_in_escrow=confirm_in_escrow, build_usdc_sweep_tx=build_usdc_sweep_tx,
            sleep_fn=sleep_fn, wait_max_attempts=max_attempts, wait_delay=delay,
            operator_wallet_id=operator_wallet_id,
        )

        if usdc_balance is not None and build_usdc_transfer_tx is not None:
            await collect_battle_fee(
                session, battle, winner, len(players), gacha=gacha, signer=signer,
                resolve_wallet_id=resolve_wallet_id, submit_tx=submit_tx,
                usdc_balance=usdc_balance, build_usdc_transfer_tx=build_usdc_transfer_tx,
                operator_wallet_id=operator_wallet_id, sleep_fn=sleep_fn,
            )

        battle.winner = winner
        battle.status = "settled"
        battle.settled_at = now_fn()
        # Loyalty points: per-player buy-in for a royale is royale_buyin(max_players, price).
        from app.services.referrals import award_battle_loyalty
        from app.services.royale_funding import royale_buyin
        award_battle_loyalty(session, battle, players,
                             float(royale_buyin(battle.max_players, battle.price)))
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
