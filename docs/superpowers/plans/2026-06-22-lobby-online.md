# Lobby online (#4b-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Hub's `MOCK_BATTLES` with a live browser of real open battles (pack + royale) that can list, create, and join lobbies, gated by session-signer delegation, landing on a minimal waiting state after create/join.

**Architecture:** One minimal backend change (`list_open` returns `mode` + `buyin` per lobby). Frontend adds a polling hook (`useOpenBattles`), a pure `OpenBattle → LiveBattle` mapper, a reusable delegation gate, a create modal (reusing gacha machines), and a minimal waiting panel — wired into the existing presentational `LiveBattles`/`Hub`. The watch/reveal and result screens are out of scope (#4b-3).

**Tech Stack:** Backend FastAPI + SQLAlchemy (pytest, in-memory SQLite). Frontend React 19 + Vite + TypeScript, Privy auth, vitest + @testing-library/react. Inline-style components using the shared `theme.ts` tokens.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-22-lobby-online-design.md`.
- **Backend tests** run from `backend/` with `.venv/bin/pytest`. **Frontend tests** run from repo root with `npm test` (`vitest run`).
- **No new dependencies.** Reuse existing clients/hooks: `packBattleClient`, `gachaClient.fetchMachines`, `useDelegation`, `useBattle`, `useIdentityToken`, theme tokens (`COLORS`, `FONTS`, `GRADIENT`, `formatUsd`).
- **Mode values:** `'pack' | 'royale'` (`BattleMode`). Pack ⇒ `max_players = 2`; royale ⇒ `3 ≤ max_players ≤ 10` from our create UI (backend allows `2..10`).
- **Cost semantics:** pack cost = `price`; royale cost = `royale_buyin(max_players, price)` where `total_pulls(n) = n*(n+1)//2 - 1` and `royale_buyin = ceil(total_pulls(n) * price / n)`.
- **Secrecy:** lobby rows show NO real NFTs (placeholder card visuals only); `/open` only returns `status == "lobby"`.
- **Out of scope (do NOT build):** watch/reveal + result (#4b-3), reserved/available balance + cancel UI (#4c), PF verify panel (#4d), online mana lobbies, friendly machine names in rows.

---

### Task 1: Backend — `mode` + `buyin` in `list_open`

**Files:**
- Modify: `backend/app/services/pack_lobby.py` (function `list_open`, ~line 92; add import of `royale_buyin`)
- Test: `backend/tests/test_pack_lobby.py`

**Interfaces:**
- Consumes: `app.services.royale_funding.royale_buyin(n: int, price_base: int) -> int` (existing).
- Produces: `list_open(session)` returns `list[dict]` where each item is `{id, mode, machine_code, price, max_players, players, buyin}`. `buyin == price` for pack, `== royale_buyin(max_players, price)` for royale.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_pack_lobby.py`:

```python
def test_list_open_includes_mode_and_buyin(session):
    from app.services.royale_funding import royale_buyin
    create_battle(session, "WA", "wid-a", machine_code="pokemon_50",
                  price=50_000_000, max_players=2, mode="pack")
    create_battle(session, "WB", "wid-b", machine_code="pokemon_50",
                  price=50_000_000, max_players=4, mode="royale")
    rows = list_open(session)
    by_mode = {r["mode"]: r for r in rows}
    assert by_mode["pack"]["buyin"] == 50_000_000
    assert by_mode["royale"]["buyin"] == royale_buyin(4, 50_000_000)
    # base shape preserved
    assert set(by_mode["pack"]) == {
        "id", "mode", "machine_code", "price", "max_players", "players", "buyin"}
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `.venv/bin/pytest tests/test_pack_lobby.py::test_list_open_includes_mode_and_buyin -v`
Expected: FAIL with `KeyError: 'mode'` (or `'buyin'`).

- [ ] **Step 3: Write minimal implementation**

In `backend/app/services/pack_lobby.py`, add the import near the top (after the existing `from app.services.provably_fair ...` import):

```python
from app.services.royale_funding import royale_buyin
```

Replace `list_open` (current body at ~line 92):

```python
def list_open(session):
    out = []
    for b in session.query(PackBattle).filter_by(status="lobby").all():
        players = session.query(BattlePlayer).filter_by(battle_id=b.id).count()
        buyin = royale_buyin(b.max_players, b.price) if b.mode == "royale" else b.price
        out.append({"id": b.id, "mode": b.mode, "machine_code": b.machine_code,
                    "price": b.price, "max_players": b.max_players,
                    "players": players, "buyin": buyin})
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `backend/`): `.venv/bin/pytest tests/test_pack_lobby.py -v`
Expected: PASS (new test + existing pack_lobby tests).

Then run the API test that exercises `/open` to confirm no shape regression:
Run: `.venv/bin/pytest tests/test_pack_lobby_api.py::test_get_open_battles -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/pack_lobby.py backend/tests/test_pack_lobby.py
git commit -m "feat(be): list_open returns mode + buyin per lobby (#4b-2)"
```

---

### Task 2: Frontend data layer — `OpenBattle` type + `useOpenBattles` hook + carry-over

**Files:**
- Modify: `src/onchain/packBattleClient.ts` (the `OpenBattle` interface, ~line 23)
- Create: `src/onchain/useOpenBattles.ts`
- Create: `src/onchain/useOpenBattles.test.ts`
- Modify: `src/onchain/useBattle.test.ts` (carry-over: remove unused `waitFor` import, line 2)

**Interfaces:**
- Consumes: `listOpenBattles(): Promise<OpenBattle[]>` (existing), `BattleMode` (existing).
- Produces:
  - `OpenBattle = { id: string; mode: BattleMode; machine_code: string; price: number; max_players: number; players: number; buyin: number }`.
  - `useOpenBattles(intervalMs?: number): { battles: OpenBattle[]; loading: boolean; error: string | null }`.

- [ ] **Step 1: Extend the `OpenBattle` type**

In `src/onchain/packBattleClient.ts`, replace the `OpenBattle` interface:

```ts
export interface OpenBattle {
  id: string; mode: BattleMode; machine_code: string; price: number
  max_players: number; players: number; buyin: number
}
```

- [ ] **Step 2: Write the failing test**

Create `src/onchain/useOpenBattles.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('./packBattleClient', () => ({ listOpenBattles: vi.fn() }))
import { listOpenBattles } from './packBattleClient'
import { useOpenBattles } from './useOpenBattles'

const mockList = listOpenBattles as unknown as ReturnType<typeof vi.fn>
const ROW = { id: 'b1', mode: 'pack', machine_code: 'pokemon_50', price: 50, max_players: 2, players: 1, buyin: 50 }

describe('useOpenBattles', () => {
  beforeEach(() => { vi.useFakeTimers(); mockList.mockReset() })
  afterEach(() => { vi.useRealTimers() })

  it('polls on the interval and exposes the battles', async () => {
    mockList.mockResolvedValue([ROW])
    const { result } = renderHook(() => useOpenBattles(1000))
    await vi.advanceTimersByTimeAsync(0)      // immediate poll
    expect(result.current.battles).toEqual([ROW])
    await vi.advanceTimersByTimeAsync(1000)   // second poll
    expect(mockList).toHaveBeenCalledTimes(2)
  })

  it('surfaces errors but keeps polling', async () => {
    mockList.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([ROW])
    const { result } = renderHook(() => useOpenBattles(1000))
    await vi.advanceTimersByTimeAsync(0)
    expect(result.current.error).toBe('boom')
    await vi.advanceTimersByTimeAsync(1000)
    expect(result.current.error).toBeNull()
    expect(result.current.battles).toEqual([ROW])
  })

  it('stops polling after unmount', async () => {
    mockList.mockResolvedValue([ROW])
    const { unmount } = renderHook(() => useOpenBattles(1000))
    await vi.advanceTimersByTimeAsync(0)
    const before = mockList.mock.calls.length
    unmount()
    await vi.advanceTimersByTimeAsync(5000)
    expect(mockList.mock.calls.length).toBe(before)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run (from repo root): `npm test -- useOpenBattles`
Expected: FAIL with "Cannot find module './useOpenBattles'" (file not created yet).

- [ ] **Step 4: Write minimal implementation**

Create `src/onchain/useOpenBattles.ts` (mirrors `useBattle.ts`):

```ts
import { useEffect, useState } from 'react'
import { listOpenBattles, type OpenBattle } from './packBattleClient'

export function useOpenBattles(intervalMs = 3000): {
  battles: OpenBattle[]; loading: boolean; error: string | null
} {
  const [battles, setBattles] = useState<OpenBattle[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const poll = async () => {
      try {
        const rows = await listOpenBattles()
        if (cancelled) return
        setBattles(rows)
        setError(null)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))   // transient → keep polling
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    poll()
    const timer = setInterval(poll, intervalMs)
    return () => { cancelled = true; clearInterval(timer) }
  }, [intervalMs])

  return { battles, loading, error }
}
```

- [ ] **Step 5: Remove the carry-over unused import**

In `src/onchain/useBattle.test.ts` line 2, change:

```ts
import { renderHook, waitFor } from '@testing-library/react'
```

to:

```ts
import { renderHook } from '@testing-library/react'
```

- [ ] **Step 6: Run tests to verify they pass**

Run (from repo root): `npm test -- useOpenBattles useBattle`
Expected: PASS for both files. Also run `npx tsc --noEmit` (or `npm run build` if that is the typecheck) to confirm the `OpenBattle` type change compiles.

- [ ] **Step 7: Commit**

```bash
git add src/onchain/packBattleClient.ts src/onchain/useOpenBattles.ts src/onchain/useOpenBattles.test.ts src/onchain/useBattle.test.ts
git commit -m "feat(fe): useOpenBattles polling hook + OpenBattle mode/buyin (#4b-2)"
```

---

### Task 3: `openBattleToLive` mapper

**Files:**
- Create: `src/ui/screens/Hub/openBattleToLive.ts`
- Create: `src/ui/screens/Hub/openBattleToLive.test.ts`

**Interfaces:**
- Consumes: `OpenBattle` (Task 2), `LiveBattle` + `BattleMode` from `./hubMockData`.
- Produces: `openBattleToLive(b: OpenBattle): LiveBattle`.

Note: `LiveBattle.mode` is `'pack' | 'royale' | 'mana'`; `OpenBattle.mode` is `'pack' | 'royale'` — assignable. `LiveBattle.players` is `{ violet: boolean }[]`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/screens/Hub/openBattleToLive.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { openBattleToLive } from './openBattleToLive'
import type { OpenBattle } from '../../../onchain/packBattleClient'

const base: OpenBattle = {
  id: 'b1', mode: 'pack', machine_code: 'pokemon_50',
  price: 50, max_players: 2, players: 1, buyin: 50,
}

describe('openBattleToLive', () => {
  it('maps a pack lobby with an open seat to a joinable row', () => {
    const r = openBattleToLive(base)
    expect(r.id).toBe('b1')
    expect(r.mode).toBe('pack')
    expect(r.title).toBe('pokemon_50')
    expect(r.sub).toBe('1/2 joined')
    expect(r.costLabel).toBe('BUY-IN')
    expect(r.costValue).toBe(50)
    expect(r.action).toBe('join')
    expect(r.players).toHaveLength(1)
    expect(r.live).toBe(false)
  })

  it('marks a full lobby as watch and uses royale ENTRY label + buyin', () => {
    const r = openBattleToLive({ ...base, mode: 'royale', max_players: 4, players: 4, buyin: 113 })
    expect(r.action).toBe('watch')
    expect(r.costLabel).toBe('ENTRY')
    expect(r.costValue).toBe(113)
    expect(r.sub).toBe('4/4 joined')
  })

  it('caps avatars and shows +N for large player counts', () => {
    const r = openBattleToLive({ ...base, mode: 'royale', max_players: 10, players: 7, buyin: 200 })
    expect(r.players).toHaveLength(4)
    expect(r.extra).toBe('+3')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from repo root): `npm test -- openBattleToLive`
Expected: FAIL with "Cannot find module './openBattleToLive'".

- [ ] **Step 3: Write minimal implementation**

Create `src/ui/screens/Hub/openBattleToLive.ts`:

```ts
import type { OpenBattle } from '../../../onchain/packBattleClient'
import type { LiveBattle } from './hubMockData'

const MAX_AVATARS = 4

// Maps a real open lobby to the presentational LiveBattle row shape.
// NOTE: secrecy — rows carry NO real NFTs; `cards` is a static teaser.
export function openBattleToLive(b: OpenBattle): LiveBattle {
  const shown = Math.min(b.players, MAX_AVATARS)
  const players = Array.from({ length: shown }, (_, i) => ({ violet: i % 2 === 1 }))
  const extra = b.players > MAX_AVATARS ? `+${b.players - MAX_AVATARS}` : undefined
  return {
    id: b.id,
    mode: b.mode,
    live: false,
    title: b.machine_code,
    sub: `${b.players}/${b.max_players} joined`,
    players,
    extra,
    cards: b.mode === 'royale' ? ['🎴'] : ['🔥', '💧'],
    costLabel: b.mode === 'royale' ? 'ENTRY' : 'BUY-IN',
    costValue: b.buyin,
    action: b.players < b.max_players ? 'join' : 'watch',
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from repo root): `npm test -- openBattleToLive`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/Hub/openBattleToLive.ts src/ui/screens/Hub/openBattleToLive.test.ts
git commit -m "feat(fe): openBattleToLive mapper (OpenBattle -> LiveBattle row) (#4b-2)"
```

---

### Task 4: Delegation gate (`useDelegationGate` + `DelegationGate` modal)

**Files:**
- Create: `src/ui/components/useDelegationGate.ts`
- Create: `src/ui/components/useDelegationGate.test.ts`
- Create: `src/ui/components/DelegationGate.tsx`

**Interfaces:**
- Consumes: `useDelegation(): { delegated: boolean; enable: () => Promise<void> }` from `../../wallet/useDelegation`.
- Produces:
  - `useDelegationGate(): { requireDelegation: (action: () => void) => void; open: boolean; busy: boolean; error: string | null; confirm: () => Promise<void>; cancel: () => void }`.
  - `DelegationGate({ gate }: { gate: ReturnType<typeof useDelegationGate> }): JSX.Element | null`.

Behavior: `requireDelegation(action)` runs `action()` immediately if already delegated; otherwise stashes it and sets `open = true`. `confirm()` calls `enable()`, then (on success) runs the stashed action and closes; on failure sets `error` and keeps the gate open. `cancel()` drops the stashed action and closes.

- [ ] **Step 1: Write the failing test**

Create `src/ui/components/useDelegationGate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const enable = vi.fn()
let delegated = false
vi.mock('../../wallet/useDelegation', () => ({
  useDelegation: () => ({ delegated, enable }),
}))
import { useDelegationGate } from './useDelegationGate'

describe('useDelegationGate', () => {
  beforeEach(() => { delegated = false; enable.mockReset() })

  it('runs the action immediately when already delegated', () => {
    delegated = true
    const action = vi.fn()
    const { result } = renderHook(() => useDelegationGate())
    act(() => result.current.requireDelegation(action))
    expect(action).toHaveBeenCalledTimes(1)
    expect(result.current.open).toBe(false)
  })

  it('opens the gate when not delegated, runs action after a successful enable', async () => {
    enable.mockResolvedValue(undefined)
    const action = vi.fn()
    const { result } = renderHook(() => useDelegationGate())
    act(() => result.current.requireDelegation(action))
    expect(action).not.toHaveBeenCalled()
    expect(result.current.open).toBe(true)
    await act(async () => { await result.current.confirm() })
    expect(enable).toHaveBeenCalledTimes(1)
    expect(action).toHaveBeenCalledTimes(1)
    expect(result.current.open).toBe(false)
  })

  it('keeps the gate open and surfaces the error when enable fails', async () => {
    enable.mockRejectedValue(new Error('no signer'))
    const action = vi.fn()
    const { result } = renderHook(() => useDelegationGate())
    act(() => result.current.requireDelegation(action))
    await act(async () => { await result.current.confirm() })
    expect(action).not.toHaveBeenCalled()
    expect(result.current.open).toBe(true)
    expect(result.current.error).toBe('no signer')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from repo root): `npm test -- useDelegationGate`
Expected: FAIL with "Cannot find module './useDelegationGate'".

- [ ] **Step 3: Write minimal implementation**

Create `src/ui/components/useDelegationGate.ts`:

```ts
import { useState } from 'react'
import { useDelegation } from '../../wallet/useDelegation'

export function useDelegationGate() {
  const { delegated, enable } = useDelegation()
  const [pending, setPending] = useState<(() => void) | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function requireDelegation(action: () => void) {
    if (delegated) { action(); return }
    setError(null)
    setPending(() => action)   // store the fn (useState treats a fn arg as an updater)
  }

  async function confirm() {
    if (!pending) return
    setBusy(true); setError(null)
    try {
      await enable()
      const action = pending
      setPending(null)
      action()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function cancel() { setPending(null); setError(null) }

  return { requireDelegation, open: pending !== null, busy, error, confirm, cancel }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from repo root): `npm test -- useDelegationGate`
Expected: PASS.

- [ ] **Step 5: Write the modal component**

Create `src/ui/components/DelegationGate.tsx` (presentational; styled like `DelegationPanel`):

```tsx
import { COLORS, FONTS } from '../theme'
import type { useDelegationGate } from './useDelegationGate'

export function DelegationGate({ gate }: { gate: ReturnType<typeof useDelegationGate> }) {
  if (!gate.open) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={gate.cancel}
      style={{
        position: 'fixed', inset: 0, background: '#000000aa', zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.panel, border: `1px solid ${COLORS.border}`,
          borderRadius: 14, padding: 22, maxWidth: 380, width: '100%',
        }}
      >
        <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 16, color: COLORS.text, marginBottom: 8 }}>
          Habilitar firma de batalla
        </div>
        <div style={{ fontSize: 12.5, color: COLORS.muted, lineHeight: 1.5, marginBottom: 16 }}>
          Para crear o unirte a una batalla, concede acceso de firma (session signer) para que las
          tiradas se ejecuten en el servidor sin pop-ups. Puedes revocarlo cuando quieras en Privy.
        </div>
        {gate.error && (
          <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.red, marginBottom: 12, wordBreak: 'break-word' }}>
            ERROR: {gate.error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={gate.cancel}
            disabled={gate.busy}
            style={{
              background: 'transparent', color: COLORS.muted,
              border: `1px solid ${COLORS.border}`, borderRadius: 10,
              padding: '10px 16px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            Cancelar
          </button>
          <button
            onClick={() => void gate.confirm()}
            disabled={gate.busy}
            style={{
              background: gate.busy ? COLORS.panel2 : COLORS.green,
              color: gate.busy ? COLORS.muted : '#03110a',
              border: 'none', borderRadius: 10, padding: '10px 18px',
              fontWeight: 800, fontFamily: FONTS.display,
              cursor: gate.busy ? 'wait' : 'pointer',
            }}
          >
            {gate.busy ? 'Concediendo…' : 'Habilitar'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Typecheck and run tests**

Run (from repo root): `npm test -- useDelegationGate` then `npx tsc --noEmit`
Expected: tests PASS; no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/ui/components/useDelegationGate.ts src/ui/components/useDelegationGate.test.ts src/ui/components/DelegationGate.tsx
git commit -m "feat(fe): delegation gate (hook + modal) for join/create (#4b-2)"
```

---

### Task 5: `CreateBattleModal`

**Files:**
- Create: `src/ui/screens/Hub/createBattleBody.ts`
- Create: `src/ui/screens/Hub/createBattleBody.test.ts`
- Create: `src/ui/screens/Hub/CreateBattleModal.tsx`

**Interfaces:**
- Consumes: `BattleMode` from `../../../onchain/packBattleClient`; `fetchMachines(): Promise<GachaMachine[]>` (`GachaMachine{code, name, price, ...}`) from `../../../onchain/gachaClient`; `createBattle(token, body)`; `useIdentityToken()`; `useDelegationGate`/`DelegationGate`.
- Produces:
  - `buildCreateBody(mode: BattleMode, machineCode: string, royalePlayers: number): { machine_code: string; max_players: number; mode: BattleMode }`.
  - `CreateBattleModal({ onClose, onCreated }: { onClose: () => void; onCreated: (battleId: string) => void }): JSX.Element`.

- [ ] **Step 1: Write the failing test (pure body builder)**

Create `src/ui/screens/Hub/createBattleBody.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildCreateBody } from './createBattleBody'

describe('buildCreateBody', () => {
  it('forces max_players=2 for pack regardless of the royale count', () => {
    expect(buildCreateBody('pack', 'pokemon_50', 8)).toEqual({
      machine_code: 'pokemon_50', max_players: 2, mode: 'pack',
    })
  })

  it('uses the chosen player count for royale', () => {
    expect(buildCreateBody('royale', 'pokemon_50', 6)).toEqual({
      machine_code: 'pokemon_50', max_players: 6, mode: 'royale',
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from repo root): `npm test -- createBattleBody`
Expected: FAIL with "Cannot find module './createBattleBody'".

- [ ] **Step 3: Write the pure body builder**

Create `src/ui/screens/Hub/createBattleBody.ts`:

```ts
import type { BattleMode } from '../../../onchain/packBattleClient'

export function buildCreateBody(
  mode: BattleMode, machineCode: string, royalePlayers: number,
): { machine_code: string; max_players: number; mode: BattleMode } {
  return { machine_code: machineCode, mode, max_players: mode === 'pack' ? 2 : royalePlayers }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from repo root): `npm test -- createBattleBody`
Expected: PASS.

- [ ] **Step 5: Write the modal component**

Create `src/ui/screens/Hub/CreateBattleModal.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS } from '../../theme'
import { fetchMachines, type GachaMachine } from '../../../onchain/gachaClient'
import { createBattle, type BattleMode } from '../../../onchain/packBattleClient'
import { buildCreateBody } from './createBattleBody'
import { useDelegationGate } from '../../components/useDelegationGate'
import { DelegationGate } from '../../components/DelegationGate'

const ROYALE_COUNTS = [3, 4, 5, 6, 8, 10]

export function CreateBattleModal({ onClose, onCreated }: {
  onClose: () => void; onCreated: (battleId: string) => void
}) {
  const { identityToken } = useIdentityToken()
  const gate = useDelegationGate()
  const [machines, setMachines] = useState<GachaMachine[]>([])
  const [machineCode, setMachineCode] = useState<string>('')
  const [mode, setMode] = useState<BattleMode>('pack')
  const [players, setPlayers] = useState(4)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchMachines()
      .then((m) => { if (!cancelled) { setMachines(m); setMachineCode((c) => c || m[0]?.code || '') } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [])

  function submit() {
    if (!identityToken || !machineCode) return
    gate.requireDelegation(async () => {
      setBusy(true); setError(null)
      try {
        const body = buildCreateBody(mode, machineCode, players)
        const b = await createBattle(identityToken, body)
        onCreated(b.id)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    })
  }

  return (
    <div
      role="dialog" aria-modal="true" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: '#000000aa', zIndex: 40,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`,
          borderRadius: 14, padding: 22, maxWidth: 420, width: '100%' }}
      >
        <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 17, color: COLORS.text, marginBottom: 14 }}>
          Crear batalla
        </div>

        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {(['pack', 'royale'] as BattleMode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              style={{ flex: 1, padding: '10px 0', borderRadius: 10, cursor: 'pointer',
                fontWeight: 700, fontFamily: FONTS.display,
                background: mode === m ? 'linear-gradient(90deg,#9945FF33,#14F19522)' : '#0c1019',
                color: mode === m ? COLORS.text : COLORS.muted,
                border: `1px solid ${mode === m ? '#9945FF44' : COLORS.border}` }}>
              {m === 'pack' ? 'Pack · 1v1' : 'Royale'}
            </button>
          ))}
        </div>

        {/* Machine picker */}
        <label style={{ fontSize: 11, color: COLORS.muted }}>Machine</label>
        <select value={machineCode} onChange={(e) => setMachineCode(e.target.value)}
          style={{ width: '100%', margin: '6px 0 14px', padding: '10px',
            background: '#0c1019', color: COLORS.text, border: `1px solid ${COLORS.border}`, borderRadius: 10 }}>
          {machines.map((m) => (
            <option key={m.code} value={m.code}>{m.name} · ${m.price}</option>
          ))}
        </select>

        {/* Royale player count */}
        {mode === 'royale' && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: COLORS.muted }}>Jugadores</label>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {ROYALE_COUNTS.map((n) => (
                <button key={n} onClick={() => setPlayers(n)}
                  style={{ width: 44, padding: '8px 0', borderRadius: 9, cursor: 'pointer',
                    background: players === n ? COLORS.green : '#0c1019',
                    color: players === n ? '#03110a' : COLORS.muted,
                    border: `1px solid ${COLORS.border}`, fontWeight: 700 }}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.red, marginBottom: 12, wordBreak: 'break-word' }}>
            ERROR: {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={busy}
            style={{ background: 'transparent', color: COLORS.muted, border: `1px solid ${COLORS.border}`,
              borderRadius: 10, padding: '10px 16px', fontWeight: 600, cursor: 'pointer' }}>
            Cancelar
          </button>
          <button onClick={submit} disabled={busy || !identityToken || !machineCode}
            style={{ background: busy ? COLORS.panel2 : COLORS.green, color: busy ? COLORS.muted : '#03110a',
              border: 'none', borderRadius: 10, padding: '10px 18px', fontWeight: 800,
              fontFamily: FONTS.display, cursor: busy ? 'wait' : 'pointer' }}>
            {busy ? 'Creando…' : 'Crear'}
          </button>
        </div>
      </div>
      <DelegationGate gate={gate} />
    </div>
  )
}
```

- [ ] **Step 6: Typecheck and run tests**

Run (from repo root): `npm test -- createBattleBody` then `npx tsc --noEmit`
Expected: tests PASS; no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/ui/screens/Hub/createBattleBody.ts src/ui/screens/Hub/createBattleBody.test.ts src/ui/screens/Hub/CreateBattleModal.tsx
git commit -m "feat(fe): CreateBattleModal (machine + mode + players) (#4b-2)"
```

---

### Task 6: `BattleWaiting` minimal panel

**Files:**
- Create: `src/ui/screens/Hub/BattleWaiting.tsx`
- Create: `src/ui/screens/Hub/BattleWaiting.test.tsx`

**Interfaces:**
- Consumes: `useBattle(id, intervalMs?)` from `../../../onchain/useBattle` (returns `{ battle, loading, error }`).
- Produces: `BattleWaiting({ battleId, onClose }: { battleId: string; onClose: () => void }): JSX.Element`.

Behavior: while `battle.status === 'lobby'` show "Esperando jugadores — X/Y". Once status leaves `lobby`, show the #4b-3 placeholder ("La batalla empezó — vista completa próximamente"). No reveal/board/result.

- [ ] **Step 1: Write the failing test**

Create `src/ui/screens/Hub/BattleWaiting.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../onchain/useBattle', () => ({ useBattle: vi.fn() }))
import { useBattle } from '../../../onchain/useBattle'
import { BattleWaiting } from './BattleWaiting'

const mockUseBattle = useBattle as unknown as ReturnType<typeof vi.fn>

describe('BattleWaiting', () => {
  it('shows a waiting room while in lobby', () => {
    mockUseBattle.mockReturnValue({
      battle: { id: 'b1', status: 'lobby', max_players: 4, players: [{}, {}] },
      loading: false, error: null,
    })
    render(<BattleWaiting battleId="b1" onClose={() => {}} />)
    expect(screen.getByText(/2\/4/)).toBeTruthy()
    expect(screen.getByText(/[Ee]sperando/)).toBeTruthy()
  })

  it('shows the started placeholder once running', () => {
    mockUseBattle.mockReturnValue({
      battle: { id: 'b1', status: 'running', max_players: 4, players: [{}, {}, {}, {}] },
      loading: false, error: null,
    })
    render(<BattleWaiting battleId="b1" onClose={() => {}} />)
    expect(screen.getByText(/empez/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from repo root): `npm test -- BattleWaiting`
Expected: FAIL with "Cannot find module './BattleWaiting'".

- [ ] **Step 3: Write minimal implementation**

Create `src/ui/screens/Hub/BattleWaiting.tsx`:

```tsx
import { COLORS, FONTS } from '../../theme'
import { useBattle } from '../../../onchain/useBattle'

export function BattleWaiting({ battleId, onClose }: { battleId: string; onClose: () => void }) {
  const { battle, error } = useBattle(battleId)
  const inLobby = !battle || battle.status === 'lobby'
  const joined = battle ? battle.players.length : 0
  const max = battle ? battle.max_players : 0

  return (
    <div
      role="dialog" aria-modal="true" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: '#000000aa', zIndex: 40,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`,
          borderRadius: 14, padding: 26, maxWidth: 380, width: '100%', textAlign: 'center' }}
      >
        {inLobby ? (
          <>
            <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 17, color: COLORS.text }}>
              Esperando jugadores
            </div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 26, color: COLORS.green, margin: '14px 0' }}>
              {joined}/{max}
            </div>
          </>
        ) : (
          <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 16, color: COLORS.text, lineHeight: 1.5 }}>
            La batalla empezó 🎴
            <div style={{ fontFamily: FONTS.body, fontWeight: 400, fontSize: 12.5, color: COLORS.muted, marginTop: 8 }}>
              Vista completa próximamente (#4b-3).
            </div>
          </div>
        )}
        {error && (
          <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.muted, marginTop: 8 }}>
            reintentando…
          </div>
        )}
        <button onClick={onClose}
          style={{ marginTop: 18, background: '#0c1019', color: COLORS.text,
            border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '10px 20px',
            fontWeight: 700, cursor: 'pointer' }}>
          Volver
        </button>
      </div>
    </div>
  )
}
```

NOTE: `FONTS` exports `display`, `mono`, and `body` (confirmed in `src/ui/theme.ts`), so `FONTS.body` above is valid.

- [ ] **Step 4: Run test to verify it passes**

Run (from repo root): `npm test -- BattleWaiting`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/Hub/BattleWaiting.tsx src/ui/screens/Hub/BattleWaiting.test.tsx
git commit -m "feat(fe): minimal BattleWaiting panel (lobby + started placeholder) (#4b-2)"
```

---

### Task 7: Wire the Hub to real lobbies

**Files:**
- Modify: `src/ui/screens/Hub/Hub.tsx`
- Modify: `src/ui/screens/Hub/hubMockData.ts` (remove `MOCK_BATTLES` and the now-unused `LiveBattle` mana entry; keep `MOCK_DROPS`/`MOCK_CHAT`/`MOCK_STATS`/`NAV_ITEMS`/`STAKE_OPTIONS`)
- Modify: `src/ui/screens/Hub/LiveBattles.tsx` (drop the `MOCK_BATTLES` default import; require `battles` as a prop)

**Interfaces:**
- Consumes: `useOpenBattles` (Task 2), `openBattleToLive` (Task 3), `useDelegationGate`/`DelegationGate` (Task 4), `CreateBattleModal` (Task 5), `BattleWaiting` (Task 6), `joinBattle` + `useIdentityToken`.
- Produces: a Hub that lists real lobbies and routes Join/Watch/Create through the gate + modals. No new exported API.

- [ ] **Step 1: Remove `MOCK_BATTLES` and the `LiveBattle` mana usage**

In `src/ui/screens/Hub/hubMockData.ts`, delete the `MOCK_BATTLES` constant (lines ~28-32). Keep the `LiveBattle` and `BattleMode` type exports (the mapper and `LiveBattles` still use them). Update the `MOCK_STATS` "Live battles" value if it referenced a fixed count — leave the other mocks intact.

- [ ] **Step 2: Make `LiveBattles` require real battles**

In `src/ui/screens/Hub/LiveBattles.tsx`:
- Change the import `import { MOCK_BATTLES, type LiveBattle, type BattleMode } from './hubMockData'` to `import type { LiveBattle, BattleMode } from './hubMockData'`.
- Change the prop signature `battles?: LiveBattle[]` → `battles: LiveBattle[]` and the destructure `{ battles = MOCK_BATTLES, ... }` → `{ battles, ... }`.

- [ ] **Step 3: Wire `Hub.tsx`**

Replace `src/ui/screens/Hub/Hub.tsx` with:

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS } from '../../theme'
import type { HubNav } from './hubMockData'
import { STAKE_OPTIONS } from './hubMockData'
import { QuickMatch } from './QuickMatch'
import { LiveBattles } from './LiveBattles'
import { useOpenBattles } from '../../../onchain/useOpenBattles'
import { openBattleToLive } from './openBattleToLive'
import { joinBattle } from '../../../onchain/packBattleClient'
import { useDelegationGate } from '../../components/useDelegationGate'
import { DelegationGate } from '../../components/DelegationGate'
import { CreateBattleModal } from './CreateBattleModal'
import { BattleWaiting } from './BattleWaiting'

export function Hub() {
  const navigate = useNavigate()
  const { identityToken } = useIdentityToken()
  const [stake, setStake] = useState<number>(STAKE_OPTIONS[1])
  const { battles } = useOpenBattles()
  const gate = useDelegationGate()
  const [waitingId, setWaitingId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const liveBattles = battles.map(openBattleToLive)

  function go(id: HubNav) {
    if (id === 'mana')   return navigate('/play/mana')
    if (id === 'royale') return navigate('/play/royale')
    if (id === 'pack')   return navigate('/play/arena')
    if (id === 'gacha')  return navigate('/play/gacha')
  }

  function onBattleAction(b: { id: string; action: 'watch' | 'join' }) {
    setActionError(null)
    if (b.action === 'watch') { setWaitingId(b.id); return }
    if (!identityToken) { setActionError('Inicia sesión para unirte.'); return }
    gate.requireDelegation(async () => {
      try {
        await joinBattle(identityToken, b.id)
        setWaitingId(b.id)
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 16px',
        borderBottom: `1px solid ${COLORS.border}` }}>
        <div>
          <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 20,
            letterSpacing: '-0.01em', color: COLORS.text }}>Lobby</span>
          <span style={{ color: COLORS.muted, fontWeight: 500, fontSize: 13, marginLeft: 10 }}>
            · {liveBattles.length} lobbies abiertos
          </span>
        </div>
      </div>
      <div style={{ padding: '24px 16px 40px' }}>
        <QuickMatch
          selectedStake={stake}
          onStake={setStake}
          onFindMatch={() => setCreateOpen(true)}
          onCreate={() => setCreateOpen(true)}
        />
        {actionError && (
          <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.red, margin: '0 0 12px' }}>
            {actionError}
          </div>
        )}
        <LiveBattles battles={liveBattles} onSelectMode={go} onBattleAction={onBattleAction} />
      </div>

      <DelegationGate gate={gate} />
      {createOpen && (
        <CreateBattleModal
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => { setCreateOpen(false); setWaitingId(id) }}
        />
      )}
      {waitingId && <BattleWaiting battleId={waitingId} onClose={() => setWaitingId(null)} />}
    </div>
  )
}
```

NOTE: `LiveBattles`' `onBattleAction` is typed `(b: LiveBattle) => void`; `LiveBattle` has `id` and `action: 'watch' | 'join'`, so passing it to `onBattleAction` above is type-compatible. If `tsc` complains about the narrowed param type, widen the `onBattleAction` param to `(b: LiveBattle)` and read `b.id`/`b.action`.

- [ ] **Step 4: Typecheck and run the full frontend suite**

Run (from repo root): `npx tsc --noEmit` then `npm test`
Expected: no type errors; all tests PASS (existing 136 + the new files). Confirm no test still imports `MOCK_BATTLES`.

- [ ] **Step 5: Manual smoke (optional but recommended)**

With backend (`:9090`) and frontend (`:5173`) running per `docs/STARTUP.md`: open `/app`, confirm the lobby list reflects `GET /pack-battles/open` (empty or real rows), the Create button opens the modal, and Join triggers the delegation gate when not delegated.

- [ ] **Step 6: Commit**

```bash
git add src/ui/screens/Hub/Hub.tsx src/ui/screens/Hub/LiveBattles.tsx src/ui/screens/Hub/hubMockData.ts
git commit -m "feat(fe): Hub wired to real lobbies (browse/join/create) (#4b-2)"
```

---

## Final whole-branch review

After Task 7, run the full backend + frontend suites once more (`backend/`: `.venv/bin/pytest`; root: `npm test`) and request a whole-branch review before merging to `master`. Update `.superpowers/sdd/progress.md` with the #4b-2 sub-project entry (per-task commit ranges + review notes), following the existing ledger format. Carry-over to #4b-3: the `BattleWaiting` started-placeholder is where the real watch/reveal + result UI lands.
