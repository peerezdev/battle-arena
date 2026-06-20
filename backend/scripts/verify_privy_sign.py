"""One-off devnet e2e: backend signs+sends a trivial Solana Memo tx for the
user's TEE embedded wallet via Privy (session signer = our key quorum).

Run from backend/:  .venv/bin/python3 scripts/verify_privy_sign.py
Proves the whole delegated-signing chain + pins the privy-authorization-signature.
"""
import asyncio
import base64
import sys

import httpx
from solders.pubkey import Pubkey
from solders.hash import Hash
from solders.instruction import Instruction
from solders.message import Message
from solders.transaction import Transaction

from app.config import get_settings
from app.services.privy_signer import PrivySigner, PrivySignerError

EMBEDDED = "8QDBKx8P3pxkRhiqyXFtYcPPf2CM1F5NiE5A8yjkgtm6"
WALLET_ID = "ci1hz21vvxpqpqkyvsffeb7n"
MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
RPC = "https://api.devnet.solana.com"


def latest_blockhash() -> str:
    r = httpx.post(RPC, json={"jsonrpc": "2.0", "id": 1, "method": "getLatestBlockhash",
                              "params": [{"commitment": "finalized"}]}, timeout=20)
    return r.json()["result"]["value"]["blockhash"]


def build_memo_tx_b64(blockhash: str) -> str:
    payer = Pubkey.from_string(EMBEDDED)
    ix = Instruction(Pubkey.from_string(MEMO_PROGRAM), b"BattleArena e2e", [])
    msg = Message.new_with_blockhash([ix], payer, Hash.from_string(blockhash))
    tx = Transaction.new_unsigned(msg)
    return base64.b64encode(bytes(tx)).decode()


async def main() -> int:
    s = get_settings()
    signer = PrivySigner(app_id=s.privy_app_id, app_secret=s.privy_app_secret,
                         auth_key_pem=s.privy_auth_key, cluster_caip2=s.privy_solana_caip2)
    print("caip2:", s.privy_solana_caip2, "| signer enabled:", signer.enabled)
    bh = latest_blockhash()
    print("blockhash:", bh)
    tx_b64 = build_memo_tx_b64(bh)
    print("tx bytes:", len(base64.b64decode(tx_b64)))
    try:
        h = await signer.sign_and_send_solana(WALLET_ID, tx_b64)
        print("\n✅ FIRMA+ENVÍO OK — signature/hash:", h)
        print("explorer:", f"https://explorer.solana.com/tx/{h}?cluster=devnet")
        return 0
    except PrivySignerError as e:
        print("\n❌ PrivySignerError:", e)
        return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
