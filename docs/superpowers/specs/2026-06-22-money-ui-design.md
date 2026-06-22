# Money UI — reserved/available balance + cancel lobby (#4c) — design

Date: 2026-06-22
Status: approved-pending-review
Parent: Reserved balance + cancel (#3c), Void refunds (#3d), Lobby online (#4b-2), Watch + reveal (#4b-3).
Part of #4 (UI). Surfaces the money state the backend already tracks: the player's **reserved** vs **available** USDC, a creator-only **cancel lobby** action, and the refund/void terminal states (already shown by `BattleFlow`).

## Goal
- Show **available** balance (on-chain USDC minus reserved) in the header, with a **reserved** sub-detail when funds are tied up in open pack lobbies.
- Let a lobby's **creator cancel** it while it is still in `lobby`, from both the Hub lobby rows and the `/play/battle/:id` waiting room.
- Reflect refund/void without new UI work (terminal messages already exist; reserved drops automatically when reservations release).

## Background (current code)
- **Reservations (#3c)** (`backend/app/services/reservations.py`): `reserve(s, wallet, battle_id, amount)` on pack create/join; `reserved_total(s, wallet)` sums **active** reservations (USDC base units); `release_reservations(s, battle_id)` on settle (`main.py:392`), royale run (`:414`), and cancel (`:529`). So "reserved" = active pack-lobby commitments (creator + each joiner's `price`) not yet played/cancelled. **Royale** money is NOT reserved — it is moved to escrow via `collect_buyin` at create/join, so it already shows as a lower on-chain balance; refunds come from escrow on cancel/void.
- **`_require_available`** (`main.py:367`) already computes `avail = usdc_balance_base_units(...) − reserved_total(s, wallet)` internally, but **no endpoint exposes `reserved`/`available` to the frontend.**
- **Auth**: `current_user` dependency (`main.py:126`) → wallet from the `Authorization: Bearer <identity token>`; raises **401** when the header is missing/invalid. Pattern: `@app.post("/users/me/alias")` uses `Depends(current_user)`.
- **Cancel**: `POST /pack-battles/{id}/cancel` exists (`main.py:500`); `cancelBattle(token, id)` exists in `src/onchain/packBattleClient.ts`. Cancel validates creator + lobby state server-side (`cancel_battle` raises `LobbyError` → 409 otherwise), then releases reservations (pack) or refunds buy-ins (royale).
- **Open list**: `pack_lobby.list_open(s)` returns `{id, mode, machine_code, price, max_players, players, buyin}` per `status == "lobby"` battle — **no `creator_wallet`**. `OpenBattle` (`packBattleClient.ts`) mirrors that shape. `openBattleToLive(b)` maps it to the presentational `LiveBattle` row; the Hub renders rows with a Join/Watch button (`onBattleAction`).
- **Balance display**: `useUsdcBalance()` (`src/wallet/useUsdcBalance.ts`) reads on-chain USDC (dollars, via RPC), polling on an interval with unmount-guarded state. `AppShell.tsx` shows it as the header BALANCE chip (`{usdc != null ? formatUsd(usdc) : '—'}`).
- **Battle flow**: `BattleFlow` (`src/ui/flows/BattleFlow.tsx`) already renders terminal messages for `voided` ("Batalla anulada — reembolsado") and `cancelled` ("Lobby cancelado"), with a Volver button. It has `meWallet` (from `useEmbeddedSolanaAddress`) and the polled `battle` (which carries `creator_wallet`, `status`).

## Backend changes
1. **`GET /users/me/balance`** (`main.py`): authed (`Depends(current_user)`), returns `{ "reserved": reserved_total(s, wallet) }` (int, USDC base units). No on-chain read (the frontend already has the on-chain balance). 401 when unauthenticated (inherited from `current_user`).
2. **`list_open` adds `creator_wallet`** (`pack_lobby.py`): each item gains `"creator_wallet": b.creator_wallet`. Update the `list_open` unit test and the `/pack-battles/open` API test to assert it.

No change to reservation/refund/cancel logic.

## Frontend changes

### `useReservedBalance` hook
New `src/wallet/useReservedBalance.ts` — `useReservedBalance(): { reserved: number | null }`. Fetches `GET /users/me/balance` with the identity token (`useIdentityToken`), converts base units → **dollars** (`reserved / 1e6`) so it can be subtracted from `useUsdcBalance`'s dollars directly. Polls on an interval (~10s) and clears on unmount, mirroring `useUsdcBalance`'s lifecycle (unmount-guarded `setState`). Returns `null` when not authenticated or on fetch error (header falls back to showing on-chain). A small client function `fetchReservedBalance(token): Promise<{ reserved: number }>` (base units) lives in `src/onchain/packBattleClient.ts` (it already has `authHeaders` + the `ngrok-skip-browser-warning` fetch wrapper).

### Header chip (`AppShell.tsx`)
Add `useReservedBalance()`. Compute `available = usdc != null && reserved != null ? Math.max(0, usdc - reserved) : usdc`. The chip shows:
- main value: `available != null ? formatUsd(available) : '—'`.
- when `reserved != null && reserved > 0`: a muted sub-line/append `· ${formatUsd(reserved)} reservado`.
- `Math.max(0, …)` guards the brief window where on-chain lags a fresh reservation.

### Cancel from the Hub rows
- `OpenBattle` (`packBattleClient.ts`) gains `creator_wallet: string | null`.
- `LiveBattle` (`hubMockData.ts`) gains `canCancel?: boolean`.
- `openBattleToLive(b, meWallet: string | null)` gains the `meWallet` param and sets `canCancel = !!meWallet && b.creator_wallet === meWallet`. The Hub passes `meWallet` (from `useEmbeddedSolanaAddress`).
- `LiveBattles`/`BattleRow` render a small **"Cancelar"** control on rows where `canCancel` (in addition to the existing Watch button — a creator watching their own open lobby). Clicking it calls a new `onCancel(b)` prop.
- The Hub's `onCancel(b)`: `cancelBattle(identityToken, b.id)` → on success, the open list refetches (the row disappears as the battle leaves `lobby`) and reserved updates on its next poll; errors surface in the existing `actionError` banner.

### Cancel from the battle flow
`BattleFlow` lobby waiting view: add `useIdentityToken`. When `battle.creator_wallet === meWallet` and `battle.status === 'lobby'`, render a **"Cancelar lobby"** button → `cancelBattle(identityToken, battle.id)`. On success the next poll returns `cancelled` and the existing terminal view shows "Lobby cancelado". Surface a cancel error inline (small text); keep the Volver button.

## Data flow
1. `useReservedBalance` polls `/users/me/balance` → reserved (dollars). `AppShell` subtracts from `useUsdcBalance` → available + reserved sub-line.
2. Creator cancels (Hub row or flow) → `cancelBattle` → battle leaves `lobby`; reserved releases server-side → drops on the next `useReservedBalance` poll; the open list / flow reflect the new status.

## Error handling
- `GET /users/me/balance` unauthenticated → 401; the hook treats any non-OK / error as `reserved = null` (header shows on-chain only — never blocks the balance display).
- `cancelBattle` 409 (not creator / not in lobby — e.g. it just filled and started) → surfaced inline; the list/flow refresh corrects the stale affordance.
- On-chain lag making `reserved > usdc` → `available` clamped to 0.

## Testing
- **Backend**: `GET /users/me/balance` returns `{reserved}` matching `reserved_total` for the wallet (authed); 401 without a token. `list_open` includes `creator_wallet` (unit + `/pack-battles/open` API test).
- **Frontend**:
  - `useReservedBalance`: fetches + converts base units→dollars; polls; returns `null` on error/unauthenticated; no setState after unmount.
  - Header available math (pure helper or inline-tested): `available = max(0, usdc − reserved)`; reserved sub-line shown only when `reserved > 0`; falls back to `usdc` when `reserved == null`.
  - `openBattleToLive`: `canCancel` true only when `meWallet` matches `creator_wallet`; false for others / null meWallet.
  - Hub `onCancel` calls `cancelBattle` with the token and refreshes; `BattleFlow` shows the "Cancelar lobby" button only for the creator in `lobby` and calls `cancelBattle`.

## No-goals
- Provably-Fair verify panel (#4d).
- Itemized per-lobby reserved breakdown (just the total for now).
- A royale "in escrow / at stake" line (that money already shows as reduced on-chain balance).
- Changing reservation/refund/cancel backend logic, or the engines/PF.
- Multi-pack pack battles (#4e).
