# Pack Battle / Royale data layer (#4b-1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A thin frontend client for the `/pack-battles/*` backend + a polling hook that tracks a battle's live state — no UI.

**Architecture:** `src/onchain/packBattleClient.ts` mirrors `gachaClient.ts` (module-local `fetch` wrapper + `authHeaders`, `config.backendUrl`). `src/onchain/useBattle.ts` polls `getBattle` while the battle is `lobby`/`running` and stops at a terminal status. Vitest tests for both.

**Tech Stack:** TypeScript, React 19, Vite, Vitest, @testing-library/react. Run from the repo ROOT (not `backend/`): focused `npx vitest run <path>`, full `npm test`.

## Global Constraints

- Mirror `gachaClient.ts` exactly: a module-local `battleFetch<T>(path, options?)` that prepends `config.backendUrl`, sets header `ngrok-skip-browser-warning: 'true'`, throws `new Error(detail || \`Battle error ${status}\`)` on `!resp.ok` (parsing `detail` from the JSON body), returns `resp.json()`. Plus `authHeaders(token)` → `{ 'Content-Type': 'application/json', Authorization: \`Bearer ${token}\` }`. Per-file wrapper — do NOT refactor a shared one.
- Auth header (`Bearer`) is sent ONLY by `createBattle`/`joinBattle`/`cancelBattle`. The public reads (`listOpenBattles`/`getBattle`/`verifyBattle`) send NO auth.
- `id` is `encodeURIComponent`-ed in every path.
- `useBattle`: poll while `status ∈ {lobby, running}`; STOP (clear interval) at `{settled, voided, cancelled}`; a transient fetch error sets `error` but does NOT stop polling; `id === null` → never poll, `battle = null`; clean up on unmount and on `id` change (no setState-after-unmount).
- Types match the backend: `OpenBattle.players` is a COUNT (number); `Battle.players` is an ARRAY of `{wallet, eliminated_round, accumulated_value}`.
- No UI, no client-side signing, no WebSocket.

---

### Task 1: `packBattleClient.ts`

**Files:**
- Create: `src/onchain/packBattleClient.ts`
- Test: `src/onchain/packBattleClient.test.ts`

**Interfaces:**
- Consumes: `config.backendUrl` (`src/onchain/config.ts`).
- Produces: types `BattleMode, BattleStatus, BattlePlayerState, BattleRoundInfo, BattlePullInfo, Battle, OpenBattle, VerifyRound, Verification`; functions `createBattle(token, body)`, `joinBattle(token, id)`, `cancelBattle(token, id)`, `listOpenBattles()`, `getBattle(id)`, `verifyBattle(id)`.

- [ ] **Step 1: Write the failing test**

Create `src/onchain/packBattleClient.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as client from './packBattleClient'
import { config } from './config'

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok, status,
    json: async () => body,
  } as unknown as Response)
}

describe('packBattleClient', () => {
  afterEach(() => vi.restoreAllMocks())

  it('createBattle POSTs with auth + body and returns the battle', async () => {
    const battle = { id: 'b1', mode: 'pack', status: 'lobby', players: [], rounds: [] }
    const f = mockFetch(battle); vi.stubGlobal('fetch', f)
    const out = await client.createBattle('tok', { machine_code: 'pokemon_50', max_players: 2, mode: 'pack' })
    expect(out).toEqual(battle)
    const [url, opts] = f.mock.calls[0]
    expect(url).toBe(`${config.backendUrl}/pack-battles`)
    expect(opts.method).toBe('POST')
    expect(opts.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(opts.body)).toEqual({ machine_code: 'pokemon_50', max_players: 2, mode: 'pack' })
  })

  it('joinBattle and cancelBattle hit the right authed paths', async () => {
    const f = mockFetch({ id: 'b 1' }); vi.stubGlobal('fetch', f)
    await client.joinBattle('tok', 'b 1')
    expect(f.mock.calls[0][0]).toBe(`${config.backendUrl}/pack-battles/b%201/join`)
    expect(f.mock.calls[0][1].method).toBe('POST')
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer tok')
    await client.cancelBattle('tok', 'b 1')
    expect(f.mock.calls[1][0]).toBe(`${config.backendUrl}/pack-battles/b%201/cancel`)
  })

  it('public reads send NO auth header', async () => {
    const f = mockFetch([]); vi.stubGlobal('fetch', f)
    await client.listOpenBattles()
    expect(f.mock.calls[0][0]).toBe(`${config.backendUrl}/pack-battles/open`)
    expect((f.mock.calls[0][1]?.headers ?? {}).Authorization).toBeUndefined()
    await client.getBattle('b1')
    expect(f.mock.calls[1][0]).toBe(`${config.backendUrl}/pack-battles/b1`)
    await client.verifyBattle('b1')
    expect(f.mock.calls[2][0]).toBe(`${config.backendUrl}/pack-battles/b1/verify`)
  })

  it('throws Error(detail) on a non-ok response', async () => {
    const f = mockFetch({ detail: 'USDC disponible insuficiente' }, false, 402); vi.stubGlobal('fetch', f)
    await expect(client.getBattle('b1')).rejects.toThrow('USDC disponible insuficiente')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from repo root): `npx vitest run src/onchain/packBattleClient.test.ts`
Expected: FAIL — `packBattleClient.ts` does not exist / exports undefined.

- [ ] **Step 3: Write minimal implementation**

Create `src/onchain/packBattleClient.ts`:

```ts
// Thin client for the backend /pack-battles/* endpoints. Mirrors gachaClient.ts.
import { config } from './config'

export type BattleMode = 'pack' | 'royale'
export type BattleStatus = 'lobby' | 'running' | 'settled' | 'voided' | 'cancelled'

export interface BattlePlayerState { wallet: string; eliminated_round: number | null; accumulated_value: number }
export interface BattleRoundInfo { round_number: number; eliminated_wallet: string; tie_break_index: number | null }
export interface BattlePullInfo {
  round_number: number; player_wallet: string; nft_address: string | null
  rarity: string | null; insured_value: number | null; auto_sold: boolean
}

export interface Battle {
  id: string; mode: BattleMode; machine_code: string; price: number; max_players: number
  status: BattleStatus; winner: string | null; creator_wallet: string | null
  players: BattlePlayerState[]; rounds: BattleRoundInfo[]; server_seed_hash: string | null
  server_seed?: string | null; client_seed?: string | null; tie_break_index?: number | null
  pulls?: BattlePullInfo[]
  buyin?: number; escrow_address?: string
}

export interface OpenBattle { id: string; machine_code: string; price: number; max_players: number; players: number }

export interface VerifyRound { round_number: number; client_seed: string; eliminated_wallet: string; tie_break_index: number | null }
export interface Verification {
  mode: BattleMode; server_seed_hash: string | null; server_seed: string | null; commit_ok: boolean | null
  client_seed?: string | null; tie_break_index?: number | null
  rounds?: VerifyRound[]
}

async function battleFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${config.backendUrl}${path}`, {
    ...options,
    headers: { ...(options?.headers as Record<string, string> | undefined), 'ngrok-skip-browser-warning': 'true' },
  })
  if (!resp.ok) {
    let detail: string | undefined
    try { detail = (await resp.json())?.detail } catch { /* ignore */ }
    throw new Error(detail || `Battle error ${resp.status}`)
  }
  return resp.json() as Promise<T>
}

function authHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

export function createBattle(
  token: string,
  body: { machine_code: string; max_players: number; mode?: BattleMode },
): Promise<Battle> {
  return battleFetch<Battle>('/pack-battles', {
    method: 'POST', headers: authHeaders(token), body: JSON.stringify(body),
  })
}

export function joinBattle(token: string, id: string): Promise<Battle> {
  return battleFetch<Battle>(`/pack-battles/${encodeURIComponent(id)}/join`, {
    method: 'POST', headers: authHeaders(token),
  })
}

export function cancelBattle(token: string, id: string): Promise<Battle> {
  return battleFetch<Battle>(`/pack-battles/${encodeURIComponent(id)}/cancel`, {
    method: 'POST', headers: authHeaders(token),
  })
}

export function listOpenBattles(): Promise<OpenBattle[]> {
  return battleFetch<OpenBattle[]>('/pack-battles/open')
}

export function getBattle(id: string): Promise<Battle> {
  return battleFetch<Battle>(`/pack-battles/${encodeURIComponent(id)}`)
}

export function verifyBattle(id: string): Promise<Verification> {
  return battleFetch<Verification>(`/pack-battles/${encodeURIComponent(id)}/verify`)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/onchain/packBattleClient.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/onchain/packBattleClient.ts src/onchain/packBattleClient.test.ts
git commit -m "feat(fe): packBattleClient — /pack-battles client (create/join/cancel/open/get/verify)"
```

---

### Task 2: `useBattle` polling hook

**Files:**
- Create: `src/onchain/useBattle.ts`
- Test: `src/onchain/useBattle.test.ts`

**Interfaces:**
- Consumes: `getBattle`, `Battle` (Task 1).
- Produces: `useBattle(id: string | null, intervalMs?: number): { battle: Battle | null; loading: boolean; error: string | null }`.

- [ ] **Step 1: Write the failing test**

Create `src/onchain/useBattle.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('./packBattleClient', () => ({ getBattle: vi.fn() }))
import { getBattle } from './packBattleClient'
import { useBattle } from './useBattle'

const mockGet = getBattle as unknown as ReturnType<typeof vi.fn>

describe('useBattle', () => {
  beforeEach(() => { vi.useFakeTimers(); mockGet.mockReset() })
  afterEach(() => { vi.useRealTimers() })

  it('polls while running and STOPS at a terminal status', async () => {
    mockGet
      .mockResolvedValueOnce({ id: 'b1', status: 'lobby', players: [], rounds: [] })
      .mockResolvedValueOnce({ id: 'b1', status: 'running', players: [], rounds: [] })
      .mockResolvedValueOnce({ id: 'b1', status: 'settled', players: [], rounds: [] })
    renderHook(() => useBattle('b1', 1000))
    await vi.advanceTimersByTimeAsync(0)      // immediate poll → lobby
    await vi.advanceTimersByTimeAsync(1000)   // → running
    await vi.advanceTimersByTimeAsync(1000)   // → settled (clears interval)
    expect(mockGet).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(5000)   // no further polls after terminal
    expect(mockGet).toHaveBeenCalledTimes(3)
  })

  it('does not poll when id is null', async () => {
    renderHook(() => useBattle(null, 1000))
    await vi.advanceTimersByTimeAsync(3000)
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('stops polling after unmount', async () => {
    mockGet.mockResolvedValue({ id: 'b1', status: 'running', players: [], rounds: [] })
    const { unmount } = renderHook(() => useBattle('b1', 1000))
    await vi.advanceTimersByTimeAsync(0)
    const callsBefore = mockGet.mock.calls.length
    unmount()
    await vi.advanceTimersByTimeAsync(5000)
    expect(mockGet.mock.calls.length).toBe(callsBefore)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/onchain/useBattle.test.ts`
Expected: FAIL — `useBattle.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/onchain/useBattle.ts`:

```ts
import { useEffect, useState } from 'react'
import { getBattle, type Battle, type BattleStatus } from './packBattleClient'

const TERMINAL: ReadonlySet<BattleStatus> = new Set(['settled', 'voided', 'cancelled'])

export function useBattle(id: string | null, intervalMs = 2000): {
  battle: Battle | null; loading: boolean; error: string | null
} {
  const [battle, setBattle] = useState<Battle | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) { setBattle(null); return }
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null
    setLoading(true)

    const poll = async () => {
      try {
        const b = await getBattle(id)
        if (cancelled) return
        setBattle(b)
        setError(null)
        if (TERMINAL.has(b.status) && timer) { clearInterval(timer); timer = null }
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))   // transient → keep polling
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    poll()
    timer = setInterval(poll, intervalMs)
    return () => { cancelled = true; if (timer) clearInterval(timer) }
  }, [id, intervalMs])

  return { battle, loading, error }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/onchain/useBattle.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full frontend suite + commit**

Run (repo root): `npm test`
Expected: all green (existing + the new client/hook tests).

```bash
git add src/onchain/useBattle.ts src/onchain/useBattle.test.ts
git commit -m "feat(fe): useBattle polling hook (stops at terminal status)"
```

---

## Self-Review

**1. Spec coverage:**
- `packBattleClient` with all types + 6 functions, auth only on create/join/cancel, public reads, encodeURIComponent, mirrored wrapper → Task 1. ✓
- `useBattle` polling (stop at terminal, transient error keeps polling, id=null no-op, unmount cleanup) → Task 2. ✓
- Vitest tests for both → Tasks 1 & 2. ✓

**2. Placeholder scan:** No TBD/TODO; complete TS in every step; tests assert real behavior (URL/method/auth/body/error for the client; poll-then-stop, id-null, unmount for the hook).

**3. Type consistency:** `Battle`/`OpenBattle`/`Verification` and the 6 function signatures used in Task 2's import (`getBattle`, `Battle`, `BattleStatus`) match Task 1's exports. `OpenBattle.players` (count) vs `Battle.players` (array) kept distinct.

## No-goals
UI / routes / screens (#4b-2, #4b-3); client-side signing; WebSocket; a shared fetch-wrapper refactor.
