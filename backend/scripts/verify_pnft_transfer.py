"""Transfer pNFT escrow→ganador replicando la plantilla del buyback de CC.

Toma las 17 cuentas del `Transfer` de Metaplex (ix Token Metadata, disc 49) que CC
construye en el buyback, y solo cambia destination/destination_owner/dest-token-record
→ el ganador, y payer → escrow. Firma con el escrow (Privy sign-only) y emite por
nuestro RPC. Mueve la carta de verdad.

Run: cd backend && PYTHONPATH=. .venv/bin/python3 scripts/verify_pnft_transfer.py
"""
import asyncio
import base64
import sys

import httpx
from solders.pubkey import Pubkey
from solders.hash import Hash
from solders.instruction import Instruction, AccountMeta
from solders.message import Message
from solders.transaction import Transaction, VersionedTransaction
from solders.token.associated import get_associated_token_address

from app.config import get_settings
from app.services.gacha import GachaService
from app.services.privy_signer import authorization_signature

USER = "8QDBKx8P3pxkRhiqyXFtYcPPf2CM1F5NiE5A8yjkgtm6"
ESCROW = "9oZgd4eviozqaYu7KwCTctAYgsRTWtF3McJARaztPsRQ"
ESCROW_WALLET_ID = "w9c3ogk1v6bzkhfefc1mjpwj"
NFT = "EFGeHr1UUhADShi7shtW9Ds1VgiRYZRE4wfpoqNKGgyp"
META_PROG = Pubkey.from_string("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")
RPC = "https://api.devnet.solana.com"

# Canonical Metaplex TransferV1 account flags (signer, writable), index 0..16
FLAGS = [
    (False, True),   # 0 token (source ATA)
    (False, False),  # 1 token_owner
    (False, True),   # 2 destination
    (False, False),  # 3 destination_owner
    (False, False),  # 4 mint
    (False, True),   # 5 metadata
    (False, False),  # 6 edition
    (False, True),   # 7 owner token_record
    (False, True),   # 8 destination_token_record
    (True, False),   # 9 authority
    (True, True),    # 10 payer
    (False, False),  # 11 system
    (False, False),  # 12 sysvar instructions
    (False, False),  # 13 spl token
    (False, False),  # 14 ata program
    (False, False),  # 15 auth rules program
    (False, False),  # 16 auth rules (ruleset)
]


def rpc(m, p):
    return httpx.post(RPC, json={"jsonrpc": "2.0", "id": 1, "method": m, "params": p}, timeout=20).json()


def token_record_pda(mint: Pubkey, ata: Pubkey) -> Pubkey:
    return Pubkey.find_program_address(
        [b"metadata", bytes(META_PROG), bytes(mint), b"token_record", bytes(ata)], META_PROG)[0]


def privy_sign_only(s, wallet_id, tx_b64):
    url = f"https://api.privy.io/v1/wallets/{wallet_id}/rpc"
    body = {"method": "signTransaction", "params": {"transaction": tx_b64, "encoding": "base64"}}
    basic = base64.b64encode(f"{s.privy_app_id}:{s.privy_app_secret}".encode()).decode()
    headers = {"Authorization": f"Basic {basic}", "privy-app-id": s.privy_app_id,
               "privy-authorization-signature": authorization_signature("POST", url, body, s.privy_app_id, s.privy_auth_key),
               "Content-Type": "application/json"}
    r = httpx.post(url, json=body, headers=headers, timeout=30); r.raise_for_status()
    d = r.json().get("data", {})
    return d.get("signed_transaction") or d.get("signedTransaction")


def owner_holds(owner, mint):
    r = rpc("getTokenAccountsByOwner", [owner, {"mint": mint}, {"encoding": "jsonParsed"}])
    for a in (r.get("result", {}) or {}).get("value", []):
        amt = a["account"]["data"]["parsed"]["info"]["tokenAmount"]["uiAmountString"]
        if amt and float(amt) >= 1:
            return True
    return False


async def main() -> int:
    s = get_settings()
    g = GachaService(base_url=s.gacha_base_url, api_key=s.gacha_api_key)

    if not owner_holds(ESCROW, NFT):
        print("⛔ el escrow ya no tiene el NFT (¿lo movimos?). Aborto."); return 1

    # 1) plantilla: las 17 cuentas del Transfer (ix Token Metadata) del buyback
    print("→ sacando la plantilla del Transfer desde el buyback de CC…")
    bb = await g.buyback(ESCROW, NFT)
    tx = VersionedTransaction.from_bytes(base64.b64decode(bb["serialized_transaction"]))
    keys = tx.message.account_keys
    tix = next(ix for ix in tx.message.instructions
               if str(keys[ix.program_id_index]) == str(META_PROG))
    template = [keys[i] for i in tix.accounts]   # 17 Pubkeys
    data = bytes(tix.data)
    assert len(template) == 17 and data[0] == 49, f"plantilla inesperada: {len(template)} cuentas data0={data[0]}"
    print(f"   plantilla OK: 17 cuentas, data={list(data)}")

    # 2) derivar el destino = ganador (USER)
    mint = Pubkey.from_string(NFT)
    winner = Pubkey.from_string(USER)
    winner_ata = get_associated_token_address(winner, mint)
    winner_record = token_record_pda(mint, winner_ata)
    escrow_pk = Pubkey.from_string(ESCROW)

    accts = list(template)
    accts[2] = winner_ata       # destination
    accts[3] = winner           # destination_owner
    accts[8] = winner_record    # destination_token_record
    accts[10] = escrow_pk       # payer (en buyback era CC; aquí paga el escrow)
    metas = [AccountMeta(pubkey=accts[i], is_signer=FLAGS[i][0], is_writable=FLAGS[i][1]) for i in range(17)]
    transfer_ix = Instruction(META_PROG, data, metas)

    # compute budget (el pNFT transfer consume bastante)
    cb = Instruction(Pubkey.from_string("ComputeBudget111111111111111111111111111111"),
                     bytes([2]) + (400000).to_bytes(4, "little"), [])

    bh = rpc("getLatestBlockhash", [{"commitment": "finalized"}])["result"]["value"]["blockhash"]
    msg = Message.new_with_blockhash([cb, transfer_ix], escrow_pk, Hash.from_string(bh))
    tx_b64 = base64.b64encode(bytes(Transaction.new_unsigned(msg))).decode()
    print("   tx construida (fee-payer=escrow). Firmando con el escrow (Privy)…")

    signed = privy_sign_only(s, ESCROW_WALLET_ID, tx_b64)
    snd = rpc("sendTransaction", [signed, {"encoding": "base64", "skipPreflight": False}])
    if snd.get("error"):
        err = snd["error"]
        print("❌ sendTransaction falló:", err.get("message"))
        logs = (err.get("data") or {}).get("logs")
        if logs:
            for l in logs: print("     ", l)
        return 1
    sig = snd.get("result")
    print("✅ transfer emitido:", sig)
    print("   explorer:", f"https://explorer.solana.com/tx/{sig}?cluster=devnet")

    print("\n→ verificando que el ganador recibió la carta…")
    for i in range(12):
        if owner_holds(USER, NFT):
            print(f"\n🎉 pNFT TRANSFER OK — el ganador {USER[:8]}… recibió la carta {NFT[:8]}…")
            return 0
        await asyncio.sleep(3)
    print("⚠️ emitido pero aún no visible en el ganador; revisa el explorer.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
