"""Chat de lobby: historial persistido en DB (últimos 50) + gestor de conexiones."""
from __future__ import annotations
from collections import deque
from fastapi import WebSocket


def abbreviate(addr: str) -> str:
    if len(addr) <= 10:
        return addr
    return f"{addr[:4]}…{addr[-4:]}"


CHAT_KEEP = 50   # how many recent messages to retain / replay


def save_chat_message(session, author: str, text: str, ts: int, keep: int = CHAT_KEEP) -> None:
    """Persist one chat message and prune to the newest `keep` (so the table stays bounded)."""
    from app.models import ChatMessage
    session.add(ChatMessage(author=author, text=text, ts=ts))
    session.commit()
    old = [r[0] for r in session.query(ChatMessage.id)
           .order_by(ChatMessage.id.desc()).offset(keep).all()]
    if old:
        session.query(ChatMessage).filter(ChatMessage.id.in_(old)).delete(synchronize_session=False)
        session.commit()


def recent_chat_messages(session, limit: int = CHAT_KEEP) -> list[dict]:
    """Newest `limit` messages in chronological order, in the wire format {user, text, ts}."""
    from app.models import ChatMessage
    rows = session.query(ChatMessage).order_by(ChatMessage.id.desc()).limit(limit).all()
    rows.reverse()
    return [{"user": r.author, "text": r.text, "ts": r.ts} for r in rows]


class ChatBuffer:
    def __init__(self, maxlen: int = 50):
        self._dq = deque(maxlen=maxlen)

    def add(self, msg: dict) -> None:
        self._dq.append(msg)

    def history(self) -> list[dict]:
        return list(self._dq)


class ConnectionManager:
    def __init__(self):
        self._active: set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._active.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self._active.discard(ws)

    def online_count(self) -> int:
        return len(self._active)

    async def broadcast(self, msg: dict) -> None:
        for ws in list(self._active):
            try:
                await ws.send_json(msg)
            except Exception:
                self._active.discard(ws)
