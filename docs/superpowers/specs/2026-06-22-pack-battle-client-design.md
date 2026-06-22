# Pack Battle / Royale data layer (#4b-1) — design

Date: 2026-06-22
Status: approved-pending-review
Parent: #4 (UI) → #4b (wire battle screens). This is the **data layer** the lobby (#4b-2) and watch/result (#4b-3) screens consume; it ships independently.
Backend: the `/pack-battles/*` endpoints + the #4a-enriched `get_battle` and `/verify`.

## Goal
A thin frontend client for the online Pack Battle / Battle Royale backend, plus a polling hook that tracks a battle's live state — **no UI** (that is #4b-2/#4b-3). The frontend's role for these modes is read/command only: create/join/cancel a lobby and poll `GET /pack-battles/{id}` while the backend runs the battle autonomously (server-side pulls via the escrow + session signers).

## Existing patterns to mirror (do NOT invent new infra)
- `src/onchain/config.ts` → `config.backendUrl` (`VITE_BACKEND_URL ?? http://localhost:8080`).
- `src/onchain/gachaClient.ts` → the template: a module-local `fetch` wrapper (`gachaFetch`) that prepends `config.backendUrl`, sets the `ngrok-skip-browser-warning: 'true'` header, throws `Error(detail || status)` on `!resp.ok`, returns `resp.json()`; plus `authHeaders(token)` → `{ 'Content-Type': 'application/json', Authorization: 'Bearer <token>' }`. Each client file owns its own wrapper (backendClient + gachaClient both do) — follow that; do not refactor a shared wrapper.
- The Bearer `token` is the Privy identity token from `useIdentityToken()` (consumers pass it in).

## `src/onchain/packBattleClient.ts` (new)

### Types (match the backend response shapes)
```ts
export type BattleMode = 'pack' | 'royale'
export type BattleStatus = 'lobby' | 'running' | 'settled' | 'voided' | 'cancelled'

export interface BattlePlayerState { wallet: string; eliminated_round: number | null; accumulated_value: number }
export interface BattleRoundInfo { round_number: number; eliminated_wallet: string; tie_break_index: number | null }
export interface BattlePullInfo {
  round_number: number; player_wallet: string; nft_address: string | null
  rarity: string | null; insured_value: number | null; auto_sold: boolean
}

export interface Battle {                       // GET /pack-battles/{id} (#4a-enriched)
  id: string; mode: BattleMode; machine_code: string; price: number; max_players: number
  status: BattleStatus; winner: string | null; creator_wallet: string | null
  players: BattlePlayerState[]; rounds: BattleRoundInfo[]; server_seed_hash: string | null
  // present only post-settle:
  server_seed?: string | null; client_seed?: string | null; tie_break_index?: number | null
  pulls?: BattlePullInfo[]
  // present only on the royale create/join response:
  buyin?: number; escrow_address?: string
}

export interface OpenBattle {                    // GET /pack-battles/open list item (players is a COUNT)
  id: string; machine_code: string; price: number; max_players: number; players: number
}

export interface VerifyRound { round_number: number; client_seed: string; eliminated_wallet: string; tie_break_index: number | null }
export interface Verification {
  mode: BattleMode; server_seed_hash: string | null; server_seed: string | null; commit_ok: boolean | null
  client_seed?: string | null; tie_break_index?: number | null   // pack
  rounds?: VerifyRound[]                                          // royale
}
```

### Functions (mirror gachaClient signatures)
```ts
createBattle(token, body: { machine_code: string; max_players: number; mode?: BattleMode }): Promise<Battle>   // POST /pack-battles (auth)
joinBattle(token, id: string): Promise<Battle>                                                                  // POST /pack-battles/{id}/join (auth)
cancelBattle(token, id: string): Promise<Battle>                                                                // POST /pack-battles/{id}/cancel (auth)
listOpenBattles(): Promise<OpenBattle[]>                                                                        // GET /pack-battles/open (no auth)
getBattle(id: string): Promise<Battle>                                                                          // GET /pack-battles/{id} (no auth)
verifyBattle(id: string): Promise<Verification>                                                                 // GET /pack-battles/{id}/verify (no auth)
```
- The module-local `battleFetch`/`authHeaders` mirror `gachaClient` exactly (ngrok header, `detail`-aware error, `Bearer` token). `id` is `encodeURIComponent`-ed in paths.

## `src/onchain/useBattle.ts` (new)
```ts
useBattle(id: string | null, intervalMs = 2000): { battle: Battle | null; loading: boolean; error: string | null }
```
- On mount / when `id` changes: fetch `getBattle(id)` immediately, then on an interval.
- **Stop polling** once `battle.status` is terminal (`settled` | `voided` | `cancelled`) — clear the interval. Keep polling while `lobby` | `running`.
- `id === null` → no polling, `battle = null`.
- Clears the interval on unmount and on `id` change (no leaks / no setState-after-unmount).
- A failed poll sets `error` but does NOT stop the interval (transient backend hiccup) — except a terminal status stops it.

## Testing (vitest; `@testing-library/react` for the hook)
- `packBattleClient`: mock `global.fetch` — assert each function hits the right method + path (`config.backendUrl` prefix), sends `Authorization: Bearer <token>` only on the authed ones (create/join/cancel) and not on the public reads (open/get/verify), serialises the create body correctly, and returns the parsed JSON. One error-path test: `!ok` with a `detail` body → thrown `Error(detail)`.
- `useBattle`: fake timers + a mocked `getBattle` that returns `lobby` then `running` then `settled` → the hook polls on the interval and **stops** after `settled` (assert no further calls); `id = null` → never calls; unmount mid-poll → no further calls / no error.

## No-goals
- Any UI / screens / routes (that is #4b-2 lobby and #4b-3 watch+result).
- Client-side transaction signing (the backend runs Pack Battle/Royale pulls autonomously via the escrow + session signers; the delegation gate is a #4b-2 concern).
- WebSocket (polling is sufficient; the only existing WS is lobby chat).
- A shared fetch-wrapper refactor across clients (keep the per-file pattern).
