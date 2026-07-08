"""Top up every test-bot wallet that holds less than TARGET USDC up to TARGET, funded from the
operator wallet. The operator is both the USDC source (transfer authority) and the fee payer, so
it signs each transfer once (quorum-owned by our Privy app → the server signer authorizes).

Balances are read with retries; a read that can't be confirmed SKIPS that bot (never treated as a
zero balance) so a flaky RPC can't cause an overpayment.

Usage (from backend/, venv active):
    python -m scripts.distribute_bot_usdc            # DRY RUN — plan only, no tx
    python -m scripts.distribute_bot_usdc --execute  # actually send the top-ups
"""
import asyncio
import json
import sys
from pathlib import Path

import httpx

from app.config import get_settings
from app.services.privy_signer import PrivySigner
from app.services.solana_tx import build_token_transfer
from app.services.nft_transfer import submit_signed_tx

MANIFEST = Path(__file__).resolve().parent.parent / ".test_players.json"
TARGET = 5_400_000_000   # 5400 USDC in base units (6 decimals)
USD = 1_000_000


async def usdc_units(client: httpx.AsyncClient, rpc: str, mint: str, owner: str) -> int:
    """Confirmed USDC balance (base units). Retries on rate-limit/network; raises if unconfirmable
    (so the caller can SKIP rather than misread as zero). An empty 200 result IS a real zero."""
    last = None
    for attempt in range(6):
        try:
            r = await client.post(rpc, json={"jsonrpc": "2.0", "id": 1, "method": "getTokenAccountsByOwner",
                                             "params": [owner, {"mint": mint}, {"encoding": "jsonParsed"}]})
            if r.status_code == 429:
                last = "429"; await asyncio.sleep(1.5 * (attempt + 1)); continue
            r.raise_for_status()
            body = r.json()
            if "error" in body:
                last = str(body["error"]); await asyncio.sleep(1.2 * (attempt + 1)); continue
            vals = body.get("result", {}).get("value", [])
            return sum(int(v["account"]["data"]["parsed"]["info"]["tokenAmount"]["amount"]) for v in vals)
        except Exception as e:  # noqa: BLE001
            last = repr(e); await asyncio.sleep(1.2 * (attempt + 1))
    raise RuntimeError(f"could not read balance for {owner[:8]}… ({last})")


async def latest_blockhash(client: httpx.AsyncClient, rpc: str) -> str:
    r = await client.post(rpc, json={"jsonrpc": "2.0", "id": 1, "method": "getLatestBlockhash",
                                     "params": [{"commitment": "finalized"}]})
    r.raise_for_status()
    return r.json()["result"]["value"]["blockhash"]


async def main(execute: bool) -> None:
    s = get_settings()
    if not (s.privy_app_id and s.privy_operator_wallet_id and s.privy_operator_address):
        print("Privy operator not configured — cannot sign transfers."); return
    rpc, mint = s.solana_rpc_url, s.cc_usdc_mint
    op_wid, op_addr = s.privy_operator_wallet_id, s.privy_operator_address
    bots = [b for b in json.load(open(MANIFEST)) if b.get("address")]

    signer = PrivySigner(app_id=s.privy_app_id, app_secret=s.privy_app_secret,
                         auth_key_pem=s.privy_auth_key, cluster_caip2=s.privy_solana_caip2,
                         quorum_id=s.privy_quorum_id)

    print(f"{'EXECUTE' if execute else 'DRY RUN'} · target ${TARGET/USD:,.0f}/bot · funded from operator {op_addr[:8]}…\n")

    async with httpx.AsyncClient(timeout=40) as c:
        op_bal = await usdc_units(c, rpc, mint, op_addr)
        print(f"operator USDC: ${op_bal/USD:,.2f}\n")
        await asyncio.sleep(0.6)

        plan = []   # (bot, address, balance, topup)
        skipped = []
        for b in bots:
            try:
                bal = await usdc_units(c, rpc, mint, b["address"])
            except RuntimeError as e:
                skipped.append((b, str(e))); print(f"  #{b['i']} SKIP — {e}"); await asyncio.sleep(0.8); continue
            topup = TARGET - bal if bal < TARGET else 0
            if topup > 0:
                plan.append((b, b["address"], bal, topup))
            print(f"  #{b['i']:<2} {b['address'][:8]}…  ${bal/USD:>10,.2f}" + (f"   → +${topup/USD:,.2f}" if topup else "   (ok)"))
            await asyncio.sleep(0.8)

        total = sum(t for *_ , t in plan)
        print(f"\n{len(plan)} bot(s) below target · total to send: ${total/USD:,.2f}")
        if skipped:
            print(f"⚠ {len(skipped)} bot(s) skipped (unreadable balance) — re-run to retry them")
        if total == 0:
            print("Nothing to distribute."); return
        if op_bal < total:
            print(f"⛔ operator only has ${op_bal/USD:,.2f} — needs ${total/USD:,.2f}. Fund it and re-run. Nothing sent.")
            return
        if not execute:
            print("\n(dry run — pass --execute to send)"); return

        print("\nSending…")
        ok = 0; failed = 0
        for b, addr, bal, topup in plan:
            try:
                bh = await latest_blockhash(c, rpc)
                tx = build_token_transfer(op_addr, addr, mint, bh, amount=topup, decimals=6, fee_payer=op_addr)
                signed = await signer.sign_solana(op_wid, tx)
                sig = await submit_signed_tx(rpc, signed)
                ok += 1
                print(f"  #{b['i']:<2} +${topup/USD:,.2f} → {addr[:8]}…  ✓ {sig[:16]}…")
            except Exception as e:  # noqa: BLE001
                failed += 1
                print(f"  #{b['i']:<2} +${topup/USD:,.2f} → {addr[:8]}…  ✗ {e}")
            await asyncio.sleep(0.5)
        print(f"\nDone · {ok} sent, {failed} failed · ${sum(t for *_, t in plan)/USD:,.2f} attempted")


if __name__ == "__main__":
    asyncio.run(main(execute="--execute" in sys.argv))
