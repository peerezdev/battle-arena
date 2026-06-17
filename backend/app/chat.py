"""Chat de lobby en memoria: buffer de mensajes recientes + gestor de conexiones."""
from __future__ import annotations
from collections import deque
from fastapi import WebSocket


def abbreviate(addr: str) -> str:
    if len(addr) <= 10:
        return addr
    return f"{addr[:4]}…{addr[-4:]}"


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

    async def broadcast(self, msg: dict) -> None:
        for ws in list(self._active):
            try:
                await ws.send_json(msg)
            except Exception:
                self._active.discard(ws)
