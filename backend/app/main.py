from __future__ import annotations

import asyncio
import base64
import logging
import time as _time
from datetime import datetime, timezone
from typing import Optional
from fastapi import FastAPI, Depends, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from .config import get_settings
from .db import make_engine, make_session_factory, init_db
from .privy import PrivyVerifier, PrivyAuthError
from .chain.base import ChainSource
from .chain.mock import MockChainSource
from .services.users import (
    get_or_create_user, read_user_view, set_alias, leaderboard, history, AliasTakenError,
)
from .services.matches import register_match, list_open, sync_match, MatchError
from .elo import gap_label
from .services.gacha import GachaService, GachaDisabled, GachaUpstreamError
from .services.privy_signer import PrivySigner
from .models import GachaPack, PackBattle, BattlePlayer
from .chat import ConnectionManager, ChatBuffer, abbreviate
from .services.pack_lobby import (
    create_battle, join_battle,
    list_open as lobby_list_open,
    get_battle, cancel_battle, verification, LobbyError,
)
from .services.pack_orchestration import (
    run_pack_battle_live, run_royale_live, usdc_balance_base_units, fetch_latest_blockhash,
)
from .services.royale_funding import royale_buyin, collect_buyin, distribute_usdc
from .services.reservations import reserve, reserved_total, release_reservations
from .services.bots import load_bots, pick_bot

logger = logging.getLogger(__name__)


class AliasBody(BaseModel):
    alias: str = Field(min_length=3, max_length=20, pattern=r"^[A-Za-z0-9_]+$")


class GeneratePackBody(BaseModel):
    pack_type: str = Field(min_length=1, max_length=32, pattern=r"^[a-z0-9_]+$")


class SubmitTxBody(BaseModel):
    signed_transaction: str = Field(min_length=1, max_length=3000)

    @model_validator(mode="after")
    def check_base64(self) -> "SubmitTxBody":
        try:
            base64.b64decode(self.signed_transaction, validate=True)
        except Exception:
            raise ValueError("signed_transaction debe ser base64 válido")
        return self


class OpenPackBody(BaseModel):
    memo: str = Field(min_length=1, max_length=128)


class YoloBody(BaseModel):
    pack_type: str = Field(min_length=1, max_length=32, pattern=r"^[a-z0-9_]+$")
    count: int = Field(ge=1, le=10)
    turbo: bool = False


class BuybackBody(BaseModel):
    nft_address: str


class CreateMatchBody(BaseModel):
    battle_pubkey: str = Field(min_length=32, max_length=44)
    min_elo: Optional[int] = Field(default=None, ge=0, le=9999)
    max_elo: Optional[int] = Field(default=None, ge=0, le=9999)

    @model_validator(mode="after")
    def check_elo_range(self) -> "CreateMatchBody":
        if self.min_elo is not None and self.max_elo is not None:
            if self.min_elo > self.max_elo:
                raise ValueError("min_elo no puede ser mayor que max_elo")
        return self


class PackSel(BaseModel):
    machine_code: str
    count: int

class CreateBattleBody(BaseModel):
    machine_code: Optional[str] = None     # legacy single-pack / royale
    max_players: int
    mode: str = "pack"
    packs: Optional[list[PackSel]] = None  # multi-pack bundle (pack mode only)


def create_app(session_factory, chain: ChainSource,
               elo_start: int = 1200, elo_k: int = 32,
               cors_origins: list[str] | None = None,
               gacha: GachaService | None = None,
               gacha_rate_limit: int = 10,
               privy: PrivyVerifier | None = None,
               privy_signer: PrivySigner | None = None,
               solana_rpc_url: str = "",
               cc_usdc_mint: str = "",
               privy_operator_wallet_id: str = "",
               privy_operator_address: str = "",
               escrow_seed_lamports: int = 10_000_000) -> FastAPI:
    app = FastAPI(title="Battle Arena — Backend")

    if cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    def db() -> Session:
        s = session_factory()
        try:
            yield s
        finally:
            s.close()

    def current_user(authorization: Optional[str] = Header(None)) -> str:
        if privy is None:
            raise HTTPException(503, "privy no configurado")
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(401, "falta token")
        try:
            return privy.embedded_solana_wallet(authorization[len("Bearer "):])
        except PrivyAuthError:
            raise HTTPException(401, "identity token inválido")

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.post("/users/me/alias")
    async def me_alias(body: AliasBody, wallet: str = Depends(current_user), s: Session = Depends(db)):
        get_or_create_user(s, wallet, elo_start)
        try:
            set_alias(s, wallet, body.alias)
            s.commit()
        except AliasTakenError:
            raise HTTPException(409, "username_taken")
        except IntegrityError:
            s.rollback()
            raise HTTPException(409, "username_taken")
        return {"wallet": wallet, "alias": body.alias}

    @app.get("/users/me/balance")
    async def me_balance(wallet: str = Depends(current_user), s: Session = Depends(db)):
        return {"reserved": reserved_total(s, wallet)}

    @app.get("/users/{wallet}")
    async def get_user(wallet: str, s: Session = Depends(db)):
        return read_user_view(s, wallet, elo_start)

    @app.get("/users/{wallet}/history")
    async def get_history(wallet: str, s: Session = Depends(db)):
        return [{"battle_pubkey": h.battle_pubkey, "elo_before": h.elo_before,
                 "elo_after": h.elo_after, "result": h.result} for h in history(s, wallet)]

    @app.post("/matches")
    async def post_match(body: CreateMatchBody, wallet: str = Depends(current_user), s: Session = Depends(db)):
        try:
            m = await register_match(s, chain, creator=wallet, battle_pubkey=body.battle_pubkey,
                                     min_elo=body.min_elo, max_elo=body.max_elo, elo_start=elo_start)
        except MatchError as e:
            raise HTTPException(409, str(e))
        s.commit()
        return {"battle_pubkey": m.battle_pubkey, "status": m.status, "stake": m.stake,
                "min_elo": m.min_elo, "max_elo": m.max_elo}

    @app.get("/matches/open")
    async def get_open(viewer: Optional[str] = None, s: Session = Depends(db)):
        rows = list_open(s, viewer=viewer)
        return rows

    @app.post("/matches/{battle_pubkey}/sync")
    async def post_sync(battle_pubkey: str, wallet: str = Depends(current_user), s: Session = Depends(db)):
        try:
            m = await sync_match(s, chain, battle_pubkey, elo_start=elo_start, k=elo_k)
        except MatchError as e:
            raise HTTPException(404, str(e))
        s.commit()
        return {"battle_pubkey": m.battle_pubkey, "status": m.status, "winner": m.winner,
                "is_draw": m.is_draw, "elo_applied": m.elo_applied}

    @app.get("/elo/compare")
    async def elo_compare(a: str, b: str, s: Session = Depends(db)):
        va = read_user_view(s, a, elo_start)["elo"]
        vb = read_user_view(s, b, elo_start)["elo"]
        diff = va - vb
        return {"elo_a": va, "elo_b": vb, "diff": diff, "gap_label": gap_label(diff)}

    @app.get("/leaderboard")
    async def get_leaderboard(limit: int = Query(default=50, ge=1, le=200), s: Session = Depends(db)):
        return [{"wallet": u.wallet, "alias": u.alias, "elo": u.elo} for u in leaderboard(s, limit)]

    # ── Gacha (proxy a Collector Crypt; la x-api-key vive solo aquí) ─────────
    _gacha_hits: dict[str, list[float]] = {}

    def _gacha_throttle(wallet: str) -> None:
        now = _time.time()
        hits = [t for t in _gacha_hits.get(wallet, []) if now - t < 60.0]
        if len(hits) >= gacha_rate_limit:
            raise HTTPException(429, "demasiadas peticiones al gacha")
        hits.append(now)
        _gacha_hits[wallet] = hits

    def _gacha_or_503() -> GachaService:
        if gacha is None or not gacha.enabled:
            raise HTTPException(503, "gacha_disabled")
        return gacha

    @app.get("/gacha/machines")
    async def gacha_machines():
        svc = _gacha_or_503()
        try:
            return await svc.machines()
        except GachaDisabled:
            raise HTTPException(503, "gacha_disabled")
        except GachaUpstreamError as e:
            raise HTTPException(502, str(e) or "gacha upstream no disponible")

    @app.get("/gacha/machines/{code}/cards")
    async def gacha_machine_cards(code: str,
                                  rarity: Optional[str] = None,
                                  page: int = Query(default=1, ge=1, le=1000),
                                  limit: int = Query(default=24, ge=1, le=100)):
        svc = _gacha_or_503()
        try:
            return await svc.get_nfts(code=code, rarity=rarity, page=page, limit=limit)
        except GachaDisabled:
            raise HTTPException(503, "gacha_disabled")
        except GachaUpstreamError as e:
            raise HTTPException(502, str(e) or "gacha upstream no disponible")

    @app.post("/gacha/generate-pack")
    async def gacha_generate(body: GeneratePackBody,
                             wallet: str = Depends(current_user),
                             s: Session = Depends(db)):
        svc = _gacha_or_503()
        _gacha_throttle(wallet)
        price = await _machine_price(body.pack_type)
        await _require_available(wallet, price, s)
        try:
            out = await svc.generate_pack(player_address=wallet, pack_type=body.pack_type)
        except GachaDisabled:
            raise HTTPException(503, "gacha_disabled")
        except GachaUpstreamError as e:
            raise HTTPException(502, str(e) or "gacha upstream no disponible")
        if not out.get("memo"):
            raise HTTPException(502, "gacha upstream no disponible")
        existing = s.get(GachaPack, out["memo"])
        if existing is not None:
            if existing.wallet != wallet:
                raise HTTPException(502, "gacha upstream no disponible")
            # mismo wallet: el pack ya existe, devolver sin re-insertar
        else:
            s.add(GachaPack(memo=out["memo"], wallet=wallet, pack_type=body.pack_type))
            s.commit()
        return out

    @app.post("/gacha/submit-tx")
    async def gacha_submit(body: SubmitTxBody, wallet: str = Depends(current_user)):
        svc = _gacha_or_503()
        _gacha_throttle(wallet)
        try:
            return await svc.submit_tx(signed_transaction=body.signed_transaction)
        except GachaDisabled:
            raise HTTPException(503, "gacha_disabled")
        except GachaUpstreamError as e:
            raise HTTPException(502, str(e) or "gacha upstream no disponible")

    @app.get("/gacha/buyback/available")
    async def gacha_buyback_available(wallet: str, nft: str):
        svc = _gacha_or_503()
        try:
            return await svc.buyback_available(wallet=wallet, nft=nft)
        except GachaDisabled:
            raise HTTPException(503, "gacha_disabled")
        except GachaUpstreamError as e:
            raise HTTPException(502, str(e) or "gacha upstream no disponible")

    @app.post("/gacha/buyback")
    async def gacha_buyback(body: BuybackBody, wallet: str = Depends(current_user)):
        svc = _gacha_or_503()
        _gacha_throttle(wallet)
        try:
            return await svc.buyback(player_address=wallet, nft_address=body.nft_address)
        except GachaDisabled:
            raise HTTPException(503, "gacha_disabled")
        except GachaUpstreamError as e:
            raise HTTPException(502, str(e) or "gacha upstream no disponible")

    @app.post("/gacha/open-pack")
    async def gacha_open(body: OpenPackBody,
                         wallet: str = Depends(current_user),
                         s: Session = Depends(db)):
        svc = _gacha_or_503()
        _gacha_throttle(wallet)
        pack = s.get(GachaPack, body.memo)
        if pack is None or pack.wallet != wallet:
            raise HTTPException(403, "memo no pertenece a esta wallet")
        try:
            out = await svc.open_pack(memo=body.memo)
        except GachaDisabled:
            raise HTTPException(503, "gacha_disabled")
        except GachaUpstreamError as e:
            raise HTTPException(502, str(e) or "gacha upstream no disponible")
        if not out.get("pending") and out.get("nft_address"):
            pack.opened_at = datetime.now(timezone.utc)
            pack.nft_address = out["nft_address"]
            s.commit()
        return out

    @app.post("/gacha/yolo")
    async def gacha_yolo(body: YoloBody,
                         wallet: str = Depends(current_user),
                         s: Session = Depends(db)):
        svc = _gacha_or_503()
        _gacha_throttle(wallet)
        try:
            out = await svc.generate_yolo_packs(player_address=wallet, pack_type=body.pack_type,
                                                count=body.count, turbo=body.turbo)
        except GachaDisabled:
            raise HTTPException(503, "gacha_disabled")
        except GachaUpstreamError as e:
            raise HTTPException(502, str(e) or "gacha upstream no disponible")
        if not out.get("transactions"):
            raise HTTPException(502, "gacha upstream no disponible")
        for tx in out["transactions"]:
            memo = tx["memo"]
            existing = s.get(GachaPack, memo)
            if existing is not None:
                if existing.wallet != wallet:
                    raise HTTPException(502, "gacha upstream no disponible")
            else:
                s.add(GachaPack(memo=memo, wallet=wallet, pack_type=body.pack_type))
        s.commit()
        return out

    @app.get("/auth/privy/me")
    async def privy_me(authorization: Optional[str] = Header(None)):
        if privy is None:
            raise HTTPException(503, "privy no configurado")
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(401, "falta token")
        try:
            claims = privy.verify(authorization[len("Bearer "):])
        except PrivyAuthError:
            raise HTTPException(401, "token Privy inválido")
        return {"sub": claims.get("sub")}

    # ── Pack Battle lobby endpoints ───────────────────────────────────────────

    def current_user_id(authorization: Optional[str] = Header(None)) -> str:
        if privy is None:
            raise HTTPException(503, "privy no configurado")
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(401, "falta token")
        try:
            return privy.embedded_solana_wallet_id(authorization[len("Bearer "):])
        except PrivyAuthError:
            raise HTTPException(401, "identity token inválido")

    async def _require_available(wallet: str, amount: int, s: Session):
        bal = await usdc_balance_base_units(solana_rpc_url, wallet, cc_usdc_mint)
        avail = bal - reserved_total(s, wallet)
        if avail < amount:
            raise HTTPException(402, "USDC disponible insuficiente")

    async def _machine_price(machine_code: str) -> int:
        machines = await gacha.machines()
        m = next((x for x in machines if x.get("code") == machine_code), None)
        if not m or not m.get("available", True):
            raise HTTPException(409, "máquina no disponible")
        return int(m["price"]) * 1_000_000   # USDC base units

    async def _run_bg(battle_id: str):
        """Background task for pack battles."""
        s2 = session_factory()
        try:
            b = s2.get(PackBattle, battle_id)
            await run_pack_battle_live(s2, b, gacha=gacha, signer=privy_signer,
                rpc_url=solana_rpc_url, usdc_mint=cc_usdc_mint,
                min_usdc_base_units=b.price, operator_wallet_id=privy_operator_wallet_id,
                operator_address=privy_operator_address, seed_lamports=escrow_seed_lamports)
        except Exception:
            logger.warning("background run failed for %s", battle_id)
        finally:
            release_reservations(s2, battle_id)
            s2.close()

    async def _run_royale_bg(battle_id: str):
        """Background task for royale battles.

        Diverges from _run_bg: calls run_royale_live with price_base=battle.price.
        The escrow wallet was already created at lobby-creation time (escrow-at-create),
        so run_royale_live does not create a new escrow — it uses the pre-created one.
        """
        s2 = session_factory()
        try:
            b = s2.get(PackBattle, battle_id)
            await run_royale_live(s2, b, gacha=gacha, signer=privy_signer,
                rpc_url=solana_rpc_url, usdc_mint=cc_usdc_mint,
                operator_wallet_id=privy_operator_wallet_id,
                operator_address=privy_operator_address,
                seed_lamports=escrow_seed_lamports,
                price_base=b.price)
        except Exception:
            logger.warning("background royale run failed for %s", battle_id)
        finally:
            release_reservations(s2, battle_id)
            s2.close()

    @app.post("/pack-battles")
    async def create_pack_battle(body: CreateBattleBody, wallet: str = Depends(current_user),
                                 wallet_id: str = Depends(current_user_id), s: Session = Depends(db)):
        price = await _machine_price(body.machine_code) if body.machine_code else 0
        mode = body.mode

        if mode == "royale":
            # For royale, the funds check is against the buy-in, not just the pack price.
            buyin = royale_buyin(body.max_players, price)
            await _require_available(wallet, buyin, s)
            try:
                b = create_battle(s, wallet, wallet_id, machine_code=body.machine_code, price=price,
                                  max_players=body.max_players, mode="royale")
            except LobbyError as e:
                raise HTTPException(409, str(e))
            # Pre-create the escrow wallet at lobby-creation time so buy-ins can be
            # collected immediately when players join (before the battle starts).
            # Pack battles create the escrow lazily inside run_battle; royale diverges here.
            esc = await privy_signer.create_solana_wallet()
            b.escrow_wallet_id = esc["id"]
            b.escrow_address = esc["address"]
            s.commit()
            # Collect the creator's buy-in immediately (creator is the first player)
            blockhash = await fetch_latest_blockhash(solana_rpc_url)
            await collect_buyin(
                solana_rpc_url, privy_signer,
                wallet_id, wallet,
                privy_operator_wallet_id, privy_operator_address,
                b.escrow_address, cc_usdc_mint, buyin, blockhash,
            )
            resp = get_battle(s, b.id)
            resp["buyin"] = buyin
            resp["escrow_address"] = b.escrow_address
            return resp

        # Default: pack mode — build the bundle (1..10 boxes), reserve the total
        if body.packs:
            for sel in body.packs:
                if sel.count < 1:
                    raise HTTPException(422, "cada count debe ser >= 1")
            bundle: list[tuple[str, int]] = []
            for sel in body.packs:
                ppx = await _machine_price(sel.machine_code)   # 409 if unavailable
                bundle += [(sel.machine_code, ppx)] * sel.count
        else:
            if not body.machine_code:
                raise HTTPException(422, "machine_code o packs requerido")
            bundle = [(body.machine_code, await _machine_price(body.machine_code))]
        if not (1 <= len(bundle) <= 10):
            raise HTTPException(422, "el bundle debe tener entre 1 y 10 cajas")
        total = sum(pr for _, pr in bundle)
        await _require_available(wallet, total, s)
        try:
            b = create_battle(s, wallet, wallet_id, machine_code=bundle[0][0], price=total,
                              max_players=body.max_players, mode=mode, packs=bundle)
        except LobbyError as e:
            raise HTTPException(409, str(e))
        reserve(s, wallet, b.id, total)
        return get_battle(s, b.id)

    @app.post("/pack-battles/{battle_id}/join")
    async def join_pack_battle(battle_id: str, wallet: str = Depends(current_user),
                               wallet_id: str = Depends(current_user_id), s: Session = Depends(db)):
        b = s.get(PackBattle, battle_id)
        if b is None:
            raise HTTPException(404, "no existe")

        if b.mode == "royale":
            # For royale, check that the player can cover the buy-in.
            buyin = royale_buyin(b.max_players, b.price)
            await _require_available(wallet, buyin, s)
            try:
                b, filled = join_battle(s, battle_id, wallet, wallet_id)
            except LobbyError as e:
                raise HTTPException(409, str(e))
            # Collect the buy-in from the joining player into the pre-created escrow.
            blockhash = await fetch_latest_blockhash(solana_rpc_url)
            await collect_buyin(
                solana_rpc_url, privy_signer,
                wallet_id, wallet,
                privy_operator_wallet_id, privy_operator_address,
                b.escrow_address, cc_usdc_mint, buyin, blockhash,
            )
            if filled:
                asyncio.create_task(_run_royale_bg(battle_id))
            return get_battle(s, battle_id)

        # Default: pack mode
        await _require_available(wallet, b.price, s)
        try:
            b, filled = join_battle(s, battle_id, wallet, wallet_id)
        except LobbyError as e:
            raise HTTPException(409, str(e))
        reserve(s, wallet, battle_id, b.price)
        if filled:
            asyncio.create_task(_run_bg(battle_id))
        return get_battle(s, battle_id)

    @app.post("/pack-battles/{battle_id}/join-bot")
    async def join_bot_pack_battle(battle_id: str, s: Session = Depends(db)):
        """DEV/TEST: drop a random funded reserve bot into a lobby slot (no auth)."""
        b = s.get(PackBattle, battle_id)
        if b is None:
            raise HTTPException(404, "no existe")
        if b.status != "lobby":
            raise HTTPException(409, "la batalla no está en lobby")
        bots = load_bots()
        if not bots:
            raise HTTPException(409, "no hay bots configurados")
        in_battle = {p.player_wallet for p in s.query(BattlePlayer).filter_by(battle_id=battle_id).all()}
        buyin = royale_buyin(b.max_players, b.price) if b.mode == "royale" else b.price
        candidates = [bot for bot in bots if bot["address"] not in in_battle]
        balances = {bot["address"]: await usdc_balance_base_units(solana_rpc_url, bot["address"], cc_usdc_mint)
                    for bot in candidates}
        bot = pick_bot(bots, in_battle, balances, buyin)
        if bot is None:
            raise HTTPException(409, "no hay bots libres con saldo suficiente")
        bw, bid = bot["address"], bot["id"]
        if b.mode == "royale":
            # Fund the escrow with the bot's buy-in and CONFIRM it landed BEFORE joining, so a
            # joined royale bot is always backed (handles confirmation lag, silent on-chain
            # failures and concurrent joins). Otherwise the escrow is short and the run voids.
            before = await usdc_balance_base_units(solana_rpc_url, b.escrow_address, cc_usdc_mint)
            funded, last_err = False, None
            for _ in range(3):
                try:
                    blockhash = await fetch_latest_blockhash(solana_rpc_url)
                    await collect_buyin(solana_rpc_url, privy_signer, bid, bw,
                                        privy_operator_wallet_id, privy_operator_address,
                                        b.escrow_address, cc_usdc_mint, buyin, blockhash)
                except Exception as exc:
                    last_err = exc
                for _ in range(8):  # poll until the escrow actually reflects the buy-in
                    if await usdc_balance_base_units(solana_rpc_url, b.escrow_address, cc_usdc_mint) >= before + buyin:
                        funded = True
                        break
                    await asyncio.sleep(1.5)
                if funded:
                    break
            if not funded:
                raise HTTPException(502, f"no se pudo cobrar/confirmar el buy-in del bot: {last_err}")
            try:
                _b2, filled = join_battle(s, battle_id, bw, bid)
            except LobbyError as e:
                # Joined too late — refund the buy-in we just collected so it isn't stuck.
                try:
                    bh2 = await fetch_latest_blockhash(solana_rpc_url)
                    await distribute_usdc(solana_rpc_url, privy_signer, b.escrow_wallet_id,
                                          b.escrow_address, bw, cc_usdc_mint, buyin, bh2)
                except Exception:
                    logger.warning("join-bot refund failed for %s in %s", bw, battle_id)
                raise HTTPException(409, str(e))
            if filled:
                asyncio.create_task(_run_royale_bg(battle_id))
        else:
            try:
                _b2, filled = join_battle(s, battle_id, bw, bid)
            except LobbyError as e:
                raise HTTPException(409, str(e))
            reserve(s, bw, battle_id, b.price)
            if filled:
                asyncio.create_task(_run_bg(battle_id))
        return get_battle(s, battle_id)

    @app.post("/pack-battles/{battle_id}/cancel")
    async def cancel_pack_battle(battle_id: str, wallet: str = Depends(current_user),
                                 s: Session = Depends(db)):
        b = s.get(PackBattle, battle_id)
        if b is None:
            raise HTTPException(404, "no existe")
        is_royale = b.mode == "royale"
        players = [p.player_wallet for p in s.query(BattlePlayer).filter_by(battle_id=battle_id).all()]
        escrow_wallet_id = b.escrow_wallet_id
        escrow_address = b.escrow_address
        try:
            cancel_battle(s, battle_id, wallet)   # validates creator + lobby, sets cancelled
        except LobbyError as e:
            raise HTTPException(409, str(e))
        if is_royale:
            # Refund each joined player their buy-in from the escrow (best-effort, bounded retries).
            buyin = royale_buyin(b.max_players, b.price)
            for pw in players:
                for _ in range(3):
                    try:
                        bh = await fetch_latest_blockhash(solana_rpc_url)
                        await distribute_usdc(solana_rpc_url, privy_signer, escrow_wallet_id,
                                              escrow_address, pw, cc_usdc_mint, buyin, bh)
                        break
                    except Exception as exc:
                        logger.warning("royale cancel refund retry for %s in %s: %s", pw, battle_id, exc)
                else:
                    logger.error("royale cancel refund FAILED after retries for %s in %s", pw, battle_id)
        else:
            release_reservations(s, battle_id)
        return get_battle(s, battle_id)

    @app.get("/pack-battles/open")
    async def open_pack_battles(s: Session = Depends(db)):
        return lobby_list_open(s)

    @app.get("/pack-battles/{battle_id}")
    async def get_pack_battle(battle_id: str, s: Session = Depends(db)):
        try:
            return get_battle(s, battle_id)
        except LobbyError:
            raise HTTPException(404, "no existe")

    @app.get("/pack-battles/{battle_id}/verify")
    async def verify_pack_battle(battle_id: str, s: Session = Depends(db)):
        b = s.get(PackBattle, battle_id)
        if b is None:
            raise HTTPException(404, "no existe")
        return verification(s, b)

    # ── Chat de lobby por WebSocket ───────────────────────────────────────────
    _chat_mgr = ConnectionManager()
    _chat_buf = ChatBuffer()
    _chat_hits: dict[str, list[float]] = {}
    _CHAT_RATE_LIMIT = 5
    _CHAT_RATE_WINDOW = 10.0

    def _chat_allow(wallet: str) -> bool:
        now = _time.time()
        hits = [t for t in _chat_hits.get(wallet, []) if now - t < _CHAT_RATE_WINDOW]
        if len(hits) >= _CHAT_RATE_LIMIT:
            return False
        hits.append(now)
        _chat_hits[wallet] = hits
        return True

    @app.websocket("/ws/chat")
    async def ws_chat(ws: WebSocket, token: Optional[str] = Query(None)):
        wallet = None
        if token and privy is not None:
            try:
                wallet = privy.embedded_solana_wallet(token)
            except PrivyAuthError:
                wallet = None
        await _chat_mgr.connect(ws)
        try:
            # Nombre a mostrar: alias del usuario si lo tiene, si no el wallet abreviado.
            # NOTA: se resuelve una vez al conectar; cambiar el username requiere reconectar.
            display_name = None
            if wallet:
                with session_factory() as s:
                    alias = read_user_view(s, wallet, elo_start).get("alias")
                display_name = alias or abbreviate(wallet)
            await ws.send_json({"type": "history", "messages": _chat_buf.history()})
            await _chat_mgr.broadcast({"type": "presence", "online": _chat_mgr.online_count()})
            while True:
                data = await ws.receive_json()
                text = (data.get("text") or "").strip()
                if wallet is None:
                    await ws.send_json({"type": "error", "error": "login_required"})
                    continue
                if not text:
                    continue
                text = text[:280]
                if not _chat_allow(wallet):
                    await ws.send_json({"type": "error", "error": "rate_limited"})
                    continue
                msg = {"user": display_name, "text": text, "ts": int(_time.time())}
                _chat_buf.add(msg)
                await _chat_mgr.broadcast({"type": "message", **msg})
        except WebSocketDisconnect:
            _chat_mgr.disconnect(ws)
            await _chat_mgr.broadcast({"type": "presence", "online": _chat_mgr.online_count()})
        except Exception:
            _chat_mgr.disconnect(ws)
            await _chat_mgr.broadcast({"type": "presence", "online": _chat_mgr.online_count()})

    return app


def build_default_app() -> FastAPI:
    s = get_settings()
    engine = make_engine(s.database_url)
    init_db(engine)
    session_factory = make_session_factory(engine)
    chain: ChainSource = MockChainSource()  # 'solana' se cablea cuando el lector real esté validado
    gacha = GachaService(base_url=s.gacha_base_url, api_key=s.gacha_api_key)
    privy = PrivyVerifier(app_id=s.privy_app_id, jwks_url=s.privy_jwks_url.format(app_id=s.privy_app_id)) if s.privy_app_id else None
    privy_signer = PrivySigner(app_id=s.privy_app_id, app_secret=s.privy_app_secret,
                               auth_key_pem=s.privy_auth_key, cluster_caip2=s.privy_solana_caip2,
                               quorum_id=s.privy_quorum_id) if s.privy_app_id else None
    if privy_signer and not (s.privy_operator_wallet_id and s.privy_operator_address):
        logger.warning(
            "PRIVY_OPERATOR_WALLET_ID/PRIVY_OPERATOR_ADDRESS unset — Pack Battle/Royale will "
            "void at settle (escrow gas can't be funded). Set them in backend/.env."
        )
    return create_app(session_factory, chain, elo_start=s.elo_start, elo_k=s.elo_k,
                      cors_origins=s.cors_origins, gacha=gacha, privy=privy,
                      privy_signer=privy_signer,
                      solana_rpc_url=s.solana_rpc_url, cc_usdc_mint=s.cc_usdc_mint,
                      privy_operator_wallet_id=s.privy_operator_wallet_id,
                      privy_operator_address=s.privy_operator_address,
                      escrow_seed_lamports=s.escrow_seed_lamports)


app = build_default_app()
