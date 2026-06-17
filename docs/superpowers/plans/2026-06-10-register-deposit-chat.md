# Register + Deposit + Chat WebSocket — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Quitar Register, hacer funcional Deposit (modal recibir + Privy fund), y añadir chat de lobby en tiempo real por WebSocket.

**Architecture:** P1 frontend (AuthButtons + DepositModal). P2 chat: `WS /ws/chat` en FastAPI (ConnectionManager + buffer + auth por identity token) y un hook `useChat` que sustituye el mock del ChatDock.

**Tech Stack:** React + @privy-io/react-auth (+ /solana) + qrcode.react; FastAPI WebSockets + websockets + pyjwt.

**Spec:** `docs/superpowers/specs/2026-06-10-register-deposit-chat-design.md`. Verificación: `npx tsc --noEmit && npx vitest run && npm run build`; backend `cd backend && .venv/bin/python -m pytest -q`.

---

### Task 1 (P1): Quitar Register + DepositModal

**Files:**
- Modify: `src/ui/components/AuthButtons.tsx`
- Create: `src/ui/components/DepositModal.tsx`
- Modify: `src/ui/screens/Hub/Hub.tsx`, `src/ui/layouts/GameLayout.tsx`
- Modify: `package.json` (qrcode.react)

- [ ] **Step 1: Quitar Register** en `AuthButtons.tsx`: en el bloque `!authenticated`, deja **un solo botón "Log in"** (estilo primario gradiente) que llama `login()`. Elimina el botón "Sign up". El bloque autenticado (chip + Log out) no cambia.

- [ ] **Step 2: Instalar QR** `npm install qrcode.react`.

- [ ] **Step 3: `DepositModal.tsx`** — props `{ open: boolean; onClose: () => void }`. Usa `useWallets()` de `@privy-io/react-auth/solana` (`wallets[0]?.address`) y `useFundWallet()` de `@privy-io/react-auth` (confirma el hook en tipos). Overlay oscuro + panel centrado (tokens `COLORS`/`GRADIENT`/`FONTS`), respeta `useReducedMotion`. Contenido:
  - Si no hay `address`: mensaje "Inicia sesión para depositar".
  - Si hay `address`:
    - Título "Deposit USDC".
    - **QR** de la dirección: `import { QRCodeSVG } from 'qrcode.react'` → `<QRCodeSVG value={address} size={160} />`.
    - La **dirección** (monospace, truncada visualmente o entera) + botón **Copiar** (`navigator.clipboard.writeText(address)`; feedback "Copiado").
    - Enlace **faucet**: `https://spl-token-faucet.com/?token-name=USDC-Dev` (target _blank, rel noreferrer) con nota "USDC de prueba (devnet)".
    - Botón **"Fund with card/crypto"** → `fundWallet(address)` de Privy (nota pequeña "para mainnet").
  - Botón cerrar (X / fondo).

- [ ] **Step 4: Wire en `Hub.tsx`** — el botón "+ Deposit" (≈línea 170-186) deja de ser no-op: `const [depositOpen, setDepositOpen] = useState(false)`, `onClick={() => setDepositOpen(true)}`, quita el `title="Coming soon"`, y renderiza `<DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />`.

- [ ] **Step 5: Wire en `GameLayout.tsx`** — añade un botón **"+ Deposit"** (estilo compacto, junto al balance pill) que abre el mismo `DepositModal` (estado local). 

- [ ] **Step 6: Verificar** `npx tsc --noEmit && npx vitest run && npm run build` → verde.

- [ ] **Step 7: Commit**
```bash
git add src/ui/components/AuthButtons.tsx src/ui/components/DepositModal.tsx src/ui/screens/Hub/Hub.tsx src/ui/layouts/GameLayout.tsx package.json package-lock.json
git commit -m "feat(wallet): quita Register; Deposit abre modal (recibir QR/faucet + fund Privy)"
```

---

### Task 2 (P2): Backend — chat por WebSocket

**Files:**
- Modify: `backend/requirements.txt` (websockets)
- Create: `backend/app/chat.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_chat.py`

- [ ] **Step 1: Dep** — añade `websockets==12.0` a `backend/requirements.txt` y `cd backend && .venv/bin/pip install websockets==12.0` (uvicorn necesita websockets para servir WS; los tests con TestClient no, pero el server sí).

- [ ] **Step 2: Test que falla `backend/tests/test_chat.py`** (lógica pura + WS con TestClient):
```python
from app.chat import ConnectionManager, abbreviate, ChatBuffer


def test_buffer_keeps_last_n():
    buf = ChatBuffer(maxlen=3)
    for i in range(5):
        buf.add({"user": "u", "text": str(i), "ts": i})
    assert [m["text"] for m in buf.history()] == ["2", "3", "4"]


def test_abbreviate():
    assert abbreviate("ABCDEFGH1234WXYZ") == "ABCD…WXYZ"
    assert abbreviate("short") == "short"
```
Y un test del endpoint con websocket (usa el `_client_with_privy`/helpers de Privy si hace falta auth; para leer no hace falta token):
```python
def test_ws_chat_sends_history_on_connect_and_broadcasts():
    # Construye un app con privy configurado (reusa helpers de conftest para un id-token válido).
    # Conecta un cliente lector (sin token) → recibe historial (lista, posiblemente vacía).
    # Conecta un cliente con token válido (?token=...), envía un mensaje → ambos lo reciben.
    # (Usa client.websocket_connect("/ws/chat?token=..."). Marca de tiempo/orden no estricta.)
    ...
```
(El implementador completa este test con los helpers reales de conftest — `make_id_token`/`make_es256` — y `TestClient.websocket_connect`.)

- [ ] **Step 3:** `cd backend && .venv/bin/python -m pytest tests/test_chat.py -q` → FALLA.

- [ ] **Step 4: Implementar `backend/app/chat.py`:**
```python
"""Chat de lobby en memoria: buffer de mensajes recientes + gestor de conexiones."""
from __future__ import annotations
from collections import deque
from typing import Any
from fastapi import WebSocket


def abbreviate(addr: str) -> str:
    if len(addr) <= 10:
        return addr
    return f"{addr[:4]}…{addr[-4:]}"


class ChatBuffer:
    def __init__(self, maxlen: int = 50):
        self._dq: deque[dict] = deque(maxlen=maxlen)
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
        dead = []
        for ws in list(self._active):
            try:
                await ws.send_json(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._active.discard(ws)
```

- [ ] **Step 5: Endpoint `WS /ws/chat` en `main.py`:**
  - Imports: `from fastapi import WebSocket, WebSocketDisconnect`, `import time as _time`, `from .chat import ConnectionManager, ChatBuffer, abbreviate`.
  - En `create_app`, instancia `_chat_mgr = ConnectionManager()`, `_chat_buf = ChatBuffer()`, y un rate-limit por usuario (reusa el patrón `_gacha_hits`/throttle: dict wallet→timestamps, p.ej. 5 msg/10s).
  - Endpoint:
    ```python
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
            await ws.send_json({"type": "history", "messages": _chat_buf.history()})
            while True:
                data = await ws.receive_json()
                text = (data.get("text") or "").strip()
                if wallet is None:
                    await ws.send_json({"type": "error", "error": "login_required"})
                    continue
                if not text:
                    continue
                text = text[:280]
                if not _chat_allow(wallet):  # rate-limit
                    await ws.send_json({"type": "error", "error": "rate_limited"})
                    continue
                msg = {"user": abbreviate(wallet), "text": text, "ts": int(_time.time())}
                _chat_buf.add(msg)
                await _chat_mgr.broadcast({"type": "message", **msg})
        except WebSocketDisconnect:
            _chat_mgr.disconnect(ws)
        except Exception:
            _chat_mgr.disconnect(ws)
    ```
  - `_chat_allow(wallet)`: ventana simple (p.ej. 5 mensajes / 10s) con un dict de timestamps.

- [ ] **Step 6:** `cd backend && .venv/bin/python -m pytest -q` → todo verde (los previos + chat).

- [ ] **Step 7: Commit**
```bash
git add backend/requirements.txt backend/app/chat.py backend/app/main.py backend/tests/test_chat.py
git commit -m "feat(backend): chat de lobby por WebSocket (/ws/chat) con auth por identity token"
```

---

### Task 3 (P2): Frontend — useChat + ChatDock real

**Files:**
- Create: `src/hooks/useChat.ts`
- Modify: `src/ui/screens/Hub/ChatDock.tsx`

- [ ] **Step 1: `src/hooks/useChat.ts`** — hook que gestiona el WebSocket.
  - Deriva la URL WS de `config.backendUrl` (`http→ws`, `https→wss`) + `/ws/chat`; añade `?token=<identityToken>` si hay login (`useIdentityToken()` de Privy).
  - Estado `messages: {user,text,ts}[]` (inicia con el `history`), `connected: boolean`.
  - `useEffect`: abre el `WebSocket`, onmessage → si `type==='history'` set messages; si `type==='message'` append; onclose → reconexión básica (timeout) y guard de unmount; cleanup cierra el socket.
  - `send(text: string)`: `ws.send(JSON.stringify({ text }))` si está abierto.
  - Devuelve `{ messages, send, connected, canPost }` (`canPost` = hay identity token).

- [ ] **Step 2: `ChatDock.tsx`** — usar `useChat()` en vez de `messages` mock:
  - Renderiza `messages` del hook (mantén el estilo de mensaje actual; `user`/`text`/`ts`). Si está vacío, un placeholder.
  - El **input** (hoy `disabled` con "Chat coming soon…"): habilítalo cuando `canPost`; al enviar (Enter o botón) llama `send(text)` y limpia. Si no `canPost`, placeholder "Inicia sesión para chatear" y deshabilitado.
  - Live Drops se queda como está (mock).

- [ ] **Step 3: Verificar** `npx tsc --noEmit && npx vitest run && npm run build` → verde.

- [ ] **Step 4: Commit**
```bash
git add src/hooks/useChat.ts src/ui/screens/Hub/ChatDock.tsx
git commit -m "feat(hub): chat en vivo por WebSocket (useChat) reemplaza el mock del dock"
```

---

### Task 4: Verificación final
- [ ] `npx tsc --noEmit && npx vitest run && npm run build` y `cd backend && .venv/bin/python -m pytest -q` → todo verde.
- [ ] `grep -rn "Sign up\|Coming soon" src/ui/components/AuthButtons.tsx src/ui/screens/Hub/Hub.tsx` → sin restos del register/deposit no-funcional.
- [ ] Nota manual: con backend levantado (uvicorn) + dos pestañas logueadas, los mensajes aparecen en vivo; Deposit muestra dirección/QR/faucet.
