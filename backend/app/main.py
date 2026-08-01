from __future__ import annotations

import asyncio
import base64
import logging
import time as _time
from datetime import datetime, timezone
from typing import Optional
from fastapi import FastAPI, Depends, Header, HTTPException, Path, Query, WebSocket, WebSocketDisconnect
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
    read_unseen_battles, mark_battles_seen,
    get_or_create_user, read_user_view, read_user_stats, read_user_battles, set_alias,
    set_withdraw_address, leaderboard, history, AliasTakenError,
)
from .services.matches import register_match, list_open, sync_match, MatchError
from .services.referrals import apply_referral_code, ReferralError
from .elo import gap_label
from .services.gacha import GachaService, GachaDisabled, GachaUpstreamError
from .services.privy_signer import PrivySigner
from .services import escrow_pool, machine_visibility
from .models import GachaPack, PackBattle, BattlePlayer, BattlePack
from .chat import (ConnectionManager, ChatBuffer, abbreviate, save_chat_message,
                   recent_chat_messages, big_hit_multiple)
from .services.pack_lobby import (
    create_battle, join_battle, join_event,
    list_open as lobby_list_open,
    list_battles as lobby_list_battles,
    get_battle, cancel_battle, verification, LobbyError,
)
from .services.pack_orchestration import (
    run_pack_battle_live, resume_pack_battle_live, run_royale_live, resume_royale_live,
    usdc_balance_base_units, fetch_latest_blockhash,
    reconcile_voided_battle_live,
)
from .services.royale_funding import royale_buyin, collect_buyin, distribute_usdc, refund_buyin, withdraw_usdc, withdraw_usdc_with_fee
from .services.nft_transfer import submit_signed_tx, build_transfer, nft_in_owner, UnsupportedNftStandard
from .services.reservations import reserve, reserved_total, royale_locked_total, release_reservations
from .services import emotes as emote_service
from .services.bots import load_bots, pick_bot

logger = logging.getLogger(__name__)


def _configure_app_logging() -> None:
    """Make app.* logs (INFO+) visible on stderr. Uvicorn configures only its own loggers, so
    without this the engine's warnings (e.g. an undelivered card at settle) never surface — which
    is exactly what hid the cNFT settle failure. Idempotent. Left to propagate so pytest's caplog
    still sees these records (uvicorn adds no root handler, so there is no double line)."""
    applog = logging.getLogger("app")
    if applog.handlers:
        return
    h = logging.StreamHandler()
    h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    applog.addHandler(h)
    applog.setLevel(logging.INFO)

# Live Drops are broadcast to everyone with a delay so a drop never spoils the
# opener's own reveal (the delay applies to the opener too).
LIVE_DROP_DELAY_S = 30


class AliasBody(BaseModel):
    alias: str = Field(min_length=3, max_length=20, pattern=r"^[A-Za-z0-9_]+$")


class ReferralBody(BaseModel):
    code: str = Field(min_length=1, max_length=64)


class WithdrawAddressBody(BaseModel):
    # Base58 Solana address (32–44 chars). Empty string clears it.
    address: str = Field(max_length=64, pattern=r"^$|^[1-9A-HJ-NP-Za-km-z]{32,44}$")


class WithdrawBody(BaseModel):
    address: str = Field(pattern=r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")  # destination Solana wallet
    amount: float = Field(gt=0)  # USDC (dollars)


class NftWithdrawBody(BaseModel):
    # Transfer an NFT out of the player's embedded wallet to an EXTERNAL Solana address.
    nft_address: str = Field(pattern=r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")  # mint to send
    address: str = Field(pattern=r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")      # destination Solana wallet


class EmoteSlotsBody(BaseModel):
    slots: list[str] = Field(max_length=8)  # up to 3 kept; codes not owned are dropped server-side


class EmoteThrowBody(BaseModel):
    code: str = Field(min_length=1, max_length=64)


class SignTxBody(BaseModel):
    transaction: str = Field(min_length=1, max_length=8192)  # base64 (partially-)unsigned tx


class GeneratePackBody(BaseModel):
    pack_type: str = Field(min_length=1, max_length=32, pattern=r"^[a-z0-9_]+$")


class DevAnnounceBody(BaseModel):
    """DEV/TEST: fire a sample chat announcement so the render can be iterated without
    waiting for a real hit/winner/created event. Broadcast-only by default (persist=False)
    so it never pollutes the persisted history."""
    text: str = Field(default="", max_length=200)
    user: str = Field(default="📢 Arena", max_length=64)
    event: Optional[str] = Field(default=None, pattern=r"^(hit|winner|created)$")
    amountUsd: Optional[float] = None
    mode: Optional[str] = Field(default=None, pattern=r"^(pack|royale)$")
    machine: Optional[str] = Field(default=None, max_length=64)   # gacha machine name (hit events)
    mult: Optional[float] = None                                  # hit multiple, e.g. 10.0 → "(x10)"
    action_label: Optional[str] = Field(default=None, max_length=24)
    battle_id: str = Field(default="demo", max_length=64)
    persist: bool = False


class MarkRevealedBody(BaseModel):
    memos: list[str] = Field(max_length=50)


class MarkSeenBody(BaseModel):
    battle_ids: list[str] = Field(max_length=50)


class SubmitTxBody(BaseModel):
    signed_transaction: str = Field(min_length=1, max_length=3000)
    # Memo del sobre que se está pagando, cuando la tx es la compra de un sobre. Opcional porque
    # esta ruta también envía buybacks y transferencias, que no tienen memo asociado.
    memo: Optional[str] = Field(default=None, max_length=128)

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
               escrow_seed_lamports: int = 10_000_000,
               dev_endpoints_enabled: bool = False,
               min_withdraw_usdc: float = 1.0,
               withdraw_rate_limit: int = 5,
               withdraw_rate_window_s: float = 60.0,
               withdraw_fee_pct: float = 0.0,
               fee_wallet_address: str = "",
               hit_announce_mult: float = 3.0,
               winner_announce_mult: float = 4.0,
               royale_creator_allowlist: set[str] | None = None,
               referral_payout_wallet_id: str = "",
               referral_payout_address: str = "",
               referral_claim_min_base_units: int = 5_000_000) -> FastAPI:
    app = FastAPI(title="Battle Arena — Backend")

    # Wallets allowed to CREATE Battle Royale (empty = open to all). Captured by the
    # /pack-battles handler below. See docs/superpowers/specs/2026-07-17-royale-create-allowlist-design.md.
    _royale_allow: set[str] = set(royale_creator_allowlist or ())

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
        # `reserved` = pack-battle soft holds (still in the wallet) → drives available balance.
        # `locked_royale` = royale buy-ins already collected on-chain to escrow → display only,
        # so the "reserved" UI reflects every open battle without double-debiting available.
        return {"reserved": reserved_total(s, wallet), "locked_royale": royale_locked_total(s, wallet)}

    @app.get("/users/me/usdc")
    async def me_usdc(wallet: str = Depends(current_user)):
        # Raw on-chain USDC balance of the caller's embedded wallet, read server-side.
        # The browser cannot query the RPC directly on mainnet: the public endpoint
        # (api.mainnet-beta.solana.com) returns 403 to browser Origins, and pointing the
        # client at the wrong-network mint returns nothing. The backend has no Origin header
        # and already holds the per-network rpc_url + usdc mint, so it reads the balance
        # reliably for both devnet and mainnet. `reserved` (soft holds) is exposed separately
        # by /users/me/balance and subtracted client-side, matching the previous behavior.
        base_units = await usdc_balance_base_units(solana_rpc_url, wallet, cc_usdc_mint)
        return {"base_units": base_units, "usdc": base_units / 1e6}

    @app.get("/users/{wallet}")
    async def get_user(wallet: str, s: Session = Depends(db)):
        return read_user_view(s, wallet, elo_start)

    @app.get("/users/{wallet}/stats")
    async def get_user_stats(wallet: str, s: Session = Depends(db)):
        return read_user_stats(s, wallet)

    @app.get("/users/{wallet}/battles")
    async def get_user_battles(wallet: str, s: Session = Depends(db)):
        return read_user_battles(s, wallet)

    @app.get("/users/me/battles/unseen")
    async def me_unseen_battles(wallet: str = Depends(current_user), s: Session = Depends(db)):
        """Batallas terminadas o anuladas en las que el jugador participó y aún no ha visto.
        Sin throttle: se consulta al entrar, no en bucle."""
        return read_unseen_battles(s, wallet)

    @app.post("/users/me/battles/seen")
    async def me_mark_battles_seen(body: MarkSeenBody, wallet: str = Depends(current_user),
                                   s: Session = Depends(db)):
        """Marca batallas como ya vistas por el jugador. Idempotente y acotado a su wallet."""
        return {"marked": mark_battles_seen(s, wallet, body.battle_ids)}

    @app.post("/users/me/withdraw-address")
    async def me_withdraw_address(body: WithdrawAddressBody, wallet: str = Depends(current_user), s: Session = Depends(db)):
        get_or_create_user(s, wallet, elo_start)
        set_withdraw_address(s, wallet, body.address or None)
        s.commit()
        return {"wallet": wallet, "withdraw_address": body.address or None}

    # ── Emotes ──────────────────────────────────────────────────────────────
    @app.get("/emotes/catalog")
    async def emotes_catalog():
        return emote_service.catalog()

    @app.get("/users/me/emotes")
    async def me_emotes(wallet: str = Depends(current_user), s: Session = Depends(db)):
        return emote_service.read_user_emotes(s, wallet)

    @app.put("/users/me/emotes/slots")
    async def me_emote_slots(body: EmoteSlotsBody, wallet: str = Depends(current_user), s: Session = Depends(db)):
        return emote_service.set_emote_slots(s, wallet, body.slots, elo_start)

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

    @app.post("/users/{wallet}/referral")
    async def post_referral(wallet: str, body: ReferralBody,
                            authed: str = Depends(current_user), s: Session = Depends(db)):
        if wallet != authed:
            raise HTTPException(403, "wallet mismatch")
        get_or_create_user(s, authed, elo_start)
        try:
            out = apply_referral_code(s, authed, body.code)
            s.commit()
        except ReferralError as e:
            s.rollback()
            raise HTTPException(409, str(e))
        return out

    # ── Panel del referidor: rev-share del rake ─────────────────────────────
    # Un claim en vuelo por wallet: dos pulsaciones seguidas no pueden pagar dos veces.
    _claim_locks: set = set()

    @app.get("/users/me/referrer")
    async def me_referrer(wallet: str = Depends(current_user), s: Session = Depends(db)):
        """Panel del referidor. Sin códigos en propiedad devuelve ceros, no 404: el frontend
        decide con esto si enseña el panel."""
        from .services.referral_earnings import referrer_summary
        out = referrer_summary(s, wallet)
        out["claim_min_base_units"] = referral_claim_min_base_units
        return out

    @app.post("/users/me/referrer/claim")
    async def me_referrer_claim(wallet: str = Depends(current_user), s: Session = Depends(db)):
        """Paga el rev-share pendiente desde la wallet de payouts.

        Esa wallet es la misma a la que aterriza el rake y está POR DECIDIR: mientras no se
        configure, esto responde 503 en vez de tirar del operador. El operador ya paga el rent de
        cada carta y la siembra de escrows; hacerlo además la caja de los referidos lo convertiría
        en punto único de fallo de tres cosas a la vez.
        """
        from .services.referral_earnings import (claim_earnings, mark_payout_failed,
                                                 mark_payout_sent, referrer_summary)
        pending = referrer_summary(s, wallet)["unclaimed_base_units"]
        if pending < referral_claim_min_base_units:
            raise HTTPException(409, "below_minimum")
        if not (referral_payout_wallet_id and referral_payout_address):
            raise HTTPException(503, "payouts_unavailable")
        if wallet in _claim_locks:
            raise HTTPException(409, "claim_in_progress")
        _claim_locks.add(wallet)
        try:
            payout, earning_ids = claim_earnings(s, wallet)
            if payout is None:
                raise HTTPException(409, "nothing_to_claim")
            s.commit()
            try:
                bh = await fetch_latest_blockhash(solana_rpc_url)
                # withdraw_usdc crea el ATA destino de forma idempotente (el pagador cubre la
                # renta): un referidor puede no tener cuenta USDC todavía. La wallet de payouts va
                # como origen Y como fee-payer; al ser el mismo firmante, la segunda firma es un no-op.
                sig = await withdraw_usdc(
                    solana_rpc_url, privy_signer,
                    referral_payout_wallet_id, referral_payout_address,   # origen del dinero
                    referral_payout_wallet_id, referral_payout_address,   # fee-payer
                    wallet, cc_usdc_mint, payout.amount_base_units, bh)
            except Exception as exc:
                mark_payout_failed(s, payout)
                logger.error("rev-share: claim de %s falló: %s", wallet, exc)
                raise HTTPException(502, "payout_failed")
            mark_payout_sent(s, payout, earning_ids, sig)
            return {"signature": sig, "amount_base_units": payout.amount_base_units}
        finally:
            _claim_locks.discard(wallet)

    @app.get("/leaderboard")
    async def get_leaderboard(limit: int = Query(default=50, ge=1, le=200), s: Session = Depends(db)):
        return [{"wallet": u.wallet, "alias": u.alias, "gimmighouls": u.gimmighouls, "elo": u.elo}
                for u in leaderboard(s, limit)]

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
    async def gacha_machines(s: Session = Depends(db)):
        svc = _gacha_or_503()
        try:
            return machine_visibility.visible(s, await svc.machines())
        except GachaDisabled:
            raise HTTPException(503, "gacha_disabled")
        except GachaUpstreamError as e:
            raise HTTPException(502, str(e) or "gacha upstream no disponible")

    @app.get("/gacha/winners")
    async def gacha_winners(machine: Optional[str] = None,
                            rarity: Optional[str] = None,
                            count: int = Query(default=10, ge=1, le=200)):
        """Últimos ganadores del gacha de toda la plataforma.

        `count` llega a 200 como mucho porque ese es el techo de CC. Epic se pide con el filtro
        propio de la API — solo 1 de cada 100 tiradas lo es, así que traer una página y quedarse con
        los Epic devolvería dos o tres. Las demás rarezas se recortan aquí, y por eso pueden salir
        MENOS de `count`: es el precio de que upstream no las filtre.
        """
        svc = _gacha_or_503()
        pedida = (rarity or "").strip().lower()
        try:
            filas = await svc.winners(pack_type=machine, count=count,
                                      epic_only=(pedida == "epic"))
        except GachaDisabled:
            raise HTTPException(503, "gacha_disabled")
        except GachaUpstreamError as e:
            raise HTTPException(502, str(e) or "gacha upstream no disponible")
        if pedida and pedida != "epic":
            filas = [w for w in filas if (w.get("rarity") or "").lower() == pedida]
        return filas

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

    @app.get("/gacha/nft/{mint}")
    async def gacha_nft(mint: str = Path(min_length=32, max_length=44,
                                         pattern=r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")):
        # Per-mint card metadata for the inventory modal. The mint is strictly validated (base58)
        # before it's interpolated into the upstream URL, so it can't be used for path traversal/SSRF.
        svc = _gacha_or_503()
        try:
            return await svc.nft_metadata(mint)
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
    async def gacha_submit(body: SubmitTxBody, wallet: str = Depends(current_user),
                           s: Session = Depends(db)):
        svc = _gacha_or_503()
        # NOT rate-limited: submit-tx is a mechanical follow-up of an already-throttled pull
        # initiation (generate-pack / yolo), and a YOLO of N packs calls it once per pack.
        # Throttling it here made a single multi-pack pull trip the per-wallet limit.
        try:
            out = await svc.submit_tx(signed_transaction=body.signed_transaction)
        except GachaDisabled:
            raise HTTPException(503, "gacha_disabled")
        except GachaUpstreamError as e:
            raise HTTPException(502, str(e) or "gacha upstream no disponible")
        # El pago acaba de cuajar: se marca el sobre como pagado. La fila de GachaPack se crea al
        # GENERAR, antes de pagar, así que `opened_at IS NULL` por sí solo no distingue un sobre
        # pagado y pendiente de uno que se generó y nunca se llegó a comprar. Sin esta marca, la
        # lista de pendientes le diría al usuario que tiene sobres que jamás pagó.
        if body.memo:
            pack = s.get(GachaPack, body.memo)
            if pack is not None and pack.wallet == wallet and pack.submitted_at is None:
                pack.submitted_at = datetime.now(timezone.utc)
                s.commit()
        return out

    @app.get("/gacha/buyback/available")
    async def gacha_buyback_available(wallet: str, nft: str):
        svc = _gacha_or_503()
        try:
            return await svc.buyback_available(wallet=wallet, nft=nft)
        except GachaDisabled:
            raise HTTPException(503, "gacha_disabled")
        except GachaUpstreamError as e:
            raise HTTPException(502, str(e) or "gacha upstream no disponible")

    @app.get("/gacha/packs/pending")
    async def gacha_pending_packs(wallet: str = Depends(current_user), s: Session = Depends(db)):
        """Sobres que el usuario ya PAGÓ y todavía no ha abierto.

        Sin throttle: se consulta al entrar al gacha, no en bucle.

        El filtro exige `submitted_at` además de `opened_at IS NULL`, y eso es lo que hace la
        lista honesta: la fila se crea al generar el sobre, antes de pagarlo, así que hay filas
        de tiradas que el usuario abandonó sin comprar nada. Listarlas sería decirle que tiene
        sobres —y por tanto dinero— que nunca gastó.
        """
        rows = (s.query(GachaPack)
                .filter(GachaPack.wallet == wallet,
                        GachaPack.submitted_at.isnot(None),
                        GachaPack.revealed_at.is_(None))
                .order_by(GachaPack.submitted_at)
                .limit(50)
                .all())
        # Se incluyen también los que CC ya resolvió: para el jugador siguen pendientes mientras
        # no los haya VISTO. Si nft_address ya está, el cliente no necesita volver a abrir nada —
        # reproduce el reveal con lo guardado.
        return [{"memo": p.memo, "pack_type": p.pack_type,
                 "submitted_at": p.submitted_at.isoformat() if p.submitted_at else None,
                 "nft_address": p.nft_address, "name": p.name,
                 "rarity": p.rarity, "insured_value": p.insured_value,
                 "auto_sold": bool(p.auto_sold), "buyback_amount": p.buyback_amount}
                for p in rows]

    @app.post("/gacha/packs/revealed")
    async def gacha_mark_revealed(body: MarkRevealedBody,
                                  wallet: str = Depends(current_user),
                                  s: Session = Depends(db)):
        """Marca sobres como YA VISTOS por el jugador. Idempotente y acotado a su propia wallet."""
        now = datetime.now(timezone.utc)
        marked = 0
        for memo in body.memos:
            pack = s.get(GachaPack, memo)
            if pack is not None and pack.wallet == wallet and pack.revealed_at is None:
                pack.revealed_at = now
                marked += 1
        if marked:
            s.commit()
        return {"marked": marked}

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
        # NOT rate-limited: the client POLLS this endpoint (pollOpenPack, up to ~8 attempts per
        # pack) while CC settles the pack, so a single pull hits it several times by design.
        # Throttling it here burned the per-wallet budget and made the *next* pull 429 ("I click
        # open and nothing happens"). Pull initiation (generate-pack / yolo) is what's throttled;
        # ownership is still enforced below, so polling is safe and cannot spend money.
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
            first_open = pack.opened_at is None
            pack.opened_at = datetime.now(timezone.utc)
            pack.nft_address = out["nft_address"]
            # Persist what it cost + what came out so the profile can track gacha (wager + history).
            pack.insured_value = out.get("insured_value")
            pack.name = out.get("name")
            pack.rarity = out.get("rarity")
            pack.auto_sold = bool(out.get("auto_sold"))
            pack.buyback_amount = out.get("buyback_amount")
            try:
                # Histórico: el sobre YA se abrió. No puede depender de si la máquina sigue
                # ofreciéndose — si dependiera, apagarla le quitaría los gimmighouls al jugador.
                pack.price = await _machine_price_historico(pack.pack_type)
            except Exception:
                pass  # best-effort; the open already succeeded
            # Loyalty: award gimmighouls once, at the gacha rate (lower than battles).
            if first_open and pack.price:
                from .services.referrals import award_gimmighouls
                award_gimmighouls(s, wallet, float(pack.price), ratio=get_settings().gimmighoul_per_usdc_gacha)
            s.commit()
            username = read_user_view(s, wallet, elo_start).get("alias")
            drop = {
                "type": "drop",
                "id": out.get("nft_address"),
                "wallet": wallet,
                "username": username,
                "name": out.get("name"),
                "valueUsd": out.get("insured_value"),
                "rarity": out.get("rarity"),
                "image": out.get("image"),
                "ts": int(_time.time()),
            }
            asyncio.create_task(_broadcast_drop_later(drop, cost_base=pack.price, machine_code=pack.pack_type))
        return out

    async def _machine_name(machine_code: Optional[str]) -> Optional[str]:
        """Display name (short name preferred) of a gacha machine, or None. Best-effort."""
        if not machine_code:
            return None
        try:
            # SIN filtrar por visibilidad: esto nombra drops ya ocurridos. Apagar una máquina no
            # puede borrar el nombre de lo que ya se jugó con ella.
            machines = await gacha.machines()
            m = next((x for x in machines if x.get("code") == machine_code), None)
            return (m.get("shortName") or m.get("name")) if m else None
        except Exception:
            return None

    async def _broadcast_drop_later(drop: dict, cost_base: Optional[int] = None,
                                    machine_code: Optional[str] = None) -> None:
        # Hold the drop so it never spoils the opener's own reveal.
        try:
            await asyncio.sleep(LIVE_DROP_DELAY_S)
            _drops_buf.add(drop)
            await _chat_mgr.broadcast(drop)
            mult = big_hit_multiple(drop.get("valueUsd"), cost_base)
            if mult is not None and mult >= hit_announce_mult:
                who = drop.get("username") or abbreviate(drop.get("wallet") or "")
                name = drop.get("name") or "una carta"
                extra = {"event": "hit", "amountUsd": drop["valueUsd"], "mult": round(mult, 2)}
                machine = await _machine_name(machine_code)
                if machine:
                    extra["machine"] = machine
                await _announce(f"pulled {name}", user=who, extra=extra, persist=True)
        except Exception:
            logger.exception("live drop broadcast failed")

    async def _broadcast_battle_drops(battle_id: str) -> None:
        """Surface a settled battle's pulls in the global Recent Drops feed.

        Mirrors the gacha drop broadcast, but one drop per pull and without the
        anti-spoiler delay (participants already watched the reveal). Staggered so
        they stream into the feed instead of arriving as one burst.
        """
        try:
            from .models import BattlePull
            s3 = session_factory()
            try:
                pulls = (s3.query(BattlePull)
                         .filter(BattlePull.battle_id == battle_id,
                                 BattlePull.nft_address.isnot(None))
                         .all())
                alias_cache: dict = {}
                drops = []
                for p in pulls:
                    if p.player_wallet not in alias_cache:
                        alias_cache[p.player_wallet] = read_user_view(s3, p.player_wallet, elo_start).get("alias")
                    drops.append({
                        "type": "drop",
                        "id": p.nft_address,
                        "wallet": p.player_wallet,
                        "username": alias_cache[p.player_wallet],
                        "name": p.name,
                        "valueUsd": p.insured_value,
                        "rarity": p.rarity,
                        "image": f"https://nft-dev.collectorcrypt.com/front/{p.nft_address}",
                        "ts": int(_time.time()),
                    })
            finally:
                s3.close()
            for d in drops:
                _drops_buf.add(d)
                await _chat_mgr.broadcast(d)
                await asyncio.sleep(0.5)
        except Exception:
            logger.exception("battle drops broadcast failed")

    async def _maybe_announce_winner(battle_id: str) -> None:
        """Highlight (persisted) a battle whose winner's haul >= winner_announce_mult × the entry.
        Take = total insured value of all pulls (the winner's pot); entry = per-player buy-in."""
        try:
            from .models import BattlePull
            with session_factory() as s:
                b = s.get(PackBattle, battle_id)
                if not b or b.status != "settled" or not b.winner:
                    return
                mode = b.mode
                entry_base = royale_buyin(b.max_players, b.price) if mode == "royale" else b.price
                entry = (entry_base or 0) / 1_000_000
                take = sum(p.insured_value or 0
                           for p in s.query(BattlePull).filter_by(battle_id=battle_id).all())
                if entry <= 0 or take < winner_announce_mult * entry:
                    return
                who = read_user_view(s, b.winner, elo_start).get("alias") or abbreviate(b.winner)
            label = "Battle Royale" if mode == "royale" else "Pack Battle"
            await _announce(f"won a {label}", user=who,
                            extra={"event": "winner", "amountUsd": take, "mode": mode, "mult": round(take / entry, 2)},
                            action={"label": "View", "battleId": battle_id, "mode": mode}, persist=True)
        except Exception:
            logger.exception("winner announce failed")

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
        """Precio como PUERTA: sobre el catálogo filtrado. Una máquina apagada a mano no puede
        estrenar partidas ni tiradas. Se apoya en el mismo 409 que ya usaba la indisponibilidad de
        CC. Para anotar lo que costó algo YA hecho, usar `_machine_price_historico`."""
        with session_factory() as s:
            machines = machine_visibility.visible(s, await gacha.machines())
        m = next((x for x in machines if x.get("code") == machine_code), None)
        if not m or not m.get("available", True):
            raise HTTPException(409, "máquina no disponible")
        return int(m["price"]) * 1_000_000   # USDC base units

    async def _machine_price_historico(machine_code: str) -> Optional[int]:
        """Lo que cuesta esa máquina, SIN filtrar por visibilidad ni disponibilidad.

        Es para registrar el coste de un sobre ya abierto. Con el filtro puesto, apagar una máquina
        hacía que su precio dejara de resolverse y el jugador perdía en silencio los gimmighouls de
        esa tirada — un pago retroactivo por una decisión de catálogo posterior a su compra.
        """
        machines = await gacha.machines()
        m = next((x for x in machines if x.get("code") == machine_code), None)
        return int(m["price"]) * 1_000_000 if m and m.get("price") is not None else None

    _RECONCILE_DELAY_S = 300   # reintento de reconciliación tras un void en caliente

    async def _reconcile_voided_later(battle_id: str, delay_s: float = _RECONCILE_DELAY_S):
        """Tras un void en caliente puede quedar una pull pagada sin resolver (CC lento). Reintenta
        la reconciliación + refund con sesión fresca cuando CC haya tenido tiempo de resolver."""
        try:
            await asyncio.sleep(delay_s)
            s3 = session_factory()
            try:
                b = s3.get(PackBattle, battle_id)
                if b is not None and b.status == "voided":
                    await reconcile_voided_battle_live(
                        s3, b, gacha=gacha, signer=privy_signer, rpc_url=solana_rpc_url,
                        usdc_mint=cc_usdc_mint, operator_wallet_id=privy_operator_wallet_id,
                        operator_address=privy_operator_address)
            finally:
                s3.close()
        except Exception:
            logger.exception("deferred reconcile failed for %s", battle_id)

    # Referencia fuerte a las tareas de fondo de batalla. El event loop solo mantiene referencias
    # DÉBILES a las tareas creadas con create_task, así que una sin referenciar puede ser recogida
    # por el GC en pleno vuelo — y como se cancelaría con CancelledError (un BaseException que el
    # `except Exception` del worker no captura), moriría en silencio dejando la batalla en
    # 'running' sin rastro en el log. Guardarlas aquí y soltarlas al terminar lo impide.
    _bg_tasks: set = set()

    def _spawn(coro):
        t = asyncio.create_task(coro)
        _bg_tasks.add(t)
        t.add_done_callback(_bg_tasks.discard)
        return t

    async def _run_bg(battle_id: str):
        """Background task for pack battles."""
        s2 = session_factory()
        try:
            b = s2.get(PackBattle, battle_id)
            result = await run_pack_battle_live(s2, b, gacha=gacha, signer=privy_signer,
                rpc_url=solana_rpc_url, usdc_mint=cc_usdc_mint,
                min_usdc_base_units=b.price, operator_wallet_id=privy_operator_wallet_id,
                operator_address=privy_operator_address, seed_lamports=escrow_seed_lamports)
            if result == "voided":
                asyncio.create_task(_reconcile_voided_later(battle_id))
            asyncio.create_task(_broadcast_battle_drops(battle_id))
            asyncio.create_task(_maybe_announce_winner(battle_id))
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
            result = await run_royale_live(s2, b, gacha=gacha, signer=privy_signer,
                rpc_url=solana_rpc_url, usdc_mint=cc_usdc_mint,
                operator_wallet_id=privy_operator_wallet_id,
                operator_address=privy_operator_address,
                seed_lamports=escrow_seed_lamports,
                price_base=b.price)
            if result == "voided":
                asyncio.create_task(_reconcile_voided_later(battle_id))
            asyncio.create_task(_broadcast_battle_drops(battle_id))
            asyncio.create_task(_maybe_announce_winner(battle_id))
        except Exception:
            logger.warning("background royale run failed for %s", battle_id)
        finally:
            release_reservations(s2, battle_id)
            s2.close()

    # Serialize on-chain buy-in collection (concurrent submits drop silently on devnet) and
    # CONFIRM the funds actually landed (submit does not wait for confirmation). Raises if not
    # confirmed — the caller surfaces it (toast) and does NOT join. No retry → no double charge.
    _buyin_lock = asyncio.Lock()

    async def collect_buyin_confirmed(player_wallet_id: str, player_wallet: str, escrow_address: str, amount: int):
        # Concurrent collects race and silently drop on devnet → serialize them (one at a time
        # with a short settle so each lands before the next). If the charge itself fails,
        # collect_buyin raises and the caller surfaces it (toast); no retry → no double charge.
        async with _buyin_lock:
            blockhash = await fetch_latest_blockhash(solana_rpc_url)
            await collect_buyin(solana_rpc_url, privy_signer, player_wallet_id, player_wallet,
                                privy_operator_wallet_id, privy_operator_address,
                                escrow_address, cc_usdc_mint, amount, blockhash)
            await asyncio.sleep(1)  # let the tx land before the next serialized collect

    def _anotar_buyin(s: Session, battle_id: str, wallet: str, amount: int) -> None:
        """Deja constancia de que ESTE jugador pagó su buy-in.

        Es el libro de caja que permite reconciliar un reembolso a medias: si la partida se anula y
        una transferencia falla, `buyin_paid > 0` con `refunded_at` nulo señala exactamente a quién
        le falta el dinero. Sin esto, lo único que quedaba era un saldo raro en el escrow y ninguna
        forma de saber de quién era.

        Se llama DESPUÉS del join porque el cobro va antes de que exista la fila del jugador.
        """
        fila = (s.query(BattlePlayer)
                .filter_by(battle_id=battle_id, player_wallet=wallet).first())
        if fila is not None:
            fila.buyin_paid = amount
            s.commit()

    def _anotar_reembolso(s: Session, battle_id: str, wallet: str, amount: int) -> None:
        """Cierra la anotación: a este jugador ya se le devolvió. Solo tras confirmar el envío."""
        fila = (s.query(BattlePlayer)
                .filter_by(battle_id=battle_id, player_wallet=wallet).first())
        if fila is not None:
            fila.refund_amount = amount
            fila.refunded_at = datetime.now(timezone.utc)
            s.commit()

    # Per-wallet withdraw throttle. The operator pays gas + the destination-ATA rent on every
    # withdraw, so without a rate-limit + minimum a user could spam tiny withdrawals to fresh
    # addresses and drain the operator's SOL (each new ATA ~0.002 SOL of rent the operator funds).
    _withdraw_hits: dict[str, list[float]] = {}

    def _withdraw_throttle(wallet: str) -> None:
        now = _time.time()
        hits = [t for t in _withdraw_hits.get(wallet, []) if now - t < withdraw_rate_window_s]
        if len(hits) >= withdraw_rate_limit:
            raise HTTPException(429, "demasiados retiros, inténtalo más tarde")
        hits.append(now)
        _withdraw_hits[wallet] = hits

    @app.post("/users/me/withdraw")
    async def me_withdraw(body: WithdrawBody, wallet: str = Depends(current_user),
                          wallet_id: str = Depends(current_user_id), s: Session = Depends(db)):
        # Move USDC from the player's (delegated) wallet to an external address; operator pays gas.
        if privy_signer is None or not (privy_operator_wallet_id and privy_operator_address):
            raise HTTPException(503, "withdrawals_unavailable")
        amount = int(round(body.amount * 1_000_000))   # USDC base units
        if amount <= 0:
            raise HTTPException(422, "amount must be > 0")
        # Enforce a minimum so the operator-paid ATA rent (~0.002 SOL/new dest) can't be drained
        # by a flood of 1-base-unit withdrawals to fresh addresses.
        min_base = int(round(min_withdraw_usdc * 1_000_000))
        if amount < min_base:
            raise HTTPException(422, f"el retiro mínimo es {min_withdraw_usdc} USDC")
        _withdraw_throttle(wallet)                      # rate-limit per authed wallet
        await _require_available(wallet, amount, s)     # caps at on-chain balance − reserved
        blockhash = await fetch_latest_blockhash(solana_rpc_url)
        # Platform fee: withdraw_fee_pct of the withdrawn amount, DEDUCTED from it — the destination
        # receives the net, the fee goes to the fee wallet (fallback: operator). Atomic in one tx.
        # 0 pct or no fee wallet → plain single-transfer withdrawal.
        fee_dest = fee_wallet_address or privy_operator_address
        fee = int(round(amount * withdraw_fee_pct)) if (withdraw_fee_pct > 0 and fee_dest) else 0
        net = amount - fee
        try:
            if fee > 0:
                sig = await withdraw_usdc_with_fee(solana_rpc_url, privy_signer, wallet_id, wallet,
                                                   privy_operator_wallet_id, privy_operator_address,
                                                   body.address, fee_dest, cc_usdc_mint, net, fee, blockhash)
            else:
                sig = await withdraw_usdc(solana_rpc_url, privy_signer, wallet_id, wallet,
                                          privy_operator_wallet_id, privy_operator_address,
                                          body.address, cc_usdc_mint, amount, blockhash)
        except Exception as exc:
            raise HTTPException(502, f"withdraw failed: {exc}")
        return {"signature": sig, "amount": body.amount, "net": net / 1_000_000,
                "fee": fee / 1_000_000, "address": body.address}

    @app.post("/users/me/nft/withdraw")
    async def me_nft_withdraw(body: NftWithdrawBody, wallet: str = Depends(current_user),
                             wallet_id: str = Depends(current_user_id), s: Session = Depends(db)):
        # Send an NFT owned by the player's (delegated) embedded wallet to an EXTERNAL address.
        # Reuses the same nft_transfer service that ships won cards escrow→winner. The OPERATOR
        # sponsors the transfer (fee-payer + dest-ATA rent) when configured, so the user never needs
        # SOL — 2-signer: the owner authorizes the move, the operator pays. Requires the wallet
        # delegated so the server can sign on the owner's behalf.
        if privy_signer is None:
            raise HTTPException(503, "withdrawals_unavailable")
        # Ownership check FIRST: only transfer a mint the authed wallet actually holds on-chain, so
        # a user can never move someone else's NFT (the wallet is derived from their identity token).
        try:
            owns = await nft_in_owner(solana_rpc_url, wallet, body.nft_address)
        except Exception as exc:
            raise HTTPException(502, f"ownership check failed: {exc}")
        if not owns:
            raise HTTPException(403, "no eres dueño de este NFT")
        _withdraw_throttle(wallet)  # same per-wallet throttle as USDC withdraw
        blockhash = await fetch_latest_blockhash(solana_rpc_url)
        sponsored = bool(privy_operator_wallet_id and privy_operator_address)
        try:
            tx = await build_transfer(solana_rpc_url, wallet, body.address, body.nft_address, blockhash,
                                      fee_payer=privy_operator_address if sponsored else None)
            signed = await privy_signer.sign_solana(wallet_id, tx)                          # owner authorizes
            if sponsored:
                signed = await privy_signer.sign_solana(privy_operator_wallet_id, signed)   # operator pays gas
            sig = await submit_signed_tx(solana_rpc_url, signed)
        except UnsupportedNftStandard as exc:
            raise HTTPException(422, f"unsupported nft standard: {exc}")
        except Exception as exc:
            raise HTTPException(502, f"nft withdraw failed: {exc}")
        return {"signature": sig, "nft_address": body.nft_address, "address": body.address}

    # ── Delegated signing — once the wallet is delegated, the server signs on the user's behalf
    # (session signer) so gacha/buyback/arena don't pop a wallet prompt. Each endpoint only ever
    # signs with the AUTHED user's own wallet_id, so it can never sign for anyone else. ──────────
    @app.post("/wallet/sign")
    async def wallet_sign(body: SignTxBody, wallet_id: str = Depends(current_user_id)):
        if privy_signer is None:
            raise HTTPException(503, "signing_unavailable")
        try:
            signed = await privy_signer.sign_solana(wallet_id, body.transaction)
        except Exception as exc:
            raise HTTPException(502, f"sign failed: {exc}")
        return {"signed_transaction": signed}

    @app.post("/wallet/sign-submit")
    async def wallet_sign_submit(body: SignTxBody, wallet_id: str = Depends(current_user_id)):
        if privy_signer is None:
            raise HTTPException(503, "signing_unavailable")
        try:
            signed = await privy_signer.sign_solana(wallet_id, body.transaction)
            sig = await submit_signed_tx(solana_rpc_url, signed)
        except Exception as exc:
            raise HTTPException(502, f"sign/submit failed: {exc}")
        return {"signature": sig}

    @app.post("/pack-battles")
    async def create_pack_battle(body: CreateBattleBody, wallet: str = Depends(current_user),
                                 wallet_id: str = Depends(current_user_id), s: Session = Depends(db)):
        price = await _machine_price(body.machine_code) if body.machine_code else 0
        mode = body.mode

        if mode == "royale":
            if _royale_allow and wallet not in _royale_allow:
                raise HTTPException(403, "La creación de Battle Royale está limitada durante el lanzamiento")
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
            # Del pool si hay: este era el peor derrochador de wallets, porque crea el escrow al
            # abrir el lobby y 26 de las 79 wallets existentes son de lobbies que nadie jugó.
            esc = await escrow_pool.adquirir(s, privy_signer, b.id)
            b.escrow_wallet_id = esc["id"]
            b.escrow_address = esc["address"]
            s.commit()
            # Collect the creator's buy-in immediately (creator is the first player)
            try:
                await collect_buyin_confirmed(wallet_id, wallet, b.escrow_address, buyin)
            except Exception as exc:
                raise HTTPException(502, f"No se pudo cobrar tu buy-in: {exc}")
            _anotar_buyin(s, b.id, wallet, buyin)
            resp = get_battle(s, b.id)
            resp["buyin"] = buyin
            resp["escrow_address"] = b.escrow_address
            await _announce_created(b, buyin, "royale",
                                    read_user_view(s, wallet, elo_start).get("alias") or abbreviate(wallet))
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
        await _announce_created(b, total, mode,
                                read_user_view(s, wallet, elo_start).get("alias") or abbreviate(wallet))
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
            # Collect the buy-in into the pre-created escrow BEFORE joining — single attempt.
            # If the charge fails, the player is NOT joined and gets the error (toast).
            try:
                await collect_buyin_confirmed(wallet_id, wallet, b.escrow_address, buyin)
            except Exception as exc:
                raise HTTPException(502, f"No se pudo cobrar el buy-in: {exc}")
            try:
                b, filled = join_battle(s, battle_id, wallet, wallet_id)
                _anotar_buyin(s, battle_id, wallet, buyin)
            except LobbyError as e:
                # Joined too late — refund the buy-in we just collected so it isn't stuck.
                try:
                    bh2 = await fetch_latest_blockhash(solana_rpc_url)
                    await distribute_usdc(solana_rpc_url, privy_signer, b.escrow_wallet_id,
                                          b.escrow_address, wallet, cc_usdc_mint, buyin, bh2,
                                          operator_wallet_id=privy_operator_wallet_id,
                                          operator_address=privy_operator_address)
                except Exception:
                    logger.warning("join refund failed for %s in %s", wallet, battle_id)
                raise HTTPException(409, str(e))
            if filled:
                _spawn(_run_royale_bg(battle_id))
            await _broadcast_join_event(s, b, wallet, filled)
            return get_battle(s, battle_id)

        # Default: pack mode
        await _require_available(wallet, b.price, s)
        try:
            b, filled = join_battle(s, battle_id, wallet, wallet_id)
        except LobbyError as e:
            raise HTTPException(409, str(e))
        reserve(s, wallet, battle_id, b.price)
        if filled:
            _spawn(_run_bg(battle_id))
        await _broadcast_join_event(s, b, wallet, filled)
        return get_battle(s, battle_id)

    def _rematch_body(fin: PackBattle, s: Session) -> CreateBattleBody:
        """Rebuild the create-battle body from a finished battle so the rematch has the same config."""
        if fin.mode == "royale":
            return CreateBattleBody(machine_code=fin.machine_code, max_players=fin.max_players, mode="royale")
        packs = s.query(BattlePack).filter_by(battle_id=fin.id).order_by(BattlePack.sequence).all()
        if packs:
            counts: dict[str, int] = {}
            order: list[str] = []
            for p in packs:
                if p.machine_code not in counts:
                    order.append(p.machine_code); counts[p.machine_code] = 0
                counts[p.machine_code] += 1
            return CreateBattleBody(max_players=fin.max_players, mode="pack",
                                    packs=[PackSel(machine_code=m, count=counts[m]) for m in order])
        return CreateBattleBody(machine_code=fin.machine_code, max_players=fin.max_players, mode="pack")

    @app.post("/pack-battles/{battle_id}/rematch")
    async def rematch_pack_battle(battle_id: str, wallet: str = Depends(current_user),
                                  wallet_id: str = Depends(current_user_id), s: Session = Depends(db)):
        """Create-or-join the rematch for a finished battle. The first participant to ask creates a new
        lobby with the same config (real stake — same funds path as a normal create) and the others
        auto-join it. Other participants are invited over the WS in case they left the result screen."""
        finished = s.get(PackBattle, battle_id)
        if finished is None:
            raise HTTPException(404, "no existe")
        participants = {p.player_wallet for p in s.query(BattlePlayer).filter_by(battle_id=battle_id).all()}
        if wallet not in participants:
            raise HTTPException(403, "solo los participantes pueden pedir revancha")
        if finished.status not in ("settled", "voided"):
            raise HTTPException(409, "la batalla aún no ha terminado")

        # An open rematch lobby already exists → auto-join it (funds handled by the join path).
        rm = s.get(PackBattle, finished.rematch_battle_id) if finished.rematch_battle_id else None
        if rm is not None and rm.status == "lobby":
            rm_players = {p.player_wallet for p in s.query(BattlePlayer).filter_by(battle_id=rm.id).all()}
            if wallet in rm_players:
                return {"battle_id": rm.id, "created": False, "joined": False}
            await join_pack_battle(rm.id, wallet=wallet, wallet_id=wallet_id, s=s)
            return {"battle_id": rm.id, "created": False, "joined": True}

        # Otherwise create a fresh rematch lobby with the same config (same funds path as create).
        created = await create_pack_battle(body=_rematch_body(finished, s), wallet=wallet, wallet_id=wallet_id, s=s)
        new_id = created["id"]
        finished.rematch_battle_id = new_id
        s.commit()
        buyin_base = royale_buyin(finished.max_players, finished.price) if finished.mode == "royale" else finished.price
        from_name = read_user_view(s, wallet, elo_start).get("alias") or abbreviate(wallet)
        await _chat_mgr.broadcast({
            "type": "rematch", "finished_battle_id": battle_id, "rematch_battle_id": new_id,
            "from": wallet, "from_name": from_name, "players": sorted(participants),
            "mode": finished.mode, "buyin": (buyin_base or 0) / 1_000_000,
        })
        return {"battle_id": new_id, "created": True, "joined": True}

    _emote_last: dict[str, float] = {}   # wallet → last emote monotonic ts (rate-limit)

    @app.post("/pack-battles/{battle_id}/emote")
    async def throw_battle_emote(battle_id: str, body: EmoteThrowBody, wallet: str = Depends(current_user),
                                 s: Session = Depends(db)):
        """Broadcast an emote to everyone in a battle. Requires the caller to own the emote and be a
        participant; rate-limited to ~1/s per wallet. Delivery is via the WS hub (clients filter by
        battle_id)."""
        b = s.get(PackBattle, battle_id)
        if b is None:
            raise HTTPException(404, "no existe")
        participants = {p.player_wallet for p in s.query(BattlePlayer).filter_by(battle_id=battle_id).all()}
        if wallet not in participants:
            raise HTTPException(403, "solo los participantes pueden lanzar emotes")
        if not emote_service.owns(s, wallet, body.code):
            raise HTTPException(403, "no posees ese emote")
        now = _time.monotonic()
        last = _emote_last.get(wallet)
        if last is not None and now - last < 1.0:
            raise HTTPException(429, "demasiado rápido")
        _emote_last[wallet] = now
        await _chat_mgr.broadcast({"type": "emote", "battle_id": battle_id, "from": wallet, "code": body.code})
        return {"ok": True}

    async def _add_one_bot(s: Session, b: PackBattle) -> Optional[bool]:
        """Add one funded reserve bot to lobby `b`.

        Returns the `filled` flag (True if this bot completed the lobby and the
        battle was started) when a bot was added, or None if no eligible funded
        bot is available. Raises HTTPException on on-chain failure (buy-in
        collection) or a late-join race.
        """
        bots = load_bots()
        if not bots:
            return None
        in_battle = {p.player_wallet for p in s.query(BattlePlayer).filter_by(battle_id=b.id).all()}
        buyin = royale_buyin(b.max_players, b.price) if b.mode == "royale" else b.price
        candidates = [bot for bot in bots if bot["address"] not in in_battle]
        balances = {bot["address"]: await usdc_balance_base_units(solana_rpc_url, bot["address"], cc_usdc_mint)
                    for bot in candidates}
        bot = pick_bot(bots, in_battle, balances, buyin)
        if bot is None:
            return None
        bw, bid = bot["address"], bot["id"]
        if b.mode == "royale":
            # Collect the bot's buy-in into the escrow BEFORE joining — single attempt. If the
            # charge fails, the bot is NOT joined and the caller surfaces the error (toast):
            # no silent unfunded joins, no double charge.
            try:
                await collect_buyin_confirmed(bid, bw, b.escrow_address, buyin)
            except Exception as exc:
                raise HTTPException(502, f"No se pudo cobrar el buy-in del bot: {exc}")
            try:
                _b2, filled = join_battle(s, b.id, bw, bid)
                _anotar_buyin(s, b.id, bw, buyin)
            except LobbyError as e:
                # Joined too late — refund the buy-in we just collected so it isn't stuck.
                try:
                    bh2 = await fetch_latest_blockhash(solana_rpc_url)
                    await distribute_usdc(solana_rpc_url, privy_signer, b.escrow_wallet_id,
                                          b.escrow_address, bw, cc_usdc_mint, buyin, bh2,
                                          operator_wallet_id=privy_operator_wallet_id,
                                          operator_address=privy_operator_address)
                except Exception:
                    logger.warning("join-bot refund failed for %s in %s", bw, b.id)
                raise HTTPException(409, str(e))
            if filled:
                _spawn(_run_royale_bg(b.id))
        else:
            try:
                _b2, filled = join_battle(s, b.id, bw, bid)
            except LobbyError as e:
                raise HTTPException(409, str(e))
            reserve(s, bw, b.id, b.price)
            if filled:
                _spawn(_run_bg(b.id))
        # El aviso se difunde AQUÍ y no en cada endpoint: /join-bot y /join-all-bots se lo
        # dejaban los dos, así que llenar un lobby con bots arrancaba la partida sin que a los
        # humanos les llegara el 'battle_start' — ni toast ni forma de enterarse.
        await _broadcast_join_event(s, b, bw, filled)
        return filled

    @app.post("/pack-battles/{battle_id}/join-bot")
    async def join_bot_pack_battle(battle_id: str, s: Session = Depends(db)):
        """DEV/TEST: drop a random funded reserve bot into a lobby slot (no auth).

        SECURITY: this endpoint is unauthenticated and moves real USDC on-chain (it
        collects a bot's buy-in into the escrow and can start the battle). It MUST stay
        disabled in production — it is only mounted-effectively when DEV_ENDPOINTS_ENABLED
        is set. Otherwise it 404s as if it did not exist.
        """
        if not dev_endpoints_enabled:
            raise HTTPException(404, "Not Found")
        b = s.get(PackBattle, battle_id)
        if b is None:
            raise HTTPException(404, "no existe")
        if b.status != "lobby":
            raise HTTPException(409, "la batalla no está en lobby")
        filled = await _add_one_bot(s, b)
        if filled is None:
            raise HTTPException(409, "no hay bots libres con saldo suficiente")
        return get_battle(s, battle_id)

    @app.post("/pack-battles/{battle_id}/join-all-bots")
    async def join_all_bots_pack_battle(battle_id: str, s: Session = Depends(db)):
        """DEV/TEST: fill every empty lobby seat with funded reserve bots.

        Same posture as /join-bot (unauthenticated, moves real USDC, dev-gated).
        Best-effort: adds bots until the lobby fills or no eligible funded bot
        remains; 409 only if it could not add a single bot.
        """
        if not dev_endpoints_enabled:
            raise HTTPException(404, "Not Found")
        b = s.get(PackBattle, battle_id)
        if b is None:
            raise HTTPException(404, "no existe")
        if b.status != "lobby":
            raise HTTPException(409, "la batalla no está en lobby")
        added = 0
        while True:
            filled = await _add_one_bot(s, b)
            if filled is None:   # no eligible funded bot left
                break
            added += 1
            if filled:           # lobby completed → battle started
                break
        if added == 0:
            raise HTTPException(409, "no hay bots libres con saldo suficiente")
        return get_battle(s, battle_id)

    @app.post("/pack-battles/{battle_id}/cancel")
    async def cancel_pack_battle(battle_id: str, wallet: str = Depends(current_user),
                                 s: Session = Depends(db)):
        b = s.get(PackBattle, battle_id)
        if b is None:
            raise HTTPException(404, "no existe")
        is_royale = b.mode == "royale"
        escrow_wallet_id = b.escrow_wallet_id
        escrow_address = b.escrow_address
        try:
            cancel_battle(s, battle_id, wallet)   # validates creator + lobby, sets cancelled
        except LobbyError as e:
            raise HTTPException(409, str(e))
        # Snapshot POST-flip: un join que se coló antes del flip queda incluido en los refunds;
        # uno posterior falla en join_battle (status != lobby) y se auto-refundea por su path.
        players = [p.player_wallet for p in s.query(BattlePlayer).filter_by(battle_id=battle_id).all()]
        if is_royale:
            # Refund each joined player their buy-in from the escrow (best-effort, bounded retries).
            buyin = royale_buyin(b.max_players, b.price)
            for pw in players:
                for _ in range(3):
                    try:
                        bh = await fetch_latest_blockhash(solana_rpc_url)
                        # operator pays the fee — the escrow has no SOL when cancelled pre-run
                        await refund_buyin(solana_rpc_url, privy_signer, escrow_wallet_id, escrow_address,
                                           privy_operator_wallet_id, privy_operator_address,
                                           pw, cc_usdc_mint, buyin, bh)
                        _anotar_reembolso(s, battle_id, pw, buyin)
                        break
                    except Exception as exc:
                        logger.warning("royale cancel refund retry for %s in %s: %s", pw, battle_id, exc)
                else:
                    # Sin anotar `refunded_at`: la fila queda con buyin_paid > 0 y sin reembolso, que
                    # es justo lo que hace falta para saber a quién se le debe. Antes esto solo
                    # dejaba una línea de log y el dinero quieto en el escrow sin dueño conocido.
                    logger.error("royale cancel refund FAILED after retries for %s in %s", pw, battle_id)
        else:
            release_reservations(s, battle_id)
        # Devolver el escrow al pool. Sin esto, cancelar un lobby dejaba su wallet marcada `in_use`
        # para siempre: las royale crean el escrow al abrir el lobby, y los lobbies que nadie juega
        # eran 26 de las 79 wallets históricas — o sea, el mayor derroche, intacto.
        # Si los reembolsos de arriba acaban de enviarse y aún no han aterrizado, la comprobación
        # verá saldo y la marcará `retained`; el barrido de escrow_pool_sync la reevalúa después.
        await escrow_pool.liberar_al_terminar(s, solana_rpc_url, b, cc_usdc_mint)
        return get_battle(s, battle_id)

    @app.get("/pack-battles/open")
    async def open_pack_battles(s: Session = Depends(db)):
        return lobby_list_open(s)

    @app.get("/pack-battles/list")
    async def list_pack_battles(s: Session = Depends(db)):
        # Open lobbies + live + recent finished — powers the Live-games filters.
        return lobby_list_battles(s)

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
    # Chat history is persisted in the DB (last 50) — survives restarts and is the shared source
    # of truth across workers. See save_chat_message / recent_chat_messages.
    # Generic ring buffer reused for the global Recent Drops feed. Replayed to
    # every client on connect so the feed is consistent across origins/devices
    # (localStorage is per-origin, so it can't be the shared source of truth).
    _drops_buf = ChatBuffer(maxlen=20)
    _chat_hits: dict[str, list[float]] = {}
    _CHAT_RATE_LIMIT = 5
    _CHAT_RATE_WINDOW = 10.0

    _ANNOUNCER = "📢 Arena"

    async def _announce(text: str, *, user: Optional[str] = None, action: Optional[dict] = None,
                        extra: Optional[dict] = None, persist: bool = False) -> None:
        """Post a system announcement into the lobby chat. `persist=True` stores it in history
        (highlights: big hits, winners); battle-created pings are live-only. `user` overrides the
        announcer name (e.g. the battle creator); `extra` adds structured fields for the client to
        style. Never raises."""
        try:
            author = user or _ANNOUNCER
            msg = {"type": "message", "kind": "system", "user": author,
                   "text": text, "ts": int(_time.time())}
            if action:
                msg["action"] = action
            if extra:
                msg.update(extra)
            if persist:
                with session_factory() as s:
                    save_chat_message(s, author, text, msg["ts"], kind="system", action=action,
                                      event=(extra or {}).get("event"),
                                      amount_usd=(extra or {}).get("amountUsd"),
                                      machine=(extra or {}).get("machine"),
                                      mult=(extra or {}).get("mult"))
            await _chat_mgr.broadcast(msg)
        except Exception:
            logger.exception("chat announce failed")

    async def _broadcast_join_event(s: Session, battle, joiner_wallet: str, filled: bool) -> None:
        """Push a WS event so a lobby's participants get toasted when someone joins (pack) or the
        lobby fills and starts (any mode). Client-side filtered by `players`, like the rematch toast.
        Never raises — a failed broadcast must not fail the join."""
        try:
            players = [p.player_wallet for p in
                       s.query(BattlePlayer).filter_by(battle_id=battle.id).all()]
            name = read_user_view(s, joiner_wallet, elo_start).get("alias") or abbreviate(joiner_wallet)
            ev = join_event(battle_id=battle.id, mode=battle.mode, players=players,
                            joiner_wallet=joiner_wallet, joiner_name=name, filled=filled)
            if ev is not None:
                await _chat_mgr.broadcast(ev)
        except Exception:
            logger.exception("battle join/start broadcast failed")

    async def _announce_created(battle, stake_base: int, mode: str, creator_name: str) -> None:
        """Live-only ping when a joinable battle is created — rendered as a chat event
        '{creator} created a Pack Battle $50', with a quick-join button."""
        if (battle.max_players or 0) <= 1:
            return   # no open seat → nobody to invite
        label = "Battle Royale" if mode == "royale" else "Pack Battle"
        stake = (stake_base or 0) / 1_000_000
        await _announce(f"created a {label}", user=creator_name,
                        extra={"event": "created", "amountUsd": stake, "mode": mode},
                        action={"label": "Join", "battleId": battle.id, "mode": mode})

    @app.post("/dev/announce")
    async def dev_announce(body: DevAnnounceBody):
        """DEV/TEST: broadcast one sample chat announcement (dev-gated → 404 in prod).
        Lets the chat-event design be iterated by firing hit/winner/created examples."""
        if not dev_endpoints_enabled:
            raise HTTPException(404, "Not Found")
        extra: dict = {}
        if body.event:
            extra["event"] = body.event
        if body.amountUsd is not None:
            extra["amountUsd"] = body.amountUsd
        if body.mode:
            extra["mode"] = body.mode
        if body.machine:
            extra["machine"] = body.machine
        if body.mult is not None:
            extra["mult"] = body.mult
        action = None
        if body.action_label:
            action = {"label": body.action_label, "battleId": body.battle_id, "mode": body.mode or "pack"}
        await _announce(body.text, user=body.user, extra=extra or None, action=action, persist=body.persist)
        return {"ok": True}

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
            with session_factory() as s:
                chat_history = recent_chat_messages(s)
            await ws.send_json({"type": "history", "messages": chat_history})
            await ws.send_json({"type": "drops_history", "drops": _drops_buf.history()})
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
                with session_factory() as s:
                    save_chat_message(s, display_name, text, msg["ts"])
                await _chat_mgr.broadcast({"type": "message", **msg})
        except WebSocketDisconnect:
            _chat_mgr.disconnect(ws)
            await _chat_mgr.broadcast({"type": "presence", "online": _chat_mgr.online_count()})
        except Exception:
            _chat_mgr.disconnect(ws)
            await _chat_mgr.broadcast({"type": "presence", "online": _chat_mgr.online_count()})

    # Cada cuánto se mira si hace falta abrir un lobby de la casa. No corre nada si el flag está
    # apagado, así que el coste en reposo es una consulta a SQLite cada medio minuto.
    _AUTO_ROYALE_PERIOD_S = 30.0

    async def _auto_royale_loop():
        """Mantiene una Battle Royale abierta mientras el flag `auto_royale` esté encendido.

        El flag se relee en CADA vuelta: encenderlo o apagarlo desde consola surte efecto en menos
        de un minuto sin reiniciar. El lobby se abre SIN creador y sin cobrar a nadie — ver
        services/house_lobby.py.
        """
        from .services import house_lobby
        while True:
            await asyncio.sleep(_AUTO_ROYALE_PERIOD_S)
            try:
                with session_factory() as s:
                    cfg = house_lobby.configuracion(s)
                    if cfg is None:
                        continue
                    machine, plazas = cfg
                    if not house_lobby.hace_falta_una(s, machine):
                        continue
                    b = create_battle(s, None, None, machine_code=machine,
                                      price=await _machine_price(machine),
                                      max_players=plazas, mode="royale")
                    esc = await escrow_pool.adquirir(s, privy_signer, b.id)
                    b.escrow_wallet_id = esc["id"]
                    b.escrow_address = esc["address"]
                    s.commit()
                    logger.info("auto-royale: abierto lobby de la casa %s (%s)", b.id, machine)
            except Exception:
                # Nunca puede tumbar el proceso: es un extra, no parte de ninguna partida en curso.
                logger.exception("auto-royale: no se pudo abrir el lobby; se reintenta luego")

    @app.on_event("startup")
    async def _auto_royale_start():
        if privy_signer is None:
            return          # sin firmante no hay escrow que asignar
        _spawn(_auto_royale_loop())

    @app.on_event("startup")
    async def _resume_orphaned_battles():
        # A backend restart kills the in-memory battle runners. Without this, a battle left in
        # 'running' is stranded forever (the reveal polls it and never sees it settle). On startup we
        # finish orphaned PACK and ROYALE battles off the persisted state: for pack, every pull
        # resolved → settle to the winner, a mid-pull crash (some pulls missing) → void + refund
        # each puller their own pull; for royale, resume_royale_live continues from the last
        # completed round (or voids + refunds if a mid-round pull is unrecoverable).
        # Also sweeps every already-'voided' battle through reconcile_voided_battle_live, in case a
        # hot void's deferred reconcile never got to run before a restart (idempotent, cheap no-op
        # for battles with nothing pending). Runs in background tasks so startup isn't blocked by
        # on-chain I/O.
        if privy_signer is None or gacha is None:
            return
        try:
            with session_factory() as s0:
                running = [(b.id, b.mode) for b in s0.query(PackBattle).filter_by(status="running").all()]
        except Exception:
            logger.warning("resume: could not query orphaned battles")
            return
        for bid, mode in running:
            async def _resume_one(battle_id=bid, battle_mode=mode):
                s2 = session_factory()
                try:
                    b = s2.get(PackBattle, battle_id)
                    if b is None or b.status != "running":
                        return
                    logger.warning("resume: finishing orphaned %s battle %s", battle_mode, battle_id)
                    if battle_mode == "royale":
                        await resume_royale_live(
                            s2, b, gacha=gacha, signer=privy_signer, rpc_url=solana_rpc_url,
                            usdc_mint=cc_usdc_mint, operator_wallet_id=privy_operator_wallet_id,
                            operator_address=privy_operator_address,
                            seed_lamports=escrow_seed_lamports, price_base=b.price)
                    else:
                        await resume_pack_battle_live(
                            s2, b, gacha=gacha, signer=privy_signer, rpc_url=solana_rpc_url,
                            usdc_mint=cc_usdc_mint, operator_wallet_id=privy_operator_wallet_id,
                            operator_address=privy_operator_address)
                    asyncio.create_task(_broadcast_battle_drops(battle_id))
                except Exception:
                    logger.warning("resume: failed to finish orphaned battle %s", battle_id)
                finally:
                    release_reservations(s2, battle_id)
                    s2.close()

            _spawn(_resume_one())

        # Barrido de reconciliación: batallas voided con refunds/pulls pendientes (p.ej. un void
        # en caliente cuya reconciliación diferida no llegó a correr antes de un reinicio).
        try:
            with session_factory() as s1:
                voided_ids = [b.id for b in s1.query(PackBattle).filter_by(status="voided").all()]
        except Exception:
            logger.warning("resume: could not query voided battles for reconcile sweep")
            voided_ids = []

        async def _sweep_one(battle_id):
            s2 = session_factory()
            try:
                b = s2.get(PackBattle, battle_id)
                if b is not None:
                    await reconcile_voided_battle_live(
                        s2, b, gacha=gacha, signer=privy_signer, rpc_url=solana_rpc_url,
                        usdc_mint=cc_usdc_mint, operator_wallet_id=privy_operator_wallet_id,
                        operator_address=privy_operator_address)
            except Exception:
                logger.warning("reconcile sweep failed for %s", battle_id)
            finally:
                s2.close()

        for bid in voided_ids:
            _spawn(_sweep_one(battle_id=bid))

    return app


def build_default_app() -> FastAPI:
    s = get_settings()
    _configure_app_logging()
    engine = make_engine(s.database_url)
    init_db(engine)
    session_factory = make_session_factory(engine)
    chain: ChainSource = MockChainSource()  # 'solana' se cablea cuando el lector real esté validado
    gacha = GachaService(base_url=s.gacha_base_url, api_key=s.gacha_api_key, nft_base_url=s.cc_nft_base_url)
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
                      escrow_seed_lamports=s.escrow_seed_lamports,
                      dev_endpoints_enabled=s.dev_endpoints_enabled,
                      gacha_rate_limit=s.gacha_rate_limit,
                      min_withdraw_usdc=s.min_withdraw_usdc,
                      withdraw_rate_limit=s.withdraw_rate_limit,
                      withdraw_rate_window_s=s.withdraw_rate_window_s,
                      referral_payout_wallet_id=s.referral_payout_wallet_id,
                      referral_payout_address=s.referral_payout_address,
                      referral_claim_min_base_units=s.referral_claim_min_base_units,
                      withdraw_fee_pct=s.withdraw_fee_pct,
                      fee_wallet_address=s.fee_wallet_address,
                      hit_announce_mult=s.hit_announce_mult,
                      winner_announce_mult=s.winner_announce_mult,
                      royale_creator_allowlist=s.royale_creator_allowlist_set)


app = build_default_app()
