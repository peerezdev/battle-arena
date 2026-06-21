"""Battle Royale USDC funding: buy-in math + pool distribute/collect/confirm. Pulls themselves are
paid by each player's wallet (funded just-in-time from the pool)."""
from __future__ import annotations
import httpx
from solders.pubkey import Pubkey
from solders.token.associated import get_associated_token_address
from app.services.solana_tx import build_token_transfer, TOKEN_PROGRAM
from app.services.nft_transfer import submit_signed_tx


def total_pulls(n: int) -> int:
    return n * (n + 1) // 2 - 1


def royale_buyin(n: int, price_base: int) -> int:
    # integer ceiling (no float): round up so the pool always covers the pulls; remainder → winner
    total = total_pulls(n) * price_base
    return (total + n - 1) // n


async def confirm_usdc(rpc_url: str, owner: str, usdc_mint: str, min_base_units: int) -> bool:
    ata = str(get_associated_token_address(Pubkey.from_string(owner), Pubkey.from_string(usdc_mint)))
    # Network/RPC errors → treat as "not confirmed yet" (False), never crash the polling gate.
    try:
        async with httpx.AsyncClient() as c:
            r = await c.post(rpc_url, json={"jsonrpc": "2.0", "id": 1, "method": "getTokenAccountBalance",
                                            "params": [ata, {"commitment": "confirmed"}]}, timeout=20)
            r.raise_for_status(); d = r.json()
    except httpx.HTTPError:
        return False
    if "error" in d:
        return False
    v = (d.get("result") or {}).get("value")
    try:
        return v is not None and int(v["amount"]) >= min_base_units
    except (KeyError, ValueError, TypeError):
        return False


async def distribute_usdc(rpc_url, signer, escrow_wallet_id, escrow_address, player_address,
                          usdc_mint, amount, blockhash) -> str:
    tx = build_token_transfer(escrow_address, player_address, usdc_mint, blockhash, amount=amount, decimals=6)
    signed = await signer.sign_solana(escrow_wallet_id, tx)   # escrow (has SOL) is sole signer/fee-payer
    return await submit_signed_tx(rpc_url, signed)


async def collect_buyin(rpc_url, signer, player_wallet_id, player_address, operator_wallet_id,
                        operator_address, escrow_address, usdc_mint, amount, blockhash) -> str:
    # 2-signer: player = USDC authority, operator = fee-payer (player has no SOL).
    tx = build_token_transfer(player_address, escrow_address, usdc_mint, blockhash,
                              amount=amount, decimals=6, fee_payer=operator_address)
    signed = await signer.sign_solana(player_wallet_id, tx)        # player authorizes the USDC move
    signed = await signer.sign_solana(operator_wallet_id, signed)  # operator pays the fee
    return await submit_signed_tx(rpc_url, signed)
