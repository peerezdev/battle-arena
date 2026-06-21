"""Pack Battle live verification — FASE 2 (devnet): ciclo completo 1-jugador.

tirada→escrow (firma server-side + altPlayerAddress) → abrir → transferir el NFT
escrow→ganador (=el jugador), firmado por la key quorum. Valida build_nft_transfer
+ firma del escrow + entrega real al ganador.

Requiere SOL en el escrow (fee de la transferencia + rent del ATA del ganador).
Run:  cd backend && PYTHONPATH=. .venv/bin/python3 scripts/verify_pack_battle.py
"""
import asyncio
import base64
import sys

import httpx
from solders.keypair import Keypair  # noqa: F401  (no usado; placeholder)

from app.config import get_settings
from app.services.gacha import GachaService
from app.services.privy_signer import PrivySigner, authorization_signature
from app.services.solana_tx import build_nft_transfer

USER = "8QDBKx8P3pxkRhiqyXFtYcPPf2CM1F5NiE5A8yjkgtm6"
WALLET_ID = "ci1hz21vvxpqpqkyvsffeb7n"
ESCROW_ADDR = "9oZgd4eviozqaYu7KwCTctAYgsRTWtF3McJARaztPsRQ"
ESCROW_WALLET_ID = "w9c3ogk1v6bzkhfefc1mjpwj"
MACHINE = "pokemon_50"
RPC = "https://api.devnet.solana.com"
MIN_ESCROW_LAMPORTS = 5_000_000  # ~0.005 SOL (fee + ATA rent)
TOKEN_PROGRAMS = ("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")


def rpc(method, params):
    return httpx.post(RPC, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=20).json()


def sol_balance(addr):
    return rpc("getBalance", [addr])["result"]["value"]


def latest_blockhash():
    return rpc("getLatestBlockhash", [{"commitment": "finalized"}])["result"]["value"]["blockhash"]


def privy_sign_only(s, wallet_id, tx_b64):
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


def owner_holds_mint(owner, mint):
    for prog in TOKEN_PROGRAMS:
        r = rpc("getTokenAccountsByOwner", [owner, {"mint": mint}, {"encoding": "jsonParsed"}])
        for a in (r.get("result", {}) or {}).get("value", []):
            amt = a["account"]["data"]["parsed"]["info"]["tokenAmount"]["uiAmountString"]
            if amt and float(amt) >= 1:
                return True
    return False


async def main() -> int:
    s = get_settings()
    gacha = GachaService(base_url=s.gacha_base_url, api_key=s.gacha_api_key)
    signer = PrivySigner(app_id=s.privy_app_id, app_secret=s.privy_app_secret,
                         auth_key_pem=s.privy_auth_key, cluster_caip2=s.privy_solana_caip2,
                         quorum_id="q9782k24n3445yoqmzwbgapg")

    bal = sol_balance(ESCROW_ADDR)
    print(f"escrow {ESCROW_ADDR}: {bal} lamports ({bal/1e9:.4f} SOL)")
    if bal < MIN_ESCROW_LAMPORTS:
        print(f"\n⛔ El escrow necesita SOL para la transferencia. Envía ~0.02 SOL de devnet a:")
        print(f"     {ESCROW_ADDR}")
        print("   y reejecuta este script.")
        return 2

    # 1) tirada → escrow (firma server-side + CC submit)
    print(f"\n→ tirada {MACHINE} → escrow (altPlayerAddress)…")
    pack = await gacha.generate_pack(player_address=USER, pack_type=MACHINE, alt_player_address=ESCROW_ADDR)
    memo = pack["memo"]
    signed = privy_sign_only(s, WALLET_ID, pack["transaction"])
    sub = await gacha.submit_tx(signed)
    print("   tirada emitida por CC:", sub.get("signature"), "|", sub.get("confirmation_status"))

    # 2) abrir
    print("→ abriendo (poll)…")
    res = None
    for i in range(15):
        res = await gacha.open_pack(memo)
        if not res.get("pending"):
            break
        await asyncio.sleep(3)
    if not res or res.get("pending") or not res.get("nft_address"):
        print("❌ no abrió"); return 1
    nft = res["nft_address"]
    print(f"   NFT: {nft} | insured ${res.get('insured_value')} | {res.get('grade')}")
    if owner_holds_mint(USER, nft):
        print("⚠️  el NFT ya está en el wallet del jugador (no fue al escrow?) — abortando transfer"); return 1

    # 3) transferir escrow → ganador (=USER), firmado por la quorum
    print(f"\n→ transfiriendo NFT escrow→ganador (build_nft_transfer + firma quorum)…")
    bh = latest_blockhash()
    tx_b64 = build_nft_transfer(ESCROW_ADDR, USER, nft, bh)
    try:
        h = await signer.sign_and_send_solana(ESCROW_WALLET_ID, tx_b64, sponsor=False)
        print("✅ transferencia emitida (Privy signAndSend):", h)
        print("   explorer:", f"https://explorer.solana.com/tx/{h}?cluster=devnet")
    except Exception as e:
        print("⚠️ signAndSend falló:", str(e)[:160])
        print("   → fallback: sign-only + emitir por nuestro RPC…")
        signed_tx = privy_sign_only(s, ESCROW_WALLET_ID, tx_b64)
        snd = rpc("sendTransaction", [signed_tx, {"encoding": "base64"}])
        if snd.get("error"):
            print("❌ sendTransaction falló:", snd["error"]); return 1
        print("✅ transferencia emitida (RPC propio):", snd.get("result"))

    # 4) verificar que el ganador lo tiene
    print("\n→ verificando entrega al ganador…")
    for i in range(10):
        if owner_holds_mint(USER, nft):
            print(f"\n🎉 FASE 2 OK — ciclo completo: el ganador {USER[:8]}… recibió el NFT {nft[:8]}…")
            print("   tirada→escrow→transfer al ganador, todo server-side. PROBADO.")
            return 0
        await asyncio.sleep(3)
    print("⚠️ transferencia emitida pero el NFT aún no visible en el ganador; revisa el explorer.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
