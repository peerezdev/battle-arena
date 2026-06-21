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
from app.services.solana_tx import TOKEN_PROGRAM
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

    # Pre-fetch on-chain state (both async, done before entering the sync engine)
    blockhash = await fetch_latest_blockhash(rpc_url)

    balances: dict[str, int] = {}
    for wallet in player_wallets:
        balances[wallet] = await usdc_balance_base_units(
            rpc_url, wallet, usdc_mint, token_program
        )

    playable: set[str] = {w for w, bal in balances.items() if bal >= min_usdc_base_units}

    # Sync closures — no I/O inside; the engine calls these synchronously
    def resolve_wallet_id(wallet: str):
        return wallet_to_privy_id.get(wallet)

    build_transfer_tx = lambda esc, dest, mint: build_transfer(rpc_url, esc, dest, mint, blockhash)  # noqa: E731
    submit_tx = lambda signed: submit_signed_tx(rpc_url, signed)  # noqa: E731
    confirm_in_escrow = lambda esc, mint: nft_in_owner(rpc_url, esc, mint)  # noqa: E731
    prepare_escrow = lambda esc_addr: seed_escrow(  # noqa: E731
        rpc_url, signer, operator_wallet_id, operator_address, esc_addr, seed_lamports, blockhash
    )

    def can_play(wallet: str) -> bool:
        return wallet in playable

    def now_fn() -> datetime:
        return datetime.now(timezone.utc)

    return await run_battle(
        session,
        battle,
        gacha=gacha,
        signer=signer,
        resolve_wallet_id=resolve_wallet_id,
        build_transfer_tx=build_transfer_tx,
        submit_tx=submit_tx,
        prepare_escrow=prepare_escrow,
        confirm_in_escrow=confirm_in_escrow,
        can_play=can_play,
        now_fn=now_fn,
        sponsor=sponsor,
    )
