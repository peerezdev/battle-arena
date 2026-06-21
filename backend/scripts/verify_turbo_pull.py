"""Turbo pull verification (devnet) — ¿el auto-buyback de CC en modo turbo
manda el USDC al escrow (altPlayerAddress) o al jugador (playerAddress)?

Hace UNA tirada turbo real: generatePack(turbo=True, alt=escrow) → Privy sign-only
→ CC submitTransaction → openPack. Registra saldos USDC de USER y ESCROW antes/después
para deducir el destino del USDC de una common auto-vendida.

Run:  cd backend && PYTHONPATH=. .venv/bin/python3 scripts/verify_turbo_pull.py
Gasta ~50 de CC-USDC (devnet, sin valor real).
"""
import asyncio
import base64
import sys

import httpx
from solders.pubkey import Pubkey
from solders.token.associated import get_associated_token_address

from app.config import get_settings
from app.services.gacha import GachaService
from app.services.privy_signer import PrivySigner

USER = "8QDBKx8P3pxkRhiqyXFtYcPPf2CM1F5NiE5A8yjkgtm6"
WALLET_ID = "ci1hz21vvxpqpqkyvsffeb7n"
ESCROW = "9oZgd4eviozqaYu7KwCTctAYgsRTWtF3McJARaztPsRQ"
MACHINE = "pokemon_50"
USDC_MINT = "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr"
RPC = "https://api.devnet.solana.com"


def usdc_balance(owner: str) -> float:
    ata = str(get_associated_token_address(Pubkey.from_string(owner), Pubkey.from_string(USDC_MINT)))
    r = httpx.post(RPC, json={"jsonrpc": "2.0", "id": 1, "method": "getTokenAccountBalance",
                              "params": [ata, {"commitment": "confirmed"}]}, timeout=15).json()
    v = (r.get("result") or {}).get("value")
    try:
        return float(v["uiAmountString"]) if v else 0.0
    except (KeyError, TypeError):
        return 0.0


async def main() -> int:
    s = get_settings()
    gacha = GachaService(base_url=s.gacha_base_url, api_key=s.gacha_api_key)
    signer = PrivySigner(app_id=s.privy_app_id, app_secret=s.privy_app_secret,
                         auth_key_pem=s.privy_auth_key, cluster_caip2=s.privy_solana_caip2)
    print("gacha:", s.gacha_base_url, "| signer:", signer.enabled, "| machine:", MACHINE)

    user_0, esc_0 = usdc_balance(USER), usdc_balance(ESCROW)
    print(f"\nANTES  → USER: {user_0} USDC | ESCROW: {esc_0} USDC")

    # generatePack TURBO + alt=escrow
    raw = await gacha._request("POST", "/api/generatePack", json={
        "playerAddress": USER, "packType": MACHINE, "altPlayerAddress": ESCROW, "turbo": True})
    memo, tx_b64 = raw.get("memo"), raw.get("transaction")
    print("generatePack(turbo) OK | memo:", memo)

    print("→ firmando (Privy sign-only) + emitiendo por CC…")
    signed = await signer.sign_solana(WALLET_ID, tx_b64)
    sub = await gacha.submit_tx(signed)
    h = sub.get("signature")
    print("✅ emitida — sig:", h)
    if h:
        print("   explorer:", f"https://explorer.solana.com/tx/{h}?cluster=devnet")

    print("\n→ abriendo el pack (poll)…")
    res = None
    for i in range(20):
        res = await gacha.open_pack(memo)
        if not res.get("pending"):
            break
        print(f"   pending… ({i+1})")
        await asyncio.sleep(3)
    if not res or res.get("pending"):
        print("❌ openPack sigue pending"); return 1

    print("\n=== RESULTADO openPack ===")
    print(f"   rarity:        {res.get('rarity')}")
    print(f"   auto_sold:     {res.get('auto_sold')}  (TURBO_MODE_BUYBACK)")
    print(f"   buyback_amount:{res.get('buyback_amount')}")
    print(f"   insured_value: {res.get('insured_value')}")
    print(f"   nft_address:   {res.get('nft_address')}")
    print(f"   name:          {res.get('name')}")

    # poll saldos (el USDC del buyback puede tardar unos segundos en liquidar)
    print("\n→ esperando liquidación de saldos…")
    user_1, esc_1 = user_0, esc_0
    for i in range(10):
        await asyncio.sleep(3)
        user_1, esc_1 = usdc_balance(USER), usdc_balance(ESCROW)
        if esc_1 != esc_0 or abs((user_0 - user_1)) > 0:
            # algo se movió; deja un par de iteraciones para estabilizar
            if i >= 2:
                break
    print(f"\nDESPUÉS → USER: {user_1} USDC (Δ {user_1 - user_0:+.2f}) | ESCROW: {esc_1} USDC (Δ {esc_1 - esc_0:+.2f})")

    print("\n=== VEREDICTO ===")
    if res.get("auto_sold"):
        if esc_1 - esc_0 > 0.0:
            print("✅ TURBO USDC → ESCROW. El auto-buyback paga al altPlayerAddress.")
            print("   → turbo sirve directo: ganador se lleva cartas no-common + USDC. SIN buyback manual.")
        elif (user_0 - user_1) < 50:  # pagó <50 neto → recuperó algo en su wallet
            print("❌ TURBO USDC → JUGADOR. El auto-buyback paga al playerAddress.")
            print("   → turbo NO sirve tal cual para batallas; haría falta buyback manual (escrow recompra).")
        else:
            print("⚠️  No detecto el USDC del buyback en ninguno de los dos (¿delay? revisa explorer).")
    else:
        print("ℹ️  La carta NO fue auto-vendida (no-common) → fue al escrow como NFT.")
        print("   Para ver el caso common (auto-venta) hay que repetir la tirada.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
