#!/usr/bin/env python3
"""One-off: hacer UNA tirada REAL de gacha de Collector Crypt en MAINNET, sin API key.

Todo el flujo core de CC en mainnet es keyless y CC paga la fee de SOL (es fee-payer
y prefirma la tx). El jugador solo firma un pago de USDC real por el precio del pack.

Uso:
  1) python cc_mainnet_pull.py init
       Genera un keypair nuevo y lo guarda en ~/cc-mainnet-pull/keypair.json (0600).
       Imprime la DIRECCIÓN a la que tienes que enviar el USDC (mint EPjF…, mainnet).
       NO se gasta nada aquí.

  2) (fondea esa dirección con >= precio del pack en USDC real; recomendado $25 = pokemon_25)

  3) python cc_mainnet_pull.py pull [--machine pokemon_25]
       Comprueba el saldo USDC on-chain, y solo si alcanza:
         generatePack -> firma local -> submitTransaction -> openPack (poll)
       ESTO GASTA DINERO REAL e is irreversible.

Seguridad:
  - La clave privada NUNCA se imprime ni se loguea; solo la pubkey.
  - `pull` aborta si el saldo USDC < precio del pack (no envía nada).
  - turbo=OFF: te quedas la carta (sin auto-buyback).
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
from pathlib import Path

import httpx
from solders.keypair import Keypair
from solders.transaction import VersionedTransaction
from solders.message import to_bytes_versioned

GACHA_BASE = "https://gacha.collectorcrypt.com"
USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"  # USDC mainnet
DEFAULT_RPC = "https://api.mainnet-beta.solana.com"
KEY_PATH = Path.home() / "cc-mainnet-pull" / "keypair.json"


def _load_kp() -> Keypair:
    if not KEY_PATH.exists():
        sys.exit(f"No hay keypair en {KEY_PATH}. Corre primero: python {sys.argv[0]} init")
    arr = json.loads(KEY_PATH.read_text())
    return Keypair.from_bytes(bytes(arr))


def cmd_init() -> None:
    if KEY_PATH.exists():
        kp = _load_kp()
        print(f"Ya existe un keypair. Dirección: {kp.pubkey()}")
        print(f"(borra {KEY_PATH} si quieres uno nuevo)")
        return
    KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
    kp = Keypair()
    # Formato compatible con la CLI de Solana: array de 64 enteros (secret+public).
    KEY_PATH.write_text(json.dumps(list(bytes(kp))))
    os.chmod(KEY_PATH, 0o600)
    print("Keypair generado y guardado (0600) en:")
    print(f"  {KEY_PATH}")
    print()
    print("=== FONDEA ESTA DIRECCIÓN (mainnet) ===")
    print(f"  {kp.pubkey()}")
    print()
    print(f"Envíale USDC real (mint {USDC_MINT}).")
    print("  - pokemon_25 / sns_25 / comic_25  => 25 USDC (lo más barato)")
    print("  - NO necesita SOL: CC paga la fee. El envío de USDC crea el ATA.")
    print()
    print(f"Luego: python {sys.argv[0]} pull --machine pokemon_25")


def usdc_balance(rpc: str, owner: str) -> float:
    """uiAmount de USDC del owner (0.0 si no tiene ATA). Lanza si el RPC falla."""
    body = {
        "jsonrpc": "2.0", "id": 1, "method": "getTokenAccountsByOwner",
        "params": [owner, {"mint": USDC_MINT},
                   {"encoding": "jsonParsed", "commitment": "confirmed"}],
    }
    r = httpx.post(rpc, json=body, timeout=20)
    r.raise_for_status()
    res = r.json().get("result", {}).get("value", [])
    total = 0.0
    for acc in res:
        info = acc["account"]["data"]["parsed"]["info"]
        total += float(info["tokenAmount"]["uiAmount"] or 0)
    return total


def machine_price(machine: str) -> float:
    r = httpx.get(f"{GACHA_BASE}/api/machines", headers={"accept": "application/json"}, timeout=20)
    r.raise_for_status()
    data = r.json()
    ms = data.get("machines", data) if isinstance(data, dict) else data
    for m in ms:
        if m.get("code") == machine:
            return float(m.get("price") or 0)
    sys.exit(f"Máquina desconocida: {machine}")


def cmd_pull(machine: str, rpc: str, yes: bool) -> None:
    kp = _load_kp()
    addr = str(kp.pubkey())
    print(f"Wallet: {addr}")

    price = machine_price(machine)
    print(f"Máquina {machine}: {price} USDC")

    bal = usdc_balance(rpc, addr)
    print(f"Saldo USDC on-chain: {bal}")
    if bal < price:
        sys.exit(f"ABORT: saldo ({bal}) < precio del pack ({price}). Fondea la wallet y reintenta.")

    if not yes:
        ans = input(f"\nEsto GASTARÁ {price} USDC REALES e is irreversible. Escribe 'PULL' para continuar: ")
        if ans.strip() != "PULL":
            sys.exit("Cancelado.")

    with httpx.Client(timeout=30) as c:
        # 1) generatePack (keyless) -> memo + tx sin firmar
        r = c.post(f"{GACHA_BASE}/api/generatePack",
                   json={"playerAddress": addr, "packType": machine},
                   headers={"accept": "application/json"})
        r.raise_for_status()
        gp = r.json()
        memo, raw = gp["memo"], gp["transaction"]
        print(f"\ngeneratePack OK  memo={memo}")

        # 2) firma parcial: CC ya firmó como fee-payer; nosotros firmamos el pago
        tx = VersionedTransaction.from_bytes(base64.b64decode(raw))
        msg = tx.message
        nreq = msg.header.num_required_signatures
        signer_keys = [str(msg.account_keys[i]) for i in range(nreq)]
        if addr not in signer_keys:
            sys.exit(f"ABORT: nuestra wallet no es firmante requerido de la tx: {signer_keys}")
        sigs = list(tx.signatures)
        idx = signer_keys.index(addr)
        sigs[idx] = kp.sign_message(to_bytes_versioned(msg))
        signed = VersionedTransaction.populate(msg, sigs)
        signed_b64 = base64.b64encode(bytes(signed)).decode()
        print("firma local OK")

        # 3) submitTransaction (keyless) -> CC la manda a mainnet
        r = c.post(f"{GACHA_BASE}/api/submitTransaction",
                   json={"signedTransaction": signed_b64},
                   headers={"accept": "application/json"})
        if r.status_code >= 400:
            sys.exit(f"ABORT submit {r.status_code}: {r.text[:300]}")
        sub = r.json()
        sig = sub.get("signature")
        print(f"submit OK  signature={sig}  status={sub.get('confirmationStatus')}")
        if sig:
            print(f"  https://solscan.io/tx/{sig}")

        # 4) openPack(memo) -> revela la carta (puede tardar por webhook; poll)
        print("\nabriendo pack (poll openPack)…")
        nft = None
        for i in range(30):
            r = c.post(f"{GACHA_BASE}/api/openPack", json={"memo": memo},
                       headers={"accept": "application/json"})
            if r.status_code >= 400:
                print(f"  intento {i+1}: openPack {r.status_code} {r.text[:120]}")
                time.sleep(3); continue
            op = r.json()
            if op.get("code") == "WAITING_FOR_WEBHOOK" or not op.get("nft_address"):
                print(f"  intento {i+1}: pendiente…")
                time.sleep(3); continue
            nft = op
            break

    if not nft:
        print("\nopenPack sigue pendiente. La tirada se pagó/envió; reintenta openPack con el memo:")
        print(f"  {memo}")
        return

    md = nft.get("nftWon") or {}
    print("\n=== TIRADA COMPLETA ===")
    print(f"  nft_address : {nft.get('nft_address')}")
    print(f"  rarity      : {nft.get('rarity')}")
    name = md.get("name") if isinstance(md, dict) else None
    print(f"  name        : {name or '(ver metadata)'}")
    print(f"  code(buyback): {nft.get('code')}")
    print(f"  https://solscan.io/token/{nft.get('nft_address')}")
    # dump crudo por si acaso
    out = KEY_PATH.parent / f"pull-{memo}.json"
    out.write_text(json.dumps(nft, indent=2))
    print(f"\n(respuesta completa guardada en {out})")


def main() -> None:
    ap = argparse.ArgumentParser(description="Tirada real de gacha CC en mainnet (sin API key).")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init", help="genera keypair y muestra la dirección a fondear")
    p = sub.add_parser("pull", help="hace la tirada real (gasta USDC)")
    p.add_argument("--machine", default="pokemon_25", help="code de la máquina (def: pokemon_25 = $25)")
    p.add_argument("--rpc", default=DEFAULT_RPC, help="RPC mainnet para el chequeo de saldo")
    p.add_argument("--yes", action="store_true", help="salta la confirmación interactiva")
    args = ap.parse_args()

    if args.cmd == "init":
        cmd_init()
    elif args.cmd == "pull":
        cmd_pull(args.machine, args.rpc, args.yes)


if __name__ == "__main__":
    main()
