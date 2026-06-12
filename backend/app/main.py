from __future__ import annotations

import base64
import time as _time
from datetime import datetime, timezone
from typing import Optional
from fastapi import FastAPI, Depends, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from .config import get_settings
from .db import make_engine, make_session_factory, init_db
from .auth import AuthService, AuthError
from .chain.base import ChainSource
from .chain.mock import MockChainSource
from .services.users import get_or_create_user, read_user_view, set_alias, leaderboard, history
from .services.matches import register_match, list_open, sync_match, MatchError
from .elo import gap_label
from .services.gacha import GachaService, GachaDisabled, GachaUpstreamError
from .models import GachaPack


class VerifyBody(BaseModel):
    wallet: str = Field(min_length=32, max_length=44)
    signature_hex: str


class AliasBody(BaseModel):
    alias: str = Field(min_length=1, max_length=32)


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


def create_app(session_factory, chain: ChainSource, auth: AuthService,
               elo_start: int = 1200, elo_k: int = 32,
               cors_origins: list[str] | None = None,
               gacha: GachaService | None = None,
               gacha_rate_limit: int = 10) -> FastAPI:
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

    def current_wallet(authorization: Optional[str] = Header(None)) -> str:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(401, "falta token")
        wallet = auth.wallet_for_token(authorization[len("Bearer "):])
        if wallet is None:
            raise HTTPException(401, "token inválido o caducado")
        return wallet

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/auth/nonce")
    async def auth_nonce(wallet: str = Query(..., min_length=32, max_length=44)):
        return {"nonce": auth.issue_nonce(wallet)}

    @app.post("/auth/verify")
    async def auth_verify(body: VerifyBody):
        try:
            token = auth.verify(body.wallet, body.signature_hex)
        except AuthError as e:
            raise HTTPException(401, str(e))
        return {"token": token}

    @app.post("/auth/logout")
    async def auth_logout(authorization: Optional[str] = Header(None),
                          wallet: str = Depends(current_wallet)):
        token = authorization[len("Bearer "):]
        auth.revoke(token)
        return {"ok": True}

    @app.post("/users/me/alias")
    async def me_alias(body: AliasBody, wallet: str = Depends(current_wallet), s: Session = Depends(db)):
        get_or_create_user(s, wallet, elo_start)
        set_alias(s, wallet, body.alias)
        s.commit()
        return {"wallet": wallet, "alias": body.alias}

    @app.get("/users/{wallet}")
    async def get_user(wallet: str, s: Session = Depends(db)):
        return read_user_view(s, wallet, elo_start)

    @app.get("/users/{wallet}/history")
    async def get_history(wallet: str, s: Session = Depends(db)):
        return [{"battle_pubkey": h.battle_pubkey, "elo_before": h.elo_before,
                 "elo_after": h.elo_after, "result": h.result} for h in history(s, wallet)]

    @app.post("/matches")
    async def post_match(body: CreateMatchBody, wallet: str = Depends(current_wallet), s: Session = Depends(db)):
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
    async def post_sync(battle_pubkey: str, wallet: str = Depends(current_wallet), s: Session = Depends(db)):
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
        except GachaUpstreamError:
            raise HTTPException(502, "gacha upstream no disponible")

    @app.post("/gacha/generate-pack")
    async def gacha_generate(body: GeneratePackBody,
                             wallet: str = Depends(current_wallet),
                             s: Session = Depends(db)):
        svc = _gacha_or_503()
        _gacha_throttle(wallet)
        try:
            out = await svc.generate_pack(player_address=wallet, pack_type=body.pack_type)
        except GachaDisabled:
            raise HTTPException(503, "gacha_disabled")
        except GachaUpstreamError:
            raise HTTPException(502, "gacha upstream no disponible")
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
    async def gacha_submit(body: SubmitTxBody, wallet: str = Depends(current_wallet)):
        svc = _gacha_or_503()
        _gacha_throttle(wallet)
        try:
            return await svc.submit_tx(signed_transaction=body.signed_transaction)
        except GachaDisabled:
            raise HTTPException(503, "gacha_disabled")
        except GachaUpstreamError:
            raise HTTPException(502, "gacha upstream no disponible")

    @app.post("/gacha/open-pack")
    async def gacha_open(body: OpenPackBody,
                         wallet: str = Depends(current_wallet),
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
        except GachaUpstreamError:
            raise HTTPException(502, "gacha upstream no disponible")
        if not out.get("pending") and out.get("nft_address"):
            pack.opened_at = datetime.now(timezone.utc)
            pack.nft_address = out["nft_address"]
            s.commit()
        return out

    return app


def build_default_app() -> FastAPI:
    s = get_settings()
    engine = make_engine(s.database_url)
    init_db(engine)
    session_factory = make_session_factory(engine)
    chain: ChainSource = MockChainSource()  # 'solana' se cablea cuando el lector real esté validado
    auth = AuthService(ttl=s.session_ttl)
    gacha = GachaService(base_url=s.gacha_base_url, api_key=s.gacha_api_key)
    return create_app(session_factory, chain, auth, elo_start=s.elo_start, elo_k=s.elo_k,
                      cors_origins=s.cors_origins, gacha=gacha)


app = build_default_app()
