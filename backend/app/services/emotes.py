"""Video emotes: a static catalog + per-user ownership + quick-access slots.

Catalog is static config (extend EMOTE_CATALOG freely). Ownership lives in the user_emotes table;
which 3 emotes are bound to the quick-access bar lives in User.emote_slots (a JSON list of codes).
Every user is granted DEFAULT_EMOTES the first time their emotes are read."""
from __future__ import annotations
import json
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.models import User, UserEmote

# Videos are served by the frontend (public/). Transparent-background emotes ship in two
# alpha-capable formats: video_url = VP9+alpha WebM (Chrome/Firefox/Edge), video_mov =
# HEVC+alpha .mov (Safari/iOS). Codes are stable identifiers.
EMOTE_CATALOG: list[dict] = [
    {"code": "charmander",        "name": "Charmander",        "video_url": "/stickers/charmander.webm",        "video_mov": "/stickers/charmander.mov"},
    {"code": "bulbasaur",         "name": "Bulbasaur",         "video_url": "/stickers/bulbasaur.webm",         "video_mov": "/stickers/bulbasaur.mov"},
    {"code": "squirtle",          "name": "Squirtle",          "video_url": "/stickers/squirtle.webm",          "video_mov": "/stickers/squirtle.mov"},
    {"code": "pikachu",           "name": "Pikachu",           "video_url": "/stickers/pikachu.webm",           "video_mov": "/stickers/pikachu.mov"},
    {"code": "scizor-vs-kleavor", "name": "Scizor vs Kleavor", "video_url": "/stickers/scizor-vs-kleavor.webm", "video_mov": "/stickers/scizor-vs-kleavor.mov"},
    {"code": "scizor-sandwich",   "name": "Scizor Sandwich",   "video_url": "/stickers/scizor-sandwich.webm",   "video_mov": "/stickers/scizor-sandwich.mov"},
    {"code": "scizor-scared",     "name": "Scizor Scared",     "video_url": "/stickers/scizor-scared.webm",     "video_mov": "/stickers/scizor-scared.mov"},
    {"code": "scizor-card",       "name": "Scizor Card",       "video_url": "/stickers/scizor-card.webm",       "video_mov": "/stickers/scizor-card.mov"},
]
_BY_CODE = {e["code"]: e for e in EMOTE_CATALOG}
DEFAULT_EMOTES = [e["code"] for e in EMOTE_CATALOG]   # all emotes granted to every new user (no unlock flow yet)
MAX_SLOTS = 3


def catalog() -> list[dict]:
    return [dict(e) for e in EMOTE_CATALOG]


def _owned_codes(session: Session, wallet: str) -> list[str]:
    rows = set(session.execute(select(UserEmote.emote_code).where(UserEmote.wallet == wallet)).scalars().all())
    return [e["code"] for e in EMOTE_CATALOG if e["code"] in rows]   # catalog order


def _grant(session: Session, wallet: str, codes: list[str]) -> None:
    existing = set(session.execute(select(UserEmote.emote_code).where(UserEmote.wallet == wallet)).scalars().all())
    for c in codes:
        if c in _BY_CODE and c not in existing:
            session.add(UserEmote(wallet=wallet, emote_code=c))
    session.flush()


def read_user_emotes(session: Session, wallet: str) -> dict:
    """Owned codes + quick-access slots. Grants any not-yet-owned default emotes, so newly
    added defaults backfill to existing users too (not only on a user's first access)."""
    owned = _owned_codes(session, wallet)
    missing = [c for c in DEFAULT_EMOTES if c not in owned]
    if missing:
        _grant(session, wallet, missing)
        session.commit()
        owned = _owned_codes(session, wallet)
    user = session.get(User, wallet)
    slots: list[str] = []
    if user and user.emote_slots:
        try:
            slots = [c for c in json.loads(user.emote_slots) if c in owned]
        except (ValueError, TypeError):
            slots = []
    if not slots:
        slots = owned[:MAX_SLOTS]
    return {"owned": owned, "slots": slots[:MAX_SLOTS]}


def set_emote_slots(session: Session, wallet: str, slots: list[str], elo_start: int = 1200) -> dict:
    """Set the up-to-3 quick-access slots; silently drops codes the user doesn't own."""
    from app.services.users import get_or_create_user
    owned = set(_owned_codes(session, wallet))
    clean: list[str] = []
    for c in slots:
        if c in owned and c not in clean:
            clean.append(c)
        if len(clean) >= MAX_SLOTS:
            break
    user = get_or_create_user(session, wallet, elo_start)
    user.emote_slots = json.dumps(clean)
    session.commit()
    return read_user_emotes(session, wallet)


def owns(session: Session, wallet: str, code: str) -> bool:
    """Whether a wallet owns an emote — used by the (Phase 2) throw endpoint."""
    return code in set(_owned_codes(session, wallet))
