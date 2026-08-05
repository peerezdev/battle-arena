"""Operator-orchestrated Pack Battle / Battle Royale engine. All on-chain I/O is
injected so the orchestration is unit-testable without live calls."""
from __future__ import annotations
import asyncio
import logging
from dataclasses import dataclass
from typing import Optional

from app.services.provably_fair import pick_index, client_seed_from_nfts
from app.services.nft_transfer import UnsupportedNftStandard
from app.services.battle_fees import collect_battle_fee
from app.services.onchain_policy import CONFIRM_POLLS, CONFIRM_DELAY
from app.services.reservations import consume

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


async def _sweep_escrow_usdc(escrow_address, winner, *, build_usdc_sweep_tx, signer,
                             escrow_wallet_id, submit_tx, sleep_fn, wait_delay, max_attempts,
                             battle_id, operator_wallet_id) -> None:
    """Manda el USDC del escrow al ganador. Acotado y sin levantar: es una sola transacción."""
    if build_usdc_sweep_tx is None:
        return
    for intento in range(max_attempts):
        try:
            sweep = await build_usdc_sweep_tx(escrow_address, winner)
            if sweep is None:
                # Saldo cero AHORA MISMO, que no es lo mismo que "no va a haber". El USDC de las
                # auto-ventas lo ingresa CC de forma asíncrona y puede aterrizar segundos después;
                # y el lector de saldo devuelve 0 cuando la petición falla, así que un 429 también
                # llega aquí. Antes esto hacía `return` y el dinero se quedaba dentro para siempre:
                # medido en devnet, 24 escrows retenían USDC sin entregar. Reintentar es la
                # diferencia entre "todavía no" y "nunca".
                if intento + 1 < max_attempts:
                    await sleep_fn(wait_delay)
                    continue
                logger.warning("settle usdc sweep: sin saldo tras %d intentos en %s",
                               max_attempts, battle_id)
                return
            signed = await signer.sign_solana(escrow_wallet_id, sweep)
            if operator_wallet_id:
                signed = await signer.sign_solana(operator_wallet_id, signed)  # operator pays the fee
            await submit_tx(signed)
            return
        except Exception as exc:
            logger.warning("settle usdc sweep retry in battle %s: %s", battle_id, exc)
            await sleep_fn(wait_delay)


async def settle_cards_to_winner(session, battle, *, escrow_wallet_id, escrow_address, winner,
                                 build_transfer_tx, submit_tx, signer, confirm_in_escrow,
                                 build_usdc_sweep_tx, sleep_fn, wait_max_attempts, wait_delay,
                                 max_attempts=3, operator_wallet_id=None) -> None:
    """Resilient settle (call ONLY after the winner is decided — never voids):
    transfer each non-auto-sold escrow NFT to the winner with max_attempts total attempts per card
    (set transferred=True on success; on UnsupportedNftStandard or exhausted max_attempts leave
    transferred=False and continue), then sweep the escrow USDC to the winner with max_attempts total
    attempts. Never raises."""
    from app.models import BattlePull

    # El BOTE primero y las cartas después. Es una sola transacción acotada, mientras que las
    # cartas pueden encadenar minutos de sondeo: dejar el dinero detrás de ellas hacía que el
    # ganador esperase por la parte lenta para cobrar la rápida.
    await _sweep_escrow_usdc(escrow_address, winner, build_usdc_sweep_tx=build_usdc_sweep_tx,
                             signer=signer, escrow_wallet_id=escrow_wallet_id, submit_tx=submit_tx,
                             sleep_fn=sleep_fn, wait_delay=wait_delay, max_attempts=max_attempts,
                             battle_id=battle.id, operator_wallet_id=operator_wallet_id)

    pulls = session.query(BattlePull).filter_by(battle_id=battle.id).all()
    for p in pulls:
        if p.auto_sold or not p.nft_address or p.transferred:
            continue
        for _ in range(max_attempts):
            try:
                await _wait_in_escrow(confirm_in_escrow, escrow_address, p.nft_address,
                                      sleep_fn, wait_max_attempts, wait_delay)
                tx = await build_transfer_tx(escrow_address, winner, p.nft_address)
                signed = await signer.sign_solana(escrow_wallet_id, tx)      # dueño de la carta
                if operator_wallet_id:
                    # El operador es el fee-payer del traspaso (lo pone build_transfer_tx) y tiene
                    # que firmarlo. Sin esto el escrow pagaría el rent de la token account del
                    # ganador — 2.039.280 lamports — y su semilla de 10M solo da para 4 cartas: de
                    # la quinta en adelante se quedaban dentro del escrow en silencio.
                    signed = await signer.sign_solana(operator_wallet_id, signed)
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

    # Segunda pasada del bote. El bucle de cartas de arriba tarda de segundos a minutos, y ese rato
    # es exactamente la ventana que CC necesita para ingresar el USDC de las auto-ventas. Barrer solo
    # al principio dejaba dentro todo lo que llegara después, y nadie volvía a mirar. Si no quedó
    # nada, el builder devuelve None y esto no cuesta más que una consulta de saldo.
    await _sweep_escrow_usdc(escrow_address, winner, build_usdc_sweep_tx=build_usdc_sweep_tx,
                             signer=signer, escrow_wallet_id=escrow_wallet_id, submit_tx=submit_tx,
                             sleep_fn=sleep_fn, wait_delay=wait_delay, max_attempts=1,
                             battle_id=battle.id, operator_wallet_id=operator_wallet_id)


async def run_battle(session, battle, *, gacha, signer, resolve_wallet_id, build_transfer_tx,
                     submit_tx, prepare_escrow, confirm_in_escrow, can_play, now_fn,
                     sponsor: bool = False,
                     open_max_attempts: int = 20, open_delay: float = 3.0,
                     escrow_max_attempts: int = CONFIRM_POLLS, escrow_delay: float = CONFIRM_DELAY,
                     sleep_fn=None, build_usdc_sweep_tx=None, operator_wallet_id="",
                     usdc_balance=None, build_usdc_transfer_tx=None) -> str:
    # sponsor=False → user-pays (the fee-payer wallet needs SOL). sponsor=True requires
    # Privy "App pays" gas sponsorship to be enabled for the cluster.
    # NOTE: sponsor is no longer used in settle (transfers go via our-RPC submit_tx);
    # kept in signature for API stability.
    sleep_fn = sleep_fn or asyncio.sleep
    from app.models import BattlePlayer, BattlePull, BattlePack
    players = [p.player_wallet for p in
               session.query(BattlePlayer).filter_by(battle_id=battle.id).order_by(BattlePlayer.joined_at).all()]

    # Pre-flight: solo SALDO USDC. Lo dice explícito porque este comentario prometía "session
    # signer + USDC" y la delegación no la mira nadie: can_play() se construye en
    # pack_orchestration como `bal >= min_usdc_base_units` y ahí no hay firma que valga.
    #
    # Consecuencia real, medida en mainnet: un jugador con saldo de sobra pero sin delegación pasa
    # este filtro, la partida arranca, y revienta después al firmar su tirada ("No valid
    # authorization keys or user signing keys available") — anulándola para TODA la sala, con el
    # escrow ya creado. En royale ocurre igual: su comprobación previa mira que el escrow tenga
    # fondos, no que los jugadores puedan firmar.
    #
    # La puerta del frontend (BattleFlow / ModeHub) cubre hoy al usuario honesto, pero se salta
    # llamando al endpoint directamente. La verificación de verdad va en el backend, al unirse.
    #
    # Se registra QUIÉN falla porque esta rama anulaba en silencio: sin escrow, sin tiradas y sin
    # una línea en el log. En producción tumbó una partida de 25 $ y averiguar el motivo costó
    # reconstruir los saldos on-chain transacción a transacción. Los saldos concretos los escribe
    # pack_orchestration, que es donde se leen.
    no_pueden = [w for w in players if not can_play(w)]
    if no_pueden:
        logger.warning("ANULADA %s (%s) al arrancar: %d de %d jugadores no pueden jugar (%s) "
                       "— no se cobra a nadie y no se llega a crear escrow",
                       battle.id, battle.mode, len(no_pueden), len(players), ", ".join(no_pueden))
        battle.status = "voided"; session.commit(); return "voided"

    # Escrow: del pool si hay alguna vacía, y solo si no, una nueva en Privy. Cada wallet nueva
    # cuenta como usuario activo en Privy, y antes se creaba una por partida sin reciclarla jamás.
    from app.services.escrow_pool import adquirir as adquirir_escrow
    esc = await adquirir_escrow(session, signer, battle.id)
    battle.escrow_wallet_id = esc["id"]; battle.escrow_address = esc["address"]
    battle.status = "running"; session.commit()

    try:
        await prepare_escrow(esc["address"])
    except Exception as exc:
        logger.warning("escrow seed failed for battle %s: %s — voiding", battle.id, exc)
        battle.status = "voided"; session.commit(); return "voided"

    # Bundle: ordered BattlePack rows (legacy battles → a 1-box bundle of machine_code)
    packs = session.query(BattlePack).filter_by(battle_id=battle.id).order_by(BattlePack.sequence).all()
    # (machine_code, precio) por caja: el precio hace falta para ir soltando el hold a medida que
    # cada caja se cobra. Partidas antiguas sin filas BattlePack → una caja por el total.
    bundle = [(p.machine_code, p.price) for p in packs] or [(battle.machine_code, battle.price)]

    # Pull each player round-by-round over the bundle → escrow. On any failure → void.
    outcomes: list[PullOutcome] = []
    for k, (machine_code, precio_caja) in enumerate(bundle, start=1):
        for w in players:
            try:
                pack = await gacha.generate_pack(player_address=w, pack_type=machine_code,
                                                 alt_player_address=esc["address"], turbo=True)
                pull = BattlePull(battle_id=battle.id, player_wallet=w, memo=pack["memo"], round_number=k)
                session.add(pull); session.commit()
                # CC broadcasts the pull on its own RPC (Privy signAndSend fails — different RPC, blockhash not
                # found). CC owns the pull tx fee, so `sponsor` does NOT apply to pulls — only escrow transfers.
                signed = await signer.sign_solana(resolve_wallet_id(w), pack["transaction"])
                sub = await gacha.submit_tx(signed)
                if not sub.get("signature"):
                    raise RuntimeError("pull submit returned no signature")
                # La caja ya está pagada: el saldo on-chain del jugador acaba de bajar, así que
                # hay que soltar esa parte del hold AHORA. Si se dejara entero hasta el final de
                # la partida, `on-chain − reservado` restaría el mismo dinero dos veces y el
                # jugador vería bajar su disponible en pleno combate sin haber perdido nada.
                consume(session, w, battle.id, precio_caja)
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
                pull.year = res.get("year")
                pull.name = res.get("name")
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

    return await _finalize_pack_battle(
        session, battle, outcomes, players,
        escrow_wallet_id=esc["id"], escrow_address=esc["address"],
        gacha=gacha, signer=signer, resolve_wallet_id=resolve_wallet_id,
        build_transfer_tx=build_transfer_tx, submit_tx=submit_tx, confirm_in_escrow=confirm_in_escrow,
        build_usdc_sweep_tx=build_usdc_sweep_tx, usdc_balance=usdc_balance,
        build_usdc_transfer_tx=build_usdc_transfer_tx, operator_wallet_id=operator_wallet_id,
        now_fn=now_fn, sleep_fn=sleep_fn, escrow_max_attempts=escrow_max_attempts, escrow_delay=escrow_delay,
    )


async def _finalize_pack_battle(session, battle, outcomes, players, *, escrow_wallet_id, escrow_address,
                                gacha, signer, resolve_wallet_id, build_transfer_tx, submit_tx,
                                confirm_in_escrow, build_usdc_sweep_tx, usdc_balance, build_usdc_transfer_tx,
                                operator_wallet_id, now_fn, sleep_fn, escrow_max_attempts, escrow_delay) -> str:
    """Decide the winner from `outcomes` and settle: transfer the kept cards + sweep the escrow USDC to
    the winner, collect the platform fee, mark settled, award loyalty. Winner-determination failure
    (e.g. a tie with no server_seed) → voided. Shared by run_battle (after pulling) and
    resume_pack_battle (after reconstructing outcomes from persisted pulls)."""
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
        session, battle, escrow_wallet_id=escrow_wallet_id, escrow_address=escrow_address, winner=winner,
        build_transfer_tx=build_transfer_tx, submit_tx=submit_tx, signer=signer,
        confirm_in_escrow=confirm_in_escrow, build_usdc_sweep_tx=build_usdc_sweep_tx,
        sleep_fn=sleep_fn, wait_max_attempts=escrow_max_attempts, wait_delay=escrow_delay,
        operator_wallet_id=operator_wallet_id,
    )

    # Visibility: a kept (non-auto-sold) card that never transferred is stuck in the escrow — e.g. a
    # devnet cNFT, or any UnsupportedNftStandard. Mainnet gacha has 0 cNFTs (all SPL), so this should
    # never fire in prod; if it does, shout so the card is recoverable instead of failing silently.
    from app.models import BattlePull
    stuck = [p for p in session.query(BattlePull).filter_by(battle_id=battle.id).all()
             if p.nft_address and not p.auto_sold and not p.transferred]
    if stuck:
        logger.error("battle %s settled to %s but %d kept card(s) NOT delivered (stuck in escrow %s): %s",
                     battle.id, winner, len(stuck), escrow_address,
                     ", ".join(f"{p.nft_address}(iv={p.insured_value})" for p in stuck))

    if usdc_balance is not None and build_usdc_transfer_tx is not None:
        await collect_battle_fee(
            session, battle, winner, len(players), gacha=gacha, signer=signer,
            resolve_wallet_id=resolve_wallet_id, submit_tx=submit_tx,
            usdc_balance=usdc_balance, build_usdc_transfer_tx=build_usdc_transfer_tx,
            operator_wallet_id=operator_wallet_id, sleep_fn=sleep_fn,
        )

    battle.winner = winner; battle.status = "settled"; battle.settled_at = now_fn()
    # Loyalty points: award each participant their buy-in (per-player = battle.price for pack).
    from app.services.referrals import award_battle_loyalty
    award_battle_loyalty(session, battle, players, float(battle.price))
    session.commit()
    return "settled"


async def resume_pack_battle(session, battle, *, gacha, signer, resolve_wallet_id, build_transfer_tx,
                             submit_tx, confirm_in_escrow, now_fn,
                             escrow_max_attempts=CONFIRM_POLLS, escrow_delay=CONFIRM_DELAY, sleep_fn=None,
                             build_usdc_sweep_tx=None, operator_wallet_id="",
                             usdc_balance=None, build_usdc_transfer_tx=None) -> str:
    """Resume a pack battle orphaned in 'running' (a backend restart killed the runner mid-flight).
    NEVER re-pulls — it uses the persisted pulls. If every player's pull resolved → settle to the
    winner. If any pull is missing/unresolved (a mid-pull crash) → void; the caller then refunds each
    puller their own pull via refund_pack_void, so nobody's cards are stranded."""
    sleep_fn = sleep_fn or asyncio.sleep
    from app.models import BattlePlayer, BattlePull, BattlePack
    players = [p.player_wallet for p in
               session.query(BattlePlayer).filter_by(battle_id=battle.id).order_by(BattlePlayer.joined_at).all()]
    packs = session.query(BattlePack).filter_by(battle_id=battle.id).order_by(BattlePack.sequence).all()
    bundle = [p.machine_code for p in packs] or [battle.machine_code]
    expected = len(players) * len(bundle)

    pulls = session.query(BattlePull).filter_by(battle_id=battle.id).all()
    resolved = [p for p in pulls if p.nft_address]
    if not battle.escrow_address or len(resolved) < expected:
        logger.warning("resume: battle %s incomplete (%d/%d pulls) — voiding", battle.id, len(resolved), expected)
        battle.status = "voided"; session.commit(); return "voided"

    outcomes = [PullOutcome(p.player_wallet, p.memo, p.nft_address, p.insured_value or 0, p.grade,
                            auto_sold=bool(p.auto_sold)) for p in resolved]
    return await _finalize_pack_battle(
        session, battle, outcomes, players,
        escrow_wallet_id=battle.escrow_wallet_id, escrow_address=battle.escrow_address,
        gacha=gacha, signer=signer, resolve_wallet_id=resolve_wallet_id,
        build_transfer_tx=build_transfer_tx, submit_tx=submit_tx, confirm_in_escrow=confirm_in_escrow,
        build_usdc_sweep_tx=build_usdc_sweep_tx, usdc_balance=usdc_balance,
        build_usdc_transfer_tx=build_usdc_transfer_tx, operator_wallet_id=operator_wallet_id,
        now_fn=now_fn, sleep_fn=sleep_fn, escrow_max_attempts=escrow_max_attempts, escrow_delay=escrow_delay,
    )
