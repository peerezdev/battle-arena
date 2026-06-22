# Lobby online (#4b-2) — design

Date: 2026-06-22
Status: approved-pending-review
Parent: Pack Battle data layer (`2026-06-22-pack-battle-client-design.md`, #4b-1), Pack Battle lobby (`2026-06-21-pack-battle-lobby-design.md`), Royale state + PF verify (`2026-06-22-royale-state-verify-design.md`, #4a).
Part of #4 (UI). This is the **online lobby browser**: list real open battles, create, and join, gated by session-signer delegation. The watch/reveal and result screens are #4b-3.

## Goal
Replace the Hub's `MOCK_BATTLES` with a live browser of real open battles (pack + royale) that lets a user:
- **See** the real open lobbies from `GET /pack-battles/open`.
- **Create** a lobby (pick a gacha machine + mode + players) via `POST /pack-battles`.
- **Join** a lobby via `POST /pack-battles/{id}/join`.

Create and join require the embedded wallet to be **delegated** (session signer added) because the backend signs the player's pulls server-side. The flow gates on this inline.

After create/join, the user lands on a **minimal waiting state** (poll `get_battle`, show status + players joined). The full watch/reveal and result UX is out of scope (#4b-3).

## Background (current code)
- **Backend** (`backend/app/`): `services/pack_lobby.list_open(session)` returns, per lobby in `status == "lobby"`, `{id, machine_code, price, max_players, players}` — **no `mode`**. `create_battle` validates `mode in (pack, royale)` and `2 <= max_players <= 10`. `POST /pack-battles` (`main.py`) takes `CreateBattleBody{machine_code, max_players, mode="pack"}`; for royale it computes `royale_buyin(max_players, price)` (in `services/royale_funding.py`: `total_pulls(n) = n*(n+1)//2 - 1`; `royale_buyin = ceil(total_pulls(n) * price / n)`), pre-creates an escrow, and collects the creator's buy-in. For pack it reserves `price`. `POST /pack-battles/{id}/join` mirrors this and starts the run when the lobby fills.
- **Frontend data layer (#4b-1)**: `src/onchain/packBattleClient.ts` — `listOpenBattles()`, `createBattle(token, body)`, `joinBattle(token, id)`, `cancelBattle`, `getBattle`, `verifyBattle`; types `OpenBattle{id, machine_code, price, max_players, players}`, `Battle`, `BattleMode = 'pack'|'royale'`, `BattleStatus = 'lobby'|'running'|'settled'|'voided'|'cancelled'`. `src/onchain/useBattle.ts` — polls `getBattle(id)` every 2s, stops at terminal status, leak-free.
- **Hub** (`src/ui/screens/Hub/`): `Hub.tsx` renders `QuickMatch` + `LiveBattles`; today everything navigates to `/play/arena`. `LiveBattles.tsx` is presentational: takes `battles?: LiveBattle[]` (defaults to `MOCK_BATTLES`), `onSelectMode`, `onBattleAction`; renders a mode strip, a header, a segmented filter, and `BattleRow`s with a Watch/Join button. `hubMockData.ts` defines `LiveBattle{id, mode, live, title, sub, players, extra?, cards, costLabel, costValue, action}` and `MOCK_BATTLES` (pack/royale/mana).
- **Delegation**: `src/wallet/useDelegation.ts` — `useDelegation(): {delegated, enable}` (session signer via `addSigners`, `VITE_PRIVY_SIGNER_ID`). `src/ui/screens/Profile/DelegationPanel.tsx` — busy/status UI around `enable()`.
- **Gacha machines**: `src/onchain/gachaClient.ts` — `fetchMachines(): Promise<GachaMachine[]>` (`GachaMachine{code, name, price, ...}`).
- **Auth token**: `useIdentityToken()` from `@privy-io/react-auth` (pattern in `GachaVault.tsx`, `useChat.ts`); passed as the `token` arg to `createBattle`/`joinBattle`.

## Backend change (Option A — minimal)
`pack_lobby.list_open(session)` adds `mode` and `buyin` per item:
```
{ id, mode, machine_code, price, max_players, players, buyin }
```
- `mode` = `b.mode`.
- `buyin` = `b.price` for pack; `royale_buyin(b.max_players, b.price)` for royale. Reuse the existing `royale_funding.royale_buyin` (import into `pack_lobby`; no new formula).
- No new endpoint, no query params, no auth change. Single unified list (the Hub shows pack + royale together; the client filters/labels by `mode`).

This is the only backend change. Rationale for not splitting into per-mode endpoints: the Hub renders both modes in one list, so two endpoints would mean two fetches + a client-side merge for the same result; a single list that self-describes each item's `mode` + `buyin` is simpler and keeps the detail resource (`/pack-battles/{id}`) and the list consistent.

## Frontend

### Data layer
- `packBattleClient.ts`: `OpenBattle` gains `mode: BattleMode` and `buyin: number`. (`listOpenBattles()` unchanged in shape.)
- New `src/onchain/useOpenBattles.ts` — mirrors `useBattle`'s structure. Polls `listOpenBattles()` on an interval (default 3000ms), returns `{ battles: OpenBattle[], loading: boolean, error: string | null }`. Transient fetch errors are surfaced via `error` but polling continues (same posture as `useBattle`). Cleans up its timer on unmount; ignores in-flight results after unmount (no state update on a dead component).

### Mapper `OpenBattle → LiveBattle`
- New `src/ui/screens/Hub/openBattleToLive.ts` exporting `openBattleToLive(b: OpenBattle): LiveBattle`:
  - `id` = `b.id`; `mode` = `b.mode`.
  - `title` = `b.machine_code` (friendly machine names are a later enrichment; the code is stable and unambiguous).
  - `sub` = `"${b.players}/${b.max_players} joined"`.
  - `players` = an array of length `b.players` of avatar descriptors (alternating `violet` for visual variety), matching `LiveBattle.players` shape; `extra` set to `"+N"` when `b.players` exceeds the avatars shown (cap at a small number, e.g. 4, then `extra`).
  - `cards` = a small static placeholder set (real NFTs are hidden pre-settle by the secrecy rule; the row is a teaser). Keep the existing emoji-card visual.
  - `costLabel` = `'ENTRY'` for royale, `'BUY-IN'` for pack; `costValue` = `b.buyin`.
  - `action` = `'join'` when `b.players < b.max_players`, else `'watch'`.
  - `live` = `false` (open lobbies are not yet running; `/open` only returns `status == "lobby"`).
- Pure function, unit-tested.

### Lobby browser wiring (`Hub.tsx` + `LiveBattles.tsx`)
- `Hub.tsx` calls `useOpenBattles()`, maps via `openBattleToLive`, and passes the result as `LiveBattles`' `battles` prop (replacing the `MOCK_BATTLES` default). `LiveBattles` stays presentational; its `battles?` default may keep `MOCK_BATTLES` for Storybook-less isolation, but the Hub always passes real data.
- `MOCK_BATTLES` is removed from the live list. The mana mock is dropped (no online mana lobby). `MOCK_DROPS`, `MOCK_CHAT`, `MOCK_STATS` are untouched (not in scope).
- `onBattleAction(b)`:
  - `action === 'join'` → run the **delegation gate**, then `joinBattle(token, b.id)`, then open the **waiting state** for `b.id`.
  - `action === 'watch'` → open the waiting state for `b.id` (read-only; full watch is #4b-3).
- The mode tiles (`onSelectMode`) keep their current behavior (navigate to game routes) — not in scope to change.
- `QuickMatch`'s create entry (`onCreate`) opens the **create modal** instead of navigating to `/play/arena`.

### Delegation gate (inline modal)
- New `src/ui/components/DelegationGate.tsx` (or a `useDelegationGate` hook + modal). Reuses `useDelegation()`. API: a `requireDelegation(onReady: () => void)` that, if `delegated`, calls `onReady()` immediately; otherwise opens a modal that runs `enable()` (busy/status UI like `DelegationPanel`) and, on success, calls `onReady()`. On failure, shows the error and lets the user retry or cancel.
- Both **Join** and **Create** go through this gate before hitting the backend (the backend needs the session signer to sign the player's pulls server-side).

### Create modal (`CreateBattleModal`)
- New `src/ui/screens/Hub/CreateBattleModal.tsx`. On open: `fetchMachines()` → machine picker (reuse `GachaMachine.name`/`price`). Mode toggle **Pack (1v1)** / **Royale**; for royale, a player-count selector (3–10). Pack ⇒ `max_players = 2`.
- Submit: run the delegation gate, then `createBattle(token, { machine_code, max_players, mode })`. On success → close modal, open the waiting state for the returned `Battle.id`.
- Errors (e.g. 409 insufficient funds, machine errors) are surfaced inline in the modal.

### Waiting state (`BattleWaiting`)
- New `src/ui/screens/Hub/BattleWaiting.tsx` (modal or panel). Given a `battleId`, uses `useBattle(id)`: shows `status` and "players X/Y" (from `battle.players.length` / `battle.max_players`). While `status == "lobby"`, it's a waiting room. When `status` leaves `lobby` (`running`/`settled`/`voided`/`cancelled`), it shows a placeholder ("La batalla empezó — vista completa próximamente") — **no** reveal, board, or result rendering (that is #4b-3). A close/back control returns to the lobby list.

## Carry-over (from #4b-1 final review)
- Remove the unused `waitFor` import in `src/onchain/useBattle.test.ts` (lint-only).

## Error handling
- `useOpenBattles`: transient fetch failures → `error` set, polling continues (no crash, no spinner lock).
- Join/Create: backend `409` (full lobby, already joined, insufficient available funds) and other errors → surfaced inline (toast/modal text); the lobby list refreshes after the action so stale rows correct themselves.
- Delegation `enable()` failure → shown in the gate modal; the gated action does not proceed.
- Missing `identityToken` (not logged in) → Join/Create are disabled or prompt sign-in (reuse the app's existing auth posture).

## Testing
- **Backend** (`backend/tests/`, in-memory DB): `list_open` returns `mode` + `buyin` — a pack lobby → `mode == "pack"`, `buyin == price`; a royale lobby → `mode == "royale"`, `buyin == royale_buyin(max_players, price)`. Existing `list_open`-shape assertions updated.
- **Frontend** (`npm test`):
  - `openBattleToLive`: pack vs royale → correct `costLabel`/`costValue` (`buyin`), `action` flips on `players == max_players`, `sub` text, `players`/`extra` for small and large counts.
  - `useOpenBattles`: polls on interval, surfaces errors without stopping, no state update after unmount (timer cleared).
  - Delegation gate: `delegated == true` → `onReady` called immediately (no modal); `false` → modal opens, `enable()` success → `onReady` called; `enable()` failure → error shown, `onReady` not called.
  - `CreateBattleModal`: builds the correct body — pack ⇒ `{mode:'pack', max_players:2}`; royale ⇒ `{mode:'royale', max_players:N}` — and calls `createBattle` with the identity token.

## No-goals
- Watch/reveal and result screens (#4b-3) — beyond the minimal waiting state.
- Reserved/available balance display and cancel-lobby UI (#4c).
- Provably-Fair verification panel (#4d).
- Online mana lobbies (mana stays a local skill mode).
- Friendly machine names / NFT teaser images in lobby rows (later enrichment).
- Any change to the engines, PF algorithm, or the on-chain program.
