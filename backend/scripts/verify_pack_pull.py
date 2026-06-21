"""Pack Battle live verification — FASE 1 (devnet).

Hace UNA tirada real de CC firmada SERVER-SIDE por el backend (session signer),
entregada a una dirección desechable vía altPlayerAddress, y verifica que el NFT
aterrizó ahí. Prueba lo pivote: firma delegada en una tirada real + altPlayerAddress
+ openPack. NO usa escrow-Privy ni SOL (eso es Fase 2).

Run:  cd backend && PYTHONPATH=. .venv/bin/python3 scripts/verify_pack_pull.py
Gasta ~25 de CC-USDC (devnet, sin valor real).
"""
import asyncio
import base64
import sys

import httpx
from solders.keypair import Keypair

from app.config import get_settings
from app.services.gacha import GachaService
from app.services.privy_signer import PrivySigner, PrivySignerError, authorization_signature

USER = "8QDBKx8P3pxkRhiqyXFtYcPPf2CM1F5NiE5A8yjkgtm6"
WALLET_ID = "ci1hz21vvxpqpqkyvsffeb7n"
MACHINE = "pokemon_50"
RPC = "https://api.devnet.solana.com"
TOKEN_PROGRAMS = ("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")


def privy_sign_only(s, wallet_id: str, tx_b64: str) -> str:
    """Privy signTransaction (sign-only, no broadcast) → signed tx base64."""
    url = f"https://api.privy.io/v1/wallets/{wallet_id}/rpc"
    body = {"method": "signTransaction", "params": {"transaction": tx_b64, "encoding": "base64"}}
    basic = base64.b64encode(f"{s.privy_app_id}:{s.privy_app_secret}".encode()).decode()
    headers = {"Authorization": f"Basic {basic}", "privy-app-id": s.privy_app_id,
               "privy-authorization-signature": authorization_signature("POST", url, body, s.privy_app_id, s.privy_auth_key),
               "Content-Type": "application/json"}
    r = httpx.post(url, json=body, headers=headers, timeout=30)
    r.raise_for_status()
    d = r.json().get("data", {})
    return d.get("signed_transaction") or d.get("signedTransaction")


def owner_holds_mint(owner: str, mint: str) -> bool:
    for prog in TOKEN_PROGRAMS:
        r = httpx.post(RPC, json={"jsonrpc": "2.0", "id": 1, "method": "getTokenAccountsByOwner",
                                  "params": [owner, {"mint": mint}, {"encoding": "jsonParsed"}]},
                       timeout=20).json()
        for a in (r.get("result", {}) or {}).get("value", []):
            amt = a["account"]["data"]["parsed"]["info"]["tokenAmount"]["uiAmountString"]
            if amt and float(amt) >= 1:
                return True
    return False


async def main() -> int:
    s = get_settings()
    gacha = GachaService(base_url=s.gacha_base_url, api_key=s.gacha_api_key)
    signer = PrivySigner(app_id=s.privy_app_id, app_secret=s.privy_app_secret,
                         auth_key_pem=s.privy_auth_key, cluster_caip2=s.privy_solana_caip2)
    print("gacha:", s.gacha_base_url, "| signer enabled:", signer.enabled, "| machine:", MACHINE)

    escrow = str(Keypair().pubkey())   # dirección desechable = "escrow" de prueba
    print("altPlayerAddress (desechable):", escrow)

    pack = await gacha.generate_pack(player_address=USER, pack_type=MACHINE, alt_player_address=escrow)
    memo, tx_b64 = pack["memo"], pack["transaction"]
    print("generatePack OK | memo:", memo, "| tx bytes:", len(base64.b64decode(tx_b64)))

    print("\n→ firmando la tirada server-side (Privy signTransaction, sign-only)…")
    signed = privy_sign_only(s, WALLET_ID, tx_b64)
    if not signed:
        print("❌ Privy no devolvió signed_transaction"); return 1
    print("   firmada server-side OK | emitiendo por CC (submitTransaction)…")
    try:
        sub = await gacha.submit_tx(signed)
        h = sub.get("signature")
        print("✅ tirada emitida por CC — signature:", h, "| status:", sub.get("confirmation_status"))
        if h:
            print("   explorer:", f"https://explorer.solana.com/tx/{h}?cluster=devnet")
    except Exception as e:
        print("❌ falló submitTransaction:", e); return 1

    print("\n→ abriendo el pack (poll)…")
    res = None
    for i in range(15):
        res = await gacha.open_pack(memo)
        if not res.get("pending"):
            break
        print(f"   pending… ({i+1})")
        await asyncio.sleep(3)
    if not res or res.get("pending"):
        print("❌ openPack sigue pending tras el poll"); return 1
    nft = res["nft_address"]
    print(f"✅ pack abierto — nft: {nft}")
    print(f"   insured_value: {res.get('insured_value')} | grade: {res.get('grade')} | rarity: {res.get('rarity')} | name: {res.get('name')}")

    print("\n→ verificando que el NFT llegó al altPlayerAddress…")
    held = False
    for i in range(10):
        if owner_holds_mint(escrow, nft):
            held = True
            break
        print(f"   aún no visible… ({i+1})")
        await asyncio.sleep(3)
    if held:
        print(f"\n🎉 FASE 1 OK — el NFT {nft[:8]}… está en {escrow[:8]}… (NO en tu wallet).")
        print("   → firma server-side de una tirada real + entrega por altPlayerAddress: PROBADO.")
        return 0
    print(f"\n⚠️  La tirada se emitió y abrió, pero no veo el NFT en {escrow} todavía.")
    print("   Puede ser delay de indexación; revisa en explorer:", f"https://explorer.solana.com/address/{escrow}?cluster=devnet")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
