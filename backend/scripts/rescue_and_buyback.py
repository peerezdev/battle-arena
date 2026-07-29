"""Rescata las cartas Core atrapadas en el escrow de una batalla y hace buyback de las cartas
de los bots.

Puntual y manual: no forma parte de ningún flujo. Nace de que nft_in_owner no entendía los
Metaplex Core, así que el settle daba por no entregables cartas que SÍ estaban en el escrow
(ver fix f542ba0). Este script las lleva a su ganador y, después, vende las cartas que quedan
en las wallets de los bots de prueba.

    python scripts/rescue_and_buyback.py            # dry-run: solo enumera
    python scripts/rescue_and_buyback.py --go       # ejecuta de verdad
"""
import asyncio
import sys

from app.config import get_settings
from app.db import make_engine, make_session_factory
from app.models import PackBattle, BattlePull
from app.services.bots import load_bots
from app.services.gacha import GachaService
from app.services.nft_transfer import build_transfer, nft_in_owner, submit_signed_tx
from app.services.pack_orchestration import fetch_latest_blockhash
from app.services.privy_signer import PrivySigner

BATTLE_ID = "6d2e0383f22e4c6d8fbd5e9b84f808b3"
GO = "--go" in sys.argv


def _log(msg: str) -> None:
    print(msg, flush=True)


async def rescue(s, signer, st) -> None:
    b = s.get(PackBattle, BATTLE_ID)
    if b is None:
        _log("  batalla no encontrada"); return
    pulls = [p for p in s.query(BattlePull).filter_by(battle_id=BATTLE_ID).all()
             if p.nft_address and not p.auto_sold and not p.transferred]
    _log(f"\n== RESCATE · batalla {BATTLE_ID[:12]} ==")
    _log(f"  escrow  {b.escrow_address}")
    _log(f"  ganador {b.winner}")
    for p in pulls:
        held = await nft_in_owner(st.solana_rpc_url, b.escrow_address, p.nft_address)
        if not held:
            _log(f"  · {p.nft_address[:12]} ${p.insured_value} — YA NO está en el escrow, se omite")
            continue
        if not GO:
            _log(f"  · {p.nft_address[:12]} ${p.insured_value} — se transferiría al ganador")
            continue
        try:
            bh = await fetch_latest_blockhash(st.solana_rpc_url)
            tx = await build_transfer(st.solana_rpc_url, b.escrow_address, b.winner, p.nft_address,
                                      bh, fee_payer=st.privy_operator_address or None)
            signed = await signer.sign_solana(b.escrow_wallet_id, tx)       # el escrow autoriza
            if st.privy_operator_wallet_id and st.privy_operator_address:
                signed = await signer.sign_solana(st.privy_operator_wallet_id, signed)  # operador paga gas
            sig = await submit_signed_tx(st.solana_rpc_url, signed)
            p.transferred = True
            s.commit()
            _log(f"  · {p.nft_address[:12]} ${p.insured_value} — TRANSFERIDA  sig={sig[:16]}…")
        except Exception as e:
            _log(f"  · {p.nft_address[:12]} ${p.insured_value} — FALLÓ: {e}")


async def buyback_bots(signer, st, gacha: GachaService) -> None:
    """Vende de vuelta a CC todas las cartas que tengan las wallets de los bots."""
    import httpx
    bots = load_bots()
    _log(f"\n== BUYBACK DE BOTS · {len(bots)} wallets ==")
    total = 0.0
    for bot in bots:
        # Las cartas de la wallet se leen por DAS; si el RPC no lo soporta, se salta el bot.
        try:
            async with httpx.AsyncClient(timeout=30) as c:
                r = await c.post(st.solana_rpc_url, json={
                    "jsonrpc": "2.0", "id": 1, "method": "getAssetsByOwner",
                    "params": {"ownerAddress": bot["address"], "page": 1, "limit": 200}})
                items = (r.json().get("result") or {}).get("items") or []
        except Exception as e:
            _log(f"  {bot['address'][:10]} — no se pudo listar: {e}"); continue

        mints = [it["id"] for it in items
                 if any(g.get("group_key") == "collection" and str(g.get("group_value", "")).startswith("CCrypt")
                        for g in (it.get("grouping") or []))]
        if not mints:
            _log(f"  {bot['address'][:10]} — sin cartas"); continue
        _log(f"  {bot['address'][:10]} — {len(mints)} carta(s)")
        for mint in mints:
            try:
                avail = await gacha.buyback_available(wallet=bot["address"], nft=mint)
                if not avail.get("available"):
                    _log(f"      {mint[:12]} — CC no la recompra, se omite"); continue
                amount = (avail.get("amount") or 0) / 1e6
                if not GO:
                    _log(f"      {mint[:12]} — se vendería por ~${amount:.2f}"); total += amount; continue
                out = await gacha.buyback(player_address=bot["address"], nft_address=mint)
                tx = out.get("serialized_transaction")
                if not tx:
                    _log(f"      {mint[:12]} — CC no devolvió transacción"); continue
                signed = await signer.sign_solana(bot["id"], tx)
                sub = await gacha.submit_tx(signed_transaction=signed)
                total += amount
                _log(f"      {mint[:12]} — VENDIDA ${amount:.2f}  sig={str(sub.get('signature'))[:16]}…")
            except Exception as e:
                _log(f"      {mint[:12]} — FALLÓ: {e}")
    _log(f"\n  total {'estimado' if not GO else 'recuperado'}: ${total:.2f}")


async def main() -> None:
    st = get_settings()
    s = make_session_factory(make_engine(st.database_url))()
    signer = PrivySigner(app_id=st.privy_app_id, app_secret=st.privy_app_secret,
                         auth_key_pem=st.privy_auth_key, cluster_caip2=st.privy_solana_caip2)
    gacha = GachaService(base_url=st.gacha_base_url, api_key=st.gacha_api_key)
    _log("MODO: " + ("EJECUCIÓN REAL" if GO else "dry-run (nada se mueve)"))
    await rescue(s, signer, st)
    await buyback_bots(signer, st, gacha)


if __name__ == "__main__":
    asyncio.run(main())
