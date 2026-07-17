#!/usr/bin/env python3
"""Prueba de transferibilidad: mover un asset Metaplex CORE de CC entre wallets en MAINNET.

Demuestra que la carta (Core, frozen=false) se transfiere — la mecánica que necesita el
escrow winner-takes-all. Construye una instrucción MPL Core `TransferV1` a mano y la envía
con PREFLIGHT (simulación) para no gastar fee si la instrucción está mal.

A diferencia de la tirada, aquí la fee la paga NUESTRA wallet → necesita un poco de SOL
(~0.002). El destino es un keypair nuevo que también guardamos → la carta sigue siendo tuya.

Uso:
  python cc_core_transfer.py            # transfiere ASSET del owner -> recipient nuevo
  python cc_core_transfer.py --back     # transfiere de vuelta recipient -> owner
"""
from __future__ import annotations
import argparse, base64, json, sys, time
from pathlib import Path

import httpx
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.hash import Hash
from solders.instruction import Instruction, AccountMeta
from solders.message import MessageV0
from solders.transaction import VersionedTransaction

RPC = "https://api.mainnet-beta.solana.com"
MPL_CORE = Pubkey.from_string("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d")
SYSTEM = Pubkey.from_string("11111111111111111111111111111111")
COLLECTION = Pubkey.from_string("CCryptUfeFSZ3Fgc9FLeKrhLVAP67FSqi1GuVoj9CRac")
ASSET = Pubkey.from_string("8iQicWsgBh2Q92RM1CJm3nPhKf8R9qNEkDcsDSziD9bA")

DIR = Path.home() / "cc-mainnet-pull"
OWNER_PATH = DIR / "keypair.json"
RECIP_PATH = DIR / "recipient.json"


def load_kp(p: Path) -> Keypair:
    return Keypair.from_bytes(bytes(json.loads(p.read_text())))


def load_or_make(p: Path) -> Keypair:
    if p.exists():
        return load_kp(p)
    kp = Keypair()
    p.write_text(json.dumps(list(bytes(kp))))
    import os; os.chmod(p, 0o600)
    return kp


def rpc(method, params):
    r = httpx.post(RPC, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=30)
    r.raise_for_status()
    d = r.json()
    if "error" in d:
        raise RuntimeError(f"{method}: {d['error']}")
    return d["result"]


def sol_balance(pk: Pubkey) -> int:
    return rpc("getBalance", [str(pk)])["value"]


def asset_owner(commitment: str = "confirmed") -> Pubkey:
    v = rpc("getAccountInfo", [str(ASSET), {"encoding": "base64", "commitment": commitment}])["value"]
    raw = base64.b64decode(v["data"][0])
    return Pubkey(raw[1:33])  # AssetV1: key(1) + owner(32)


def transfer_v1_ix(payer: Pubkey, authority: Pubkey, new_owner: Pubkey) -> Instruction:
    # MPL Core TransferV1: discriminator 14, args compression_proof: Option = None (0x00).
    # Optional accounts usan el program id como sentinela "None". El pagador de la fee y la
    # authority (owner) pueden diferir: si difieren, authority es un signer aparte (no writable).
    same = payer == authority
    metas = [
        AccountMeta(ASSET, False, True),                       # asset (writable)
        AccountMeta(COLLECTION, False, False),                 # collection (obligatoria: el asset pertenece a ella)
        AccountMeta(payer, True, True),                        # payer (signer, writable)
        AccountMeta(MPL_CORE if same else authority, not same, False),  # authority: None->default payer, o signer aparte
        AccountMeta(new_owner, False, False),                  # newOwner
        AccountMeta(SYSTEM, False, False),                     # systemProgram
        AccountMeta(MPL_CORE, False, False),                   # logWrapper = None
    ]
    return Instruction(MPL_CORE, bytes([14, 0]), metas)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--to", help="dirección destino (pubkey). Sin esto: owner<->recipient")
    ap.add_argument("--back", action="store_true", help="devolver la carta: recipient -> owner")
    ap.add_argument("--yes", action="store_true")
    args = ap.parse_args()

    owner = load_kp(OWNER_PATH)
    recip = load_or_make(RECIP_PATH)
    # keypairs que controlamos, por pubkey, para poder firmar como owner actual / pagador.
    ours = {owner.pubkey(): owner, recip.pubkey(): recip}

    # Destino
    if args.to:
        dst = Pubkey.from_string(args.to)
    elif args.back:
        dst = owner.pubkey()
    else:
        dst = recip.pubkey()

    print(f"asset    : {ASSET}")
    cur = asset_owner()
    print(f"owner on-chain actual: {cur}")
    if cur not in ours:
        sys.exit(f"ABORT: no controlamos el owner actual ({cur}); no podemos firmar la transferencia.")
    if cur == dst:
        sys.exit(f"ABORT: el asset ya está en {dst}.")
    authority = ours[cur]  # el owner actual firma como authority

    # Pagador de la fee: cualquiera de los nuestros con SOL suficiente (preferimos el owner del asset).
    payer = None
    for cand in (authority, owner, recip):
        if sol_balance(cand.pubkey()) >= 100_000:  # ~0.0001 SOL, sobra para la fee (~5000 lamports)
            payer = cand; break
    if payer is None:
        sys.exit("ABORT: ninguno de nuestros keypairs tiene SOL para la fee (>=0.0001). Fondea y reintenta.")

    print(f"from (owner) : {authority.pubkey()}")
    print(f"fee payer    : {payer.pubkey()}  ({sol_balance(payer.pubkey())/1e9:.9f} SOL)")
    print(f"to           : {dst}")

    ix = transfer_v1_ix(payer.pubkey(), authority.pubkey(), dst)
    bh = Hash.from_string(rpc("getLatestBlockhash", [{"commitment": "finalized"}])["value"]["blockhash"])
    msg = MessageV0.try_compile(payer.pubkey(), [ix], [], bh)
    # firmantes: pagador primero (fee payer), luego authority si difiere.
    signers = [payer] if payer.pubkey() == authority.pubkey() else [payer, authority]
    tx = VersionedTransaction(msg, signers)
    b64 = base64.b64encode(bytes(tx)).decode()

    # 1) SIMULAR primero (gratis) — si la instrucción está mal, no gastamos fee
    print("\nsimulando…")
    sim = rpc("simulateTransaction", [b64, {"encoding": "base64", "replaceRecentBlockhash": True, "sigVerify": False}])
    err = sim["value"]["err"]
    for l in (sim["value"].get("logs") or []):
        print("  ", l)
    if err:
        sys.exit(f"\nABORT: la simulación falló: {err}")
    print("simulación OK ✅")

    if not args.yes:
        if input("\n¿Enviar la transferencia real? escribe 'GO': ").strip() != "GO":
            sys.exit("Cancelado.")

    sig = rpc("sendTransaction", [b64, {"encoding": "base64", "preflightCommitment": "confirmed"}])
    print(f"\nenviado: {sig}")
    print(f"  https://solscan.io/tx/{sig}")
    print("confirmando…")
    for _ in range(30):
        st = rpc("getSignatureStatuses", [[sig]])["value"][0]
        if st and st.get("confirmationStatus") in ("confirmed", "finalized"):
            print("estado:", st.get("confirmationStatus"), "err:", st.get("err"))
            break
        time.sleep(2)
    new_owner = asset_owner()
    print(f"\nowner on-chain tras el transfer: {new_owner}")
    print("== TRANSFERENCIA CONFIRMADA ✅" if new_owner == dst else "== ¡ojo! el owner no cambió")


if __name__ == "__main__":
    main()
