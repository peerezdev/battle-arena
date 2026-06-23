"""Live wiring layer for the Pack Battle engine.

Pre-fetches on-chain state (latest blockhash + per-player USDC balances) with
async HTTP calls, then runs the engine with sync closures over that cached state
so the engine's sync call-sites (resolve_wallet_id, build_transfer_tx, can_play,
now_fn) never block the event loop.
"""
from __future__ import annotations

import base64
from datetime import datetime, timezone

import httpx

from app.services.pack_engine import run_battle
from app.services.royale_engine import run_royale
from app.services.refund import refund_pack_void, refund_royale_void
from app.services.royale_funding import distribute_usdc, confirm_usdc
from app.services.solana_tx import TOKEN_PROGRAM, build_token_transfer, build_create_ata
from app.services.nft_transfer import build_transfer, submit_signed_tx, nft_in_owner
from solders.hash import Hash
from solders.message import Message
from solders.system_program import transfer, TransferParams
from solders.token.associated import get_associated_token_address
from solders.transaction import Transaction
from solders.pubkey import Pubkey


async def fetch_latest_blockhash(rpc_url: str) -> str:
    """POST getLatestBlockhash(finalized) → result.value.blockhash string."""
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getLatestBlockhash",
        "params": [{"commitment": "finalized"}],
    }
    async with httpx.AsyncClient() as client:
        resp = await client.post(rpc_url, json=payload)
        resp.raise_for_status()
        data = resp.json()
    return data["result"]["value"]["blockhash"]


async def usdc_balance_base_units(
    rpc_url: str,
    owner_address: str,
    usdc_mint: str,
    token_program: str = TOKEN_PROGRAM,
) -> int:
    """Return the owner's USDC balance in base units (integer).

    Derives the owner's ATA for usdc_mint using get_associated_token_address,
    then calls getTokenAccountBalance.  Returns 0 when:
    - The account does not exist (RPC returns an error or null value).
    - Any network or parse error occurs.
    """
    # Derive the ATA outside the try: a malformed address/mint is a data/programming
    # error that should surface, not be silently masked as a zero balance.
    owner_pk = Pubkey.from_string(owner_address)
    mint_pk = Pubkey.from_string(usdc_mint)
    prog_pk = Pubkey.from_string(token_program)
    ata_str = str(get_associated_token_address(owner_pk, mint_pk, prog_pk))

    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getTokenAccountBalance",
        "params": [ata_str, {"commitment": "confirmed"}],
    }
    # Network/RPC errors → treat as unknown balance (0). Conservative: the player is
    # gated out and the battle voids without charging anyone.
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(rpc_url, json=payload)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError:
        return 0

    if "error" in data:           # RPC error (e.g. ATA does not exist)
        return 0
    value = (data.get("result") or {}).get("value")
    if value is None:             # null value (missing account)
        return 0
    try:
        return int(value["amount"])
    except (KeyError, ValueError, TypeError):
        return 0


async def seed_escrow(
    rpc_url: str,
    signer,
    operator_wallet_id: str,
    operator_address: str,
    escrow_address: str,
    lamports: int,
    blockhash: str,
) -> str:
    """Build and submit a SOL transfer from the operator wallet to the escrow wallet.

    Uses Privy sign-only so the operator funds the escrow with gas lamports,
    then submits the signed transaction via our RPC node.
    """
    # Fail with a clear message instead of a cryptic solders "String is the wrong size"
    # from Pubkey.from_string("") when the operator wallet env vars are unset.
    if not operator_address or not operator_wallet_id:
        raise ValueError(
            "operator wallet not configured — set PRIVY_OPERATOR_WALLET_ID and "
            "PRIVY_OPERATOR_ADDRESS in backend/.env (the server wallet that funds escrow gas)"
        )
    ix = transfer(TransferParams(
        from_pubkey=Pubkey.from_string(operator_address),
        to_pubkey=Pubkey.from_string(escrow_address),
        lamports=lamports,
    ))
    msg = Message.new_with_blockhash([ix], Pubkey.from_string(operator_address), Hash.from_string(blockhash))
    tx_b64 = base64.b64encode(bytes(Transaction.new_unsigned(msg))).decode()
    signed = await signer.sign_solana(operator_wallet_id, tx_b64)
    return await submit_signed_tx(rpc_url, signed)


async def run_pack_battle_live(
    session,
    battle,
    *,
    gacha,
    signer,
    rpc_url: str,
    usdc_mint: str,
    min_usdc_base_units: int,
    token_program: str = TOKEN_PROGRAM,
    sponsor: bool = False,
    operator_wallet_id: str = "",
    operator_address: str = "",
    seed_lamports: int = 10_000_000,
) -> str:
    """Assemble live on-chain state and run the pack battle engine.

    1. Reads BattlePlayer rows (ordered by joined_at) for this battle.
    2. Pre-fetches a fresh blockhash once (finalized commitment).
    3. Pre-fetches each player's USDC balance; marks playable if >= min_usdc_base_units.
    4. Builds sync closures and delegates to run_battle().
    """
    from app.models import BattlePlayer

    players = (
        session.query(BattlePlayer)
        .filter_by(battle_id=battle.id)
        .order_by(BattlePlayer.joined_at)
        .all()
    )

    # Build wallet -> wallet_id mapping from DB rows
    wallet_to_privy_id: dict = {
        p.player_wallet: p.wallet_id for p in players
    }
    player_wallets: list[str] = [p.player_wallet for p in players]

    # Pre-fetch on-chain state: per-player USDC balances (blockhash not needed here)
    balances: dict[str, int] = {}
    for wallet in player_wallets:
        balances[wallet] = await usdc_balance_base_units(
            rpc_url, wallet, usdc_mint, token_program
        )

    playable: set[str] = {w for w, bal in balances.items() if bal >= min_usdc_base_units}

    # Sync closures — no I/O inside; the engine calls these synchronously
    def resolve_wallet_id(wallet: str):
        return wallet_to_privy_id.get(wallet)

    async def build_transfer_tx(esc, dest, nft):
        bh = await fetch_latest_blockhash(rpc_url)
        return await build_transfer(rpc_url, esc, dest, nft, bh)

    submit_tx = lambda signed: submit_signed_tx(rpc_url, signed)  # noqa: E731
    confirm_in_escrow = lambda esc, mint: nft_in_owner(rpc_url, esc, mint)  # noqa: E731

    async def prepare_escrow(esc_addr):
        bh = await fetch_latest_blockhash(rpc_url)
        await seed_escrow(
            rpc_url, signer, operator_wallet_id, operator_address, esc_addr, seed_lamports, bh
        )
        # Pre-create the escrow's USDC ATA (operator pays) so CC's turbo auto-buyback payout
        # does not revert (CreateIdempotent would otherwise exhaust the payout tx's CU budget).
        bh2 = await fetch_latest_blockhash(rpc_url)
        ata_tx = build_create_ata(esc_addr, usdc_mint, bh2, payer=operator_address)
        signed = await signer.sign_solana(operator_wallet_id, ata_tx)
        return await submit_signed_tx(rpc_url, signed)

    async def build_usdc_sweep_tx(esc_addr, winner_addr):
        bal = await usdc_balance_base_units(rpc_url, esc_addr, usdc_mint, token_program)
        if bal <= 0:
            return None
        bh = await fetch_latest_blockhash(rpc_url)
        return build_token_transfer(esc_addr, winner_addr, usdc_mint, bh, amount=bal, decimals=6)

    async def build_usdc_transfer_tx(src, dest, amount):
        bh = await fetch_latest_blockhash(rpc_url)
        return build_token_transfer(src, dest, usdc_mint, bh, amount=amount, decimals=6)

    def can_play(wallet: str) -> bool:
        return wallet in playable

    def now_fn() -> datetime:
        return datetime.now(timezone.utc)

    result = await run_battle(
        session, battle, gacha=gacha, signer=signer, resolve_wallet_id=resolve_wallet_id,
        build_transfer_tx=build_transfer_tx, submit_tx=submit_tx, prepare_escrow=prepare_escrow,
        confirm_in_escrow=confirm_in_escrow, can_play=can_play, now_fn=now_fn, sponsor=sponsor,
        build_usdc_sweep_tx=build_usdc_sweep_tx,
    )
    if result == "voided":
        await refund_pack_void(
            session, battle, escrow_wallet_id=battle.escrow_wallet_id, escrow_address=battle.escrow_address,
            build_transfer_tx=build_transfer_tx, submit_tx=submit_tx, signer=signer,
            build_usdc_transfer_tx=build_usdc_transfer_tx, confirm_in_escrow=confirm_in_escrow,
        )
    return result


async def run_royale_live(
    session,
    battle,
    *,
    gacha,
    signer,
    rpc_url: str,
    usdc_mint: str,
    operator_wallet_id: str = "",
    operator_address: str = "",
    seed_lamports: int = 10_000_000,
    price_base: int,
) -> str:
    """Assemble live on-chain state and run the royale engine.

    Unlike run_pack_battle_live, the escrow wallet is pre-created at lobby-create
    time so buy-ins can be collected before the battle starts.  This function
    therefore does NOT call signer.create_solana_wallet(); it uses the
    battle.escrow_wallet_id / battle.escrow_address that were set at create time.

    All async I/O (blockhash, distribute, confirm) is pre-built as closures so
    the royale engine can call them without awareness of RPC details.
    """
    from app.models import BattlePlayer

    players = (
        session.query(BattlePlayer)
        .filter_by(battle_id=battle.id)
        .order_by(BattlePlayer.joined_at)
        .all()
    )

    wallet_to_privy_id: dict = {p.player_wallet: p.wallet_id for p in players}

    def resolve_wallet_id(wallet: str):
        return wallet_to_privy_id.get(wallet)

    # distribute: fund a player from the escrow wallet just-in-time for their pull.
    # Fetches a fresh blockhash per call — royale spans multiple rounds/minutes.
    async def distribute(esc_addr: str, player_addr: str, amt: int) -> str:
        bh = await fetch_latest_blockhash(rpc_url)
        return await distribute_usdc(
            rpc_url, signer,
            battle.escrow_wallet_id, esc_addr,
            player_addr, usdc_mint, amt, bh,
        )

    # confirm_usdc: poll until player's ATA has at least `min_base_units`.
    async def confirm_usdc_cb(player_addr: str, min_base_units: int) -> bool:
        return await confirm_usdc(rpc_url, player_addr, usdc_mint, min_base_units)

    # Reuse the same closures as pack wiring for NFT transfer mechanics.
    # Each fetches a fresh blockhash to avoid stale-blockhash failures.
    async def build_transfer_tx(esc, dest, mint):
        bh = await fetch_latest_blockhash(rpc_url)
        return await build_transfer(rpc_url, esc, dest, mint, bh)

    submit_tx = lambda signed: submit_signed_tx(rpc_url, signed)  # noqa: E731
    confirm_in_escrow = lambda esc, mint: nft_in_owner(rpc_url, esc, mint)  # noqa: E731

    async def prepare_escrow(esc_addr):
        bh = await fetch_latest_blockhash(rpc_url)
        return await seed_escrow(
            rpc_url, signer, operator_wallet_id, operator_address, esc_addr, seed_lamports, bh
        )

    async def build_usdc_sweep_tx(esc_addr, winner_addr):
        bal = await usdc_balance_base_units(rpc_url, esc_addr, usdc_mint)
        if bal <= 0:
            return None
        bh = await fetch_latest_blockhash(rpc_url)
        return build_token_transfer(esc_addr, winner_addr, usdc_mint, bh, amount=bal, decimals=6)

    async def build_usdc_transfer_tx(src, dest, amount):
        bh = await fetch_latest_blockhash(rpc_url)
        return build_token_transfer(src, dest, usdc_mint, bh, amount=amount, decimals=6)

    async def buyback_to_escrow(nft):
        bb = await gacha.buyback(battle.escrow_address, nft)
        txb = bb.get("serialized_transaction")
        if not txb:
            return
        signed = await signer.sign_solana(battle.escrow_wallet_id, txb)
        await gacha.submit_tx(signed)   # CC is fee-payer + co-signer → submit via CC

    async def escrow_usdc_balance(esc_addr):
        return await usdc_balance_base_units(rpc_url, esc_addr, usdc_mint)

    def now_fn():
        return datetime.now(timezone.utc)

    result = await run_royale(
        session, battle, gacha=gacha, signer=signer, resolve_wallet_id=resolve_wallet_id,
        distribute=distribute, confirm_usdc=confirm_usdc_cb, confirm_in_escrow=confirm_in_escrow,
        build_transfer_tx=build_transfer_tx, submit_tx=submit_tx, prepare_escrow=prepare_escrow,
        price_base=price_base, now_fn=now_fn, build_usdc_sweep_tx=build_usdc_sweep_tx,
    )
    if result == "voided":
        await refund_royale_void(
            session, battle, escrow_wallet_id=battle.escrow_wallet_id, escrow_address=battle.escrow_address,
            build_transfer_tx=build_transfer_tx, submit_tx=submit_tx, signer=signer,
            build_usdc_transfer_tx=build_usdc_transfer_tx, buyback_to_escrow=buyback_to_escrow,
            escrow_usdc_balance=escrow_usdc_balance, confirm_in_escrow=confirm_in_escrow,
        )
    return result
