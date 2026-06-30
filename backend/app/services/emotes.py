"""Video emotes: a static catalog + per-user ownership + quick-access slots.

Catalog is static config (extend EMOTE_CATALOG freely). Ownership lives in the user_emotes table;
which 3 emotes are bound to the quick-access bar lives in User.emote_slots (a JSON list of codes).
Every user is granted DEFAULT_EMOTES the first time their emotes are read."""
from __future__ import annotations
import json
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.models import User, UserEmote

# video_url is served by the frontend (public/). Codes are stable identifiers.
EMOTE_CATALOG: list[dict] = [
    {"code": "charmander", "name": "Charmander", "video_url": "/charmander.mp4"},
    {"code": "bulbasaur",  "name": "Bulbasaur",  "video_url": "/bulbasaur.mp4"},
    {"code": "squirtle",   "name": "Squirtle",   "video_url": "/squirtle.MP4"},
]
_BY_CODE = {e["code"]: e for e in EMOTE_CATALOG}
DEFAULT_EMOTES = ["charmander", "bulbasaur", "squirtle"]   # granted to every new user
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
    """Owned codes + quick-access slots; grants the default emotes on first access."""
    owned = _owned_codes(session, wallet)
    if not owned:
        _grant(session, wallet, DEFAULT_EMOTES)
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
