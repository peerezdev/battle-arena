"""Instant-buyback every Collector Crypt NFT held by the 10 test-bot wallets → USDC.

Bots are quorum-owned by our Privy app, so the server signer authorizes on their behalf; CC builds
the buyback tx, co-signs and pays the fee. Enumeration uses DAS getAssetsByOwner filtered to the CC
collection.

Usage (from backend/, venv active):
    python -m scripts.buyback_bot_nfts            # DRY RUN — list NFTs + buyback quotes, no tx
    python -m scripts.buyback_bot_nfts --execute  # actually sell them back
"""
import asyncio
import json
import sys
from pathlib import Path

import httpx

from app.config import get_settings
from app.services.gacha import GachaService
from app.services.privy_signer import PrivySigner

CC_COLLECTION = "CCryptWBYktukHDQ2vHGtVcmtjXxYzvw8XNVY64YN2Yf"
MANIFEST = Path(__file__).resolve().parent.parent / ".test_players.json"


async def cc_nfts_of(rpc_url: str, owner: str) -> list[str]:
    """All mints owned by `owner` that belong to the CC collection (DAS, paginated)."""
    out: list[str] = []
    page = 1
    async with httpx.AsyncClient(timeout=30) as c:
        while True:
            r = await c.post(rpc_url, json={"jsonrpc": "2.0", "id": 1, "method": "getAssetsByOwner",
                                            "params": {"ownerAddress": owner, "page": page, "limit": 1000}})
            r.raise_for_status()
            res = r.json().get("result") or {}
            items = res.get("items") or []
            for a in items:
                grouping = a.get("grouping") or []
                if any(g.get("group_key") == "collection" and g.get("group_value") == CC_COLLECTION for g in grouping):
                    out.append(a.get("id"))
            if len(items) < 1000:
                break
            page += 1
    return out


async def main(execute: bool) -> None:
    s = get_settings()
    if not s.privy_app_id:
        print("Privy not configured — cannot sign for bot wallets."); return
    gacha = GachaService(base_url=s.gacha_base_url, api_key=s.gacha_api_key)
    signer = PrivySigner(app_id=s.privy_app_id, app_secret=s.privy_app_secret,
                         auth_key_pem=s.privy_auth_key, cluster_caip2=s.privy_solana_caip2,
                         quorum_id=s.privy_quorum_id)
    bots = json.loads(MANIFEST.read_text())
    rpc = s.solana_rpc_url

    print(f"{'EXECUTE' if execute else 'DRY RUN'} · {len(bots)} bots\n")
    grand_total = 0.0
    sold = 0
    failed = 0

    for b in bots:
        addr, wid, idx = b["address"], b["id"], b.get("i")
        try:
            mints = await cc_nfts_of(rpc, addr)
        except Exception as e:
            print(f"bot #{idx} {addr[:6]}… — DAS failed: {str(e)[:80]}"); continue
        if not mints:
            print(f"bot #{idx} {addr[:6]}… — no CC NFTs")
            continue
        print(f"bot #{idx} {addr[:6]}… — {len(mints)} CC NFTs")
        for mint in mints:
            try:
                avail = await gacha.buyback_available(addr, mint)
            except Exception as e:
                print(f"   {mint[:6]}…  quote failed: {str(e)[:70]}"); failed += 1; continue
            if not avail.get("available"):
                print(f"   {mint[:6]}…  not buyable — skip"); continue
            amt = (avail.get("amount") or 0) / 1e6   # CC returns USDC base units
            if not execute:
                print(f"   {mint[:6]}…  would sell for ${amt:,.2f}")
                grand_total += amt; sold += 1
                continue
            try:
                bb = await gacha.buyback(addr, mint)
                txb = bb.get("serialized_transaction")
                if not txb:
                    print(f"   {mint[:6]}…  no tx returned — skip"); failed += 1; continue
                signed = await signer.sign_solana(wid, txb)
                await gacha.submit_tx(signed)
                got = (bb.get("refund_amount") or avail.get("amount") or 0) / 1e6
                print(f"   {mint[:6]}…  SOLD ${got:,.2f} ✓")
                grand_total += got; sold += 1
                await asyncio.sleep(1.0)   # let CC settle + avoid throttling
            except Exception as e:
                print(f"   {mint[:6]}…  buyback failed: {str(e)[:80]}"); failed += 1

    print(f"\n{'Sold' if execute else 'Would sell'}: {sold} NFTs · ${grand_total:,.2f} total"
          + (f" · {failed} failed" if failed else ""))


if __name__ == "__main__":
    asyncio.run(main(execute="--execute" in sys.argv))
