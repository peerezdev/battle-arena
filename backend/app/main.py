from __future__ import annotations

from typing import Optional
from fastapi import FastAPI, Depends, Header, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .config import get_settings
from .db import make_engine, make_session_factory, init_db
from .auth import AuthService, AuthError
from .chain.base import ChainSource
from .chain.mock import MockChainSource
from .services.users import get_or_create_user, read_user_view, set_alias, leaderboard, history
from .services.matches import register_match, list_open, sync_match, MatchError
from .elo import gap_label


class VerifyBody(BaseModel):
    wallet: str
    signature_hex: str


class AliasBody(BaseModel):
    alias: str


class CreateMatchBody(BaseModel):
    battle_pubkey: str
    min_elo: Optional[int] = None
    max_elo: Optional[int] = None


def create_app(session_factory, chain: ChainSource, auth: AuthService,
               elo_start: int = 1200, elo_k: int = 32) -> FastAPI:
    app = FastAPI(title="Battle Arena — Backend")

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
        s.commit()
        return rows

    @app.post("/matches/{battle_pubkey}/sync")
    async def post_sync(battle_pubkey: str, s: Session = Depends(db)):
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
    async def get_leaderboard(limit: int = 50, s: Session = Depends(db)):
        return [{"wallet": u.wallet, "alias": u.alias, "elo": u.elo} for u in leaderboard(s, limit)]

    return app


def build_default_app() -> FastAPI:
    s = get_settings()
    engine = make_engine(s.database_url)
    init_db(engine)
    session_factory = make_session_factory(engine)
    chain: ChainSource = MockChainSource()  # 'solana' se cablea cuando el lector real esté validado
    auth = AuthService(ttl=s.session_ttl)
    return create_app(session_factory, chain, auth, elo_start=s.elo_start, elo_k=s.elo_k)


app = build_default_app()
