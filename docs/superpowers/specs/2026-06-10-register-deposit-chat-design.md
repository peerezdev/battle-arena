# Quitar Register + Deposit funcional + Chat WebSocket — Diseño

**Fecha:** 2026-06-10
**Estado:** Aprobado (conversación, 2026-06-10)
**Alcance:** Tres cambios sobre el estado actual (master): (1) quitar el botón
Register, (2) hacer funcional el botón Deposit, (3) chat de lobby en tiempo real
por WebSocket. Se implementa en **dos fases** (P1: 1+2 frontend; P2: chat).

## 1 · Quitar Register

- En `src/ui/components/AuthButtons.tsx` (no autenticado): dejar **un solo botón
  "Log in"** que llama `login()` de Privy (Privy unifica login/registro; "Sign up"
  era redundante). El estado autenticado (chip + Log out) no cambia.

## 2 · Deposit funcional

- **`DepositModal`** (`src/ui/components/DepositModal.tsx`, nuevo): se abre desde
  los botones Deposit del **Hub topbar** y del **GameLayout**.
  - **Recibir (devnet):** dirección de la embedded Solana wallet de Privy
    (`useWallets()` de `@privy-io/react-auth/solana`), botón **copiar**, **QR**
    (`qrcode.react`), y enlace al **faucet** de USDC devnet
    (`https://spl-token-faucet.com/?token-name=USDC-Dev`, mint `VITE_STAKE_MINT`).
  - **Fondear con Privy (mainnet):** botón que llama `useFundWallet().fundWallet(address)`
    de Privy (on-ramp). Útil en mainnet; en devnet queda enganchado.
  - Si no hay wallet/login: el modal invita a iniciar sesión.
- Estado del modal local en Hub/GameLayout (un `useState(open)` + render del modal).
- Dep nueva: `qrcode.react`.

## 3 · Chat por WebSocket (P2)

### Backend (FastAPI)
- **`backend/app/chat.py`** (nuevo): `ConnectionManager` (set de websockets
  activos; `connect`/`disconnect`/`broadcast`) + un **ring buffer** de los últimos
  `N=50` mensajes en memoria. `ChatMessage`: `{ user: str, text: str, ts: int }`.
- **`WS /ws/chat`** en `main.py`:
  - Acepta la conexión. Query param opcional `token` (identity token de Privy).
    Si hay token válido → el usuario puede **publicar**; nombre = alias del usuario
    (tabla users) o, si no, wallet abreviada. Sin token → **solo lectura**.
  - Al conectar, envía el **historial** (los N en buffer).
  - Recibe mensajes del cliente; si no está autenticado → ignora/cierra con error;
    si lo está → **saneo + longitud máx (p.ej. 280)** + **rate-limit por usuario**
    (reusar el patrón del limiter del gacha), añade al buffer y **broadcast** a
    todos. Maneja desconexiones limpiamente.
- **Verificación del token** vía `PrivyVerifier` (ya existe); el WS lo recibe por
  query param porque el navegador no puede poner cabecera Authorization en WS.

### Frontend
- **`src/hooks/useChat.ts`** (nuevo): conecta a `wss?://<backendUrl>/ws/chat`
  (deriva ws/wss de `config.backendUrl`; añade `?token=<identityToken>` si hay
  login), expone `{ messages, send, connected }`. Reconexión básica.
- **`src/ui/screens/Hub/ChatDock.tsx`**: pasa de mock a usar `useChat()`. El input,
  hoy deshabilitado ("coming soon"), se **habilita cuando el usuario está logueado**
  (si no, placeholder "inicia sesión para chatear"). Mantiene Live Drops como está
  (mock; su realtime es otra cosa).

### Seguridad
- Publicar requiere identity token válido (verificado server-side); leer abierto.
- Rate-limit + longitud + saneado del texto (evitar spam/inyección de markup; el
  render ya escapa al ser texto en React).
- El token viaja por query param del WS (sobre wss en prod); aceptable para
  identity token de corta vida.

## Verificación

- **P1:** `tsc` + `vitest` + `build` verdes; visual: solo "Log in"; Deposit abre el
  modal con dirección/copiar/QR/faucet + botón Privy.
- **P2:** backend `pytest` (tests del `ConnectionManager`/buffer + un test de
  `/ws/chat` con `TestClient.websocket_connect`: historial al conectar, publicar
  autenticado difunde, no-auth no publica); frontend `tsc`/`build`; manual con
  backend levantado: dos pestañas ven los mensajes en vivo.

## No-goals (YAGNI)

- Múltiples salas / DMs / historial persistente en BD (buffer en memoria; al
  reiniciar el backend se vacía — aceptable para lobby chat).
- Moderación avanzada, reacciones, presencia detallada (solo un contador online).
- Realtime para Live Drops (sigue mock).
- Push del flujo de Privy fund en devnet (solo enganchado para mainnet).

## Riesgos

- **Backend accesible desde el frontend** para que el chat funcione (CORS + WS;
  en local localhost, en preview tunelizado haría falta exponer también el
  backend). Anotar para la prueba manual.
- **Auth WS por query param**: el identity token queda en la URL del WS; mitigado
  por wss + token de corta vida. No loguear la query.
- `useFundWallet` en devnet no fondea de verdad — el valor real es en mainnet.
