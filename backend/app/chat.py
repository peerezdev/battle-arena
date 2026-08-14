"""Chat de lobby: historial persistido en DB (últimos 50) + gestor de conexiones."""
from __future__ import annotations
import json
from collections import deque
from typing import Optional
from fastapi import WebSocket


def abbreviate(addr: str) -> str:
    if len(addr) <= 10:
        return addr
    return f"{addr[:4]}…{addr[-4:]}"


CHAT_KEEP = 50   # how many recent messages to retain / replay


def save_chat_message(session, author: str, text: str, ts: int, *, kind: str = "user",
                      action: Optional[dict] = None, event: Optional[str] = None,
                      amount_usd: Optional[float] = None, machine: Optional[str] = None,
                      mult: Optional[float] = None, wallet: Optional[str] = None,
                      mentions: Optional[list] = None, keep: int = CHAT_KEEP) -> None:
    """Persist one chat message and prune to the newest `keep` (so the table stays bounded).
    kind='system' + optional action={label, battleId, mode} for announcements with a button.
    event ('hit'|'winner'|…) + amount_usd (+ machine, the gacha machine a hit came from) let
    persisted announcements re-render in their structured style (icon + name + gold value)
    after a reconnect, not just as plain text."""
    from app.models import ChatMessage
    session.add(ChatMessage(author=author, text=text, ts=ts, kind=kind, wallet=wallet,
                            mentions=json.dumps(mentions) if mentions else None,
                            action=json.dumps(action) if action else None,
                            event=event, amount_usd=amount_usd, machine=machine, mult=mult))
    session.commit()
    old = [r[0] for r in session.query(ChatMessage.id)
           .order_by(ChatMessage.id.desc()).offset(keep).all()]
    if old:
        session.query(ChatMessage).filter(ChatMessage.id.in_(old)).delete(synchronize_session=False)
        session.commit()


def recent_chat_messages(session, limit: int = CHAT_KEEP) -> list[dict]:
    """Newest `limit` messages in chronological order. Wire format {user, text, ts} for normal
    messages; system announcements also carry {kind:'system', action}."""
    from app.models import ChatMessage
    rows = session.query(ChatMessage).order_by(ChatMessage.id.desc()).limit(limit).all()
    rows.reverse()
    out = []
    for r in rows:
        m = {"user": r.author, "text": r.text, "ts": r.ts}
        # Solo si la hay: los mensajes viejos y los avisos de la casa no tienen dueño, y mandar
        # `wallet: null` haría que el cliente pintase un enlace a /profile/null.
        if r.wallet:
            m["wallet"] = r.wallet
        # Solo si las hay: los mensajes anteriores a esta columna no las tienen, y mandar
        # `mentions: null` obligaría a cada consumidor a defenderse de un caso que no existe.
        if r.mentions:
            try:
                m["mentions"] = json.loads(r.mentions)
            except (ValueError, TypeError):
                pass
        if (r.kind or "user") != "user":
            m["kind"] = r.kind
            if r.action:
                try:
                    m["action"] = json.loads(r.action)
                except (ValueError, TypeError):
                    pass
            if r.event:
                m["event"] = r.event
            if r.amount_usd is not None:
                m["amountUsd"] = r.amount_usd
            if r.machine:
                m["machine"] = r.machine
            if r.mult is not None:
                m["mult"] = r.mult
        out.append(m)
    return out


def big_hit_multiple(insured_value: Optional[float], cost_base_units: Optional[int]) -> Optional[float]:
    """How many times the pull cost a hit is worth (insured_value in $, cost in USDC base units).
    Returns None when it can't be computed (missing/zero cost or value)."""
    if not cost_base_units or not insured_value or insured_value <= 0:
        return None
    cost = cost_base_units / 1_000_000
    if cost <= 0:
        return None
    return insured_value / cost


class ChatBuffer:
    def __init__(self, maxlen: int = 50):
        self._dq = deque(maxlen=maxlen)

    def add(self, msg: dict) -> None:
        self._dq.append(msg)

    def history(self) -> list[dict]:
        return list(self._dq)


class ConnectionManager:
    def __init__(self):
        # socket → {"wallet", "name"}, o None si es anónimo. Antes era un `set` de sockets: no se
        # guardaba QUIÉN había detrás, y sin eso no se puede ofrecer a quién mencionar.
        self._active: dict[WebSocket, Optional[dict]] = {}

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._active[ws] = None

    def identify(self, ws: WebSocket, wallet: str, name: str) -> None:
        """Ata el socket a su jugador.

        Se llama DESPUÉS de resolver el alias, no al aceptar la conexión: el nombre sale de la
        base y no se sabe hasta entonces.
        """
        if ws in self._active:
            self._active[ws] = {"wallet": wallet, "name": name}

    def disconnect(self, ws: WebSocket) -> None:
        self._active.pop(ws, None)

    def online_count(self) -> int:
        """Jugadores, no sockets: dos pestañas del mismo son uno.

        Los anónimos se cuentan sueltos porque no hay forma de saber si son la misma persona, y
        no contarlos mentiría al revés: están mirando.
        """
        wallets = {u["wallet"] for u in self._active.values() if u}
        anonimos = sum(1 for u in self._active.values() if not u)
        return len(wallets) + anonimos

    def online_users(self) -> list[dict]:
        """A quién se puede mencionar.

        Sin duplicados y ordenado por nombre, para que la lista del autocompletado no baile entre
        una pulsación y la siguiente. Los anónimos NO salen: no hay a quién avisar.
        """
        por_wallet = {u["wallet"]: u for u in self._active.values() if u}
        return sorted(por_wallet.values(), key=lambda u: u["name"].lower())

    async def broadcast(self, msg: dict) -> None:
        for ws in list(self._active):
            try:
                await ws.send_json(msg)
            except Exception:
                self._active.pop(ws, None)
