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
from app.services.onchain_policy import CONFIRM_POLLS, CONFIRM_DELAY

logger = logging.getLogger(__name__)


async def _play_round(session, battle, *, esc_addr, remaining, accumulated, round_number,
                      gacha, signer, resolve_wallet_id, distribute, confirm_usdc,
                      price_base, sleep_fn, max_attempts, delay,
                      skip_existing=False, fund_guard=False) -> None:
    round_nfts = []
    existing = {}
    if skip_existing:
        existing = {p.player_wallet: p for p in
                    session.query(BattlePull).filter_by(battle_id=battle.id,
                                                        round_number=round_number).all()
                    if p.nft_address}
    for w in remaining:
        prev = existing.get(w)
        if prev is not None:
            round_nfts.append(prev.nft_address)   # tiró antes del restart; ya cuenta en accumulated
            continue
        # fund_guard: si el distribute pre-crash llegó, no re-fondear (doble fondeo drenaría el
        # pool y haría fallar rondas futuras). Carrera residual (distribute en vuelo que aterriza
        # tras el check) → pool corto → void limpio más adelante; aceptado en el spec.
        if not (fund_guard and await confirm_usdc(w, price_base)):
            await distribute(esc_addr, w, price_base)
        for _ in range(max_attempts):
            if await confirm_usdc(w, price_base):
                break
            await sleep_fn(delay)
        else:
            raise RuntimeError(f"usdc not delivered to {w}")
        pack = await gacha.generate_pack(player_address=w, pack_type=battle.machine_code,
                                         alt_player_address=esc_addr, turbo=True)
        pull = BattlePull(battle_id=battle.id, player_wallet=w, memo=pack["memo"],
                          round_number=round_number)
        session.add(pull)
        session.commit()
        signed = await signer.sign_solana(resolve_wallet_id(w), pack["transaction"])
        sub = await gacha.submit_tx(signed)
        if not sub.get("signature"):
            raise RuntimeError("pull submit failed")
        res = await gacha.open_pack(pack["memo"])
        attempts = 0
        while res.get("pending") and attempts < max_attempts:
            await sleep_fn(delay)
            res = await gacha.open_pack(pack["memo"])
            attempts += 1
        if res.get("pending") or not res.get("nft_address"):
            raise RuntimeError("pull did not resolve")
        pull.nft_address = res["nft_address"]
        pull.insured_value = res.get("insured_value") or 0
        pull.grade = res.get("grade")
        pull.rarity = res.get("rarity")
        pull.year = res.get("year")
        pull.name = res.get("name")
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
    bp = session.query(BattlePlayer).filter_by(battle_id=battle.id, player_wallet=elim).first()
    bp.eliminated_round = round_number
    for w in remaining + [elim]:
        p = session.query(BattlePlayer).filter_by(battle_id=battle.id, player_wallet=w).first()
        p.accumulated_value = accumulated[w]
    session.add(BattleRound(battle_id=battle.id, round_number=round_number, client_seed=cs,
                            eliminated_wallet=elim, tie_break_index=tie_idx))
    session.commit()


async def _settle_and_finish(session, battle, *, winner, players, esc, gacha, signer,
                             resolve_wallet_id, build_transfer_tx, submit_tx, confirm_in_escrow,
                             build_usdc_sweep_tx, usdc_balance, build_usdc_transfer_tx,
                             operator_wallet_id, now_fn, sleep_fn, max_attempts, delay) -> str:
    # 1) CERRAR LA PARTIDA PRIMERO. El resultado ya está decidido: lo dijo la última ronda.
    #
    # Antes esto iba al final, después de mover las cartas, y ahí está el problema: cada carta que
    # no confirma en el escrow cuesta ~3,7 min (20 sondeos × 3 s, por 3 intentos), así que con 14
    # cartas fallidas la batalla se quedaba en 'running' casi una hora. Una partida real tardó 48
    # minutos en aparecer como terminada y otra pasó de las dos horas. Para el jugador eso es una
    # partida congelada, aunque por dentro estuviera reintentando.
    #
    # Mover las cartas es CUSTODIA, no resultado. Se hace después, y si tarda o falla, la batalla
    # ya está cerrada y el jugador tiene su resultado.
    battle.winner = winner
    battle.status = "settled"
    battle.settled_at = now_fn()
    # Loyalty points: per-player buy-in for a royale is royale_buyin(max_players, price).
    from app.services.referrals import award_battle_loyalty
    from app.services.royale_funding import royale_buyin
    award_battle_loyalty(session, battle, players,
                         float(royale_buyin(battle.max_players, battle.price)))
    session.commit()

    # 2) Custodia: el bote y las cartas al ganador. Puede tardar; ya no bloquea a nadie.
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
    session.commit()
    return "settled"


async def run_royale(
    session, battle, *,
    gacha, signer, resolve_wallet_id,
    distribute, confirm_usdc, confirm_in_escrow,
    build_transfer_tx, submit_tx, prepare_escrow,
    price_base, now_fn,
    sleep_fn=None, max_attempts=CONFIRM_POLLS, delay=CONFIRM_DELAY, build_usdc_sweep_tx=None,
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
        from app.services.escrow_pool import adquirir as adquirir_escrow
        esc = await adquirir_escrow(session, signer, battle.id)   # reutiliza si el pool tiene
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
            await _play_round(
                session, battle,
                esc_addr=esc["address"], remaining=remaining, accumulated=accumulated,
                round_number=round_number,
                gacha=gacha, signer=signer, resolve_wallet_id=resolve_wallet_id,
                distribute=distribute, confirm_usdc=confirm_usdc,
                price_base=price_base, sleep_fn=sleep_fn, max_attempts=max_attempts, delay=delay,
            )

        winner = remaining[0]
        return await _settle_and_finish(
            session, battle,
            winner=winner, players=players, esc=esc,
            gacha=gacha, signer=signer, resolve_wallet_id=resolve_wallet_id,
            build_transfer_tx=build_transfer_tx, submit_tx=submit_tx,
            confirm_in_escrow=confirm_in_escrow, build_usdc_sweep_tx=build_usdc_sweep_tx,
            usdc_balance=usdc_balance, build_usdc_transfer_tx=build_usdc_transfer_tx,
            operator_wallet_id=operator_wallet_id, now_fn=now_fn,
            sleep_fn=sleep_fn, max_attempts=max_attempts, delay=delay,
        )

    except Exception as exc:
        logger.warning("royale failed %s: %s — voiding", battle.id, exc)
        return await _void(session, battle)


async def resume_royale(session, battle, *, gacha, signer, resolve_wallet_id,
                        distribute, confirm_usdc, confirm_in_escrow,
                        build_transfer_tx, submit_tx, price_base, now_fn,
                        sleep_fn=None, max_attempts=CONFIRM_POLLS, delay=CONFIRM_DELAY,
                        build_usdc_sweep_tx=None, operator_wallet_id="",
                        usdc_balance=None, build_usdc_transfer_tx=None,
                        reconcile_max_attempts=5) -> str:
    """Retoma una royale huérfana en 'running' (un restart mató el runner). Reconstruye
    remaining/accumulated/ronda desde la DB y CONTINÚA la partida: en la ronda interrumpida,
    quien ya tiró no repite; una pull a medio abrir se reconcilia (re-poll del memo) y, si es
    irrecuperable, se anula (el wiring refundea). No re-cobra buy-ins ni re-tira nada."""
    sleep_fn = sleep_fn or asyncio.sleep

    if not battle.escrow_wallet_id or not battle.escrow_address:
        logger.warning("resume royale %s: no escrow — voiding", battle.id)
        return await _void(session, battle)
    esc = {"id": battle.escrow_wallet_id, "address": battle.escrow_address}

    players = [p.player_wallet for p in
               session.query(BattlePlayer).filter_by(battle_id=battle.id)
               .order_by(BattlePlayer.joined_at).all()]
    eliminated = {p.player_wallet for p in
                  session.query(BattlePlayer).filter_by(battle_id=battle.id).all()
                  if p.eliminated_round is not None}
    remaining = [w for w in players if w not in eliminated]
    if not remaining:
        logger.warning("resume royale %s: no remaining players — voiding", battle.id)
        return await _void(session, battle)

    # Ronda interrumpida: reconciliar pulls a medio abrir ANTES de reconstruir acumulados.
    pulls = session.query(BattlePull).filter_by(battle_id=battle.id).all()
    if any(p.memo and not p.nft_address for p in pulls):
        from app.services.reconcile import reconcile_unresolved_pulls
        await reconcile_unresolved_pulls(session, battle, gacha=gacha, sleep_fn=sleep_fn,
                                         max_attempts=reconcile_max_attempts, delay=delay)
        pulls = session.query(BattlePull).filter_by(battle_id=battle.id).all()
        if any(p.memo and not p.nft_address for p in pulls):
            logger.warning("resume royale %s: unresolved pull(s) — voiding", battle.id)
            return await _void(session, battle)

    accumulated = {w: 0.0 for w in players}
    for p in pulls:
        accumulated[p.player_wallet] = accumulated.get(p.player_wallet, 0.0) + (p.insured_value or 0)

    last = (session.query(BattleRound).filter_by(battle_id=battle.id)
            .order_by(BattleRound.round_number.desc()).first())
    round_number = last.round_number if last else 0

    try:
        first = True   # solo la ronda interrumpida reusa pulls existentes y aplica el fund-guard
        while len(remaining) > 1:
            round_number += 1
            await _play_round(session, battle, esc_addr=esc["address"], remaining=remaining,
                              accumulated=accumulated, round_number=round_number,
                              gacha=gacha, signer=signer, resolve_wallet_id=resolve_wallet_id,
                              distribute=distribute, confirm_usdc=confirm_usdc,
                              price_base=price_base, sleep_fn=sleep_fn,
                              max_attempts=max_attempts, delay=delay,
                              skip_existing=first, fund_guard=first)
            first = False
        return await _settle_and_finish(session, battle, winner=remaining[0], players=players,
                                        esc=esc, gacha=gacha, signer=signer,
                                        resolve_wallet_id=resolve_wallet_id,
                                        build_transfer_tx=build_transfer_tx, submit_tx=submit_tx,
                                        confirm_in_escrow=confirm_in_escrow,
                                        build_usdc_sweep_tx=build_usdc_sweep_tx,
                                        usdc_balance=usdc_balance,
                                        build_usdc_transfer_tx=build_usdc_transfer_tx,
                                        operator_wallet_id=operator_wallet_id, now_fn=now_fn,
                                        sleep_fn=sleep_fn, max_attempts=max_attempts, delay=delay)
    except Exception as exc:
        logger.warning("royale resume failed %s: %s — voiding", battle.id, exc)
        return await _void(session, battle)


async def _void(session, battle) -> str:
    """Mark battle voided (engine-side only). Refund is handled by the wiring layer."""
    battle.status = "voided"
    session.commit()
    return "voided"
