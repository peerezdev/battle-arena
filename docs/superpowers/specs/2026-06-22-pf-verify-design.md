# Provably-Fair verification panel (#4d) — design

Date: 2026-06-22
Status: approved-pending-review
Parent: Royale state + PF verify (#4a, the `/verify` endpoint), Watch + reveal (#4b-3, `BattleResult`).
Part of #4 (UI). A frontend panel that lets anyone verify a settled battle's commit-reveal fairness by **recomputing the commit hash in the browser** (trustless) and showing the full audit trail.

## Goal
From the battle result, open a "Verify (Provably Fair)" panel that:
- Fetches the proof (`verifyBattle(id)` — already exists) and **recomputes `sha256(server_seed)` in the browser**, comparing it to the committed `server_seed_hash` → a trustless ✓/✗ (does NOT rely on the backend's `commit_ok`).
- Shows the audit trail: the seed hash (always), the revealed seed (post-settle), and the per-round draw data (royale) or the single tie-break (pack), with a plain-language explanation.

Frontend-only. No backend change.

## Background (current code)
- **Endpoint + client (already shipped):** `GET /pack-battles/{id}/verify` → `pack_lobby.verification(...)`. `verifyBattle(id): Promise<Verification>` in `src/onchain/packBattleClient.ts`. Types:
  - `Verification { mode: BattleMode; server_seed_hash: string | null; server_seed: string | null; commit_ok: boolean | null; client_seed?: string | null; tie_break_index?: number | null; rounds?: VerifyRound[] }`.
  - `VerifyRound { round_number: number; client_seed: string; eliminated_wallet: string; tie_break_index: number | null }`.
  - Post-settle: `server_seed` revealed, `commit_ok = verify_commit(server_seed, hash)`. Pre-settle: `server_seed`/`commit_ok` null. Royale → `rounds`; pack → `client_seed`/`tie_break_index`.
- **PF algorithm** (`backend/app/services/provably_fair.py`): `seed_hash(server_seed) = sha256(server_seed.encode()).hexdigest()` (UTF-8 of the hex-string seed); `verify_commit` compares that to the hash. The tie-break draw `pick_index(server_seed, client_seed, n)` needs `n` (tied-player count), which the `/verify` payload does NOT carry → out of scope (see No-goals).
- **Web Crypto in the app + tests:** `src/engine/hash.ts` already uses `crypto.subtle.digest('SHA-256', new TextEncoder().encode(...))` and is unit-tested under the jsdom vitest env (`vite.config.ts` → `environment: 'jsdom'`), so `crypto.subtle` works in both app and tests. Hex pattern: `Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')`.
- **Attach point:** `BattleResult({ vm, onExit })` (`src/ui/screens/battle/BattleResult.tsx`) is rendered by `BattleFlow` at `battle.status === 'settled'` (`BattleFlow.tsx:83`). It currently shows winner + pot + Volver. `RevealVM` has no battle id, so the id must be passed in.

## Frontend

### `pfVerify.ts` (Web Crypto, pure)
New `src/onchain/pfVerify.ts`:
- `seedHashHex(seed: string): Promise<string>` — `sha256(utf8(seed))` as lowercase hex, mirroring `seed_hash` exactly (same as `engine/hash.ts`'s digest+hex pattern).
- `verifyCommit(serverSeed: string, serverSeedHash: string): Promise<boolean>` — `(await seedHashHex(serverSeed)) === serverSeedHash`.

Tested with the known vector `seedHashHex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'`, plus `verifyCommit` true (matching) and false (mismatched hash).

### `VerifyPanel.tsx` (modal)
New `src/ui/screens/battle/VerifyPanel.tsx`, props `{ battleId: string; onClose: () => void }`. A modal (overlay + `role="dialog"`, click-outside / Volver to close, styled with theme tokens like the other battle modals).
- On mount: `verifyBattle(battleId)` → `Verification`. Loading state while pending; on fetch error → an error line + close control.
- **Commit verdict** (the trustless headline):
  - if `v.server_seed` is present: run `verifyCommit(v.server_seed, v.server_seed_hash!)` → state `'ok' | 'mismatch'`; render **"✓ Commit verificado"** (green) or **"✗ El hash no coincide"** (red). This is computed locally; the backend's `commit_ok` is not the source of truth.
  - if `v.server_seed` is null (pre-settle): render **"🔒 La semilla se revela al terminar la batalla"** (the commit can't be checked yet).
- **Audit trail:**
  - `server_seed_hash` (always, mono, wrap/truncate-friendly).
  - `server_seed` (when present).
  - royale (`v.rounds`): a list of rounds — `Ronda {round_number}` · eliminado `shortWallet(eliminated_wallet)` · `tie_break_index ?? '—'` · `client_seed` (mono, truncated).
  - pack: `client_seed` and `tie_break_index` (when present).
- **Explanation:** a short plain-language note — the operator committed to `server_seed_hash` before the battle; revealing `server_seed` afterward and confirming it hashes to that value proves the seed wasn't changed; the per-round `client_seed`/`tie_break_index` are the recorded draws.

### `BattleResult` + `BattleFlow` wiring
- `BattleResult` gains a `battleId: string` prop and local state `verifyOpen`. Adds a **"Verificar (Provably Fair)"** button (next to Volver) that sets `verifyOpen = true`; renders `<VerifyPanel battleId={battleId} onClose={() => setVerifyOpen(false)} />` when open.
- `BattleFlow.tsx:83` passes `battleId={battle.id}`: `<BattleResult vm={vm} battleId={battle.id} onExit={exit} />`.

## Data flow
1. Settled battle → `BattleResult` → user clicks "Verificar".
2. `VerifyPanel` fetches `verifyBattle(battleId)`.
3. With the revealed `server_seed`, the browser recomputes `sha256` and compares to `server_seed_hash` → trustless ✓/✗.
4. The audit trail (seeds + per-round draws) is shown for the user to inspect / replay externally.

## Error handling
- `verifyBattle` fetch error / 404 → the panel shows "No se pudo cargar la verificación" + a close control (no crash).
- `server_seed` null (pre-settle, or a spectator opening before settle) → the "seed revealed at end" state; no recompute attempted.
- `server_seed_hash` null (shouldn't happen for a created battle) → guard: show "—" and no verdict.
- `verifyCommit` is async; the verdict shows a brief "verificando…" until it resolves.

## Testing
- `pfVerify` (`src/onchain/pfVerify.test.ts`): `seedHashHex('abc')` equals the known vector; `verifyCommit` true for a seed+its hash, false for a mismatched hash.
- `VerifyPanel` (`src/ui/screens/battle/VerifyPanel.test.tsx`, mock `verifyBattle`):
  - settled + a seed that hashes to the given hash → "✓ Commit verificado"; a seed that does NOT → "✗ El hash no coincide".
  - pre-settle (`server_seed: null`) → the "se revela al terminar" message, no verdict.
  - royale payload → renders each round (round number + eliminated + tie_break); pack payload → renders `client_seed`/`tie_break_index`.
  - fetch rejection → the error line.
- `BattleResult` (`BattleResult.test.tsx`): the "Verificar" button is present and opens the panel (asserts `verifyBattle` is invoked with the `battleId`, or the panel's loading text appears).

## No-goals
- Recomputing the per-round `pick_index` draw (would require the backend to expose `n`, the tied-player count, per round) — out of scope; the panel shows the draw data but does not re-derive it.
- Any backend/endpoint/PF-algorithm change.
- A verification entry point anywhere other than `BattleResult`.
- Copy-to-clipboard / external explorer links (later polish).
- Multi-pack pack battles (#4e).
