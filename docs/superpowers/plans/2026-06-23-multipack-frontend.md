# Pack battle multi-pack — frontend create UI (#4e-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In `CreateBattleModal`, make Pack mode a bundle builder (a `−/+` stepper per machine, ≤10 boxes, running cost) that sends `packs: [{machine_code, count}]`; Royale stays single-machine.

**Architecture:** Pure helpers (`bundleToPacks`/`totalBoxes`/`bundleCostUsd`) compute the bundle and totals; the `createBattle` client gains an optional `packs` body; `CreateBattleModal` renders the stepper list for pack mode and branches submit on mode. Frontend-only — the backend (#4e-1) already accepts the bundle.

**Tech Stack:** React 19 + Vite + TypeScript, vitest + @testing-library/react (jsdom).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-23-multipack-frontend-design.md`.
- **Frontend tests** run from repo root with `npm test`; typecheck `npx tsc --noEmit`.
- **No new dependencies.** Reuse `fetchMachines`/`GachaMachine` (`src/onchain/gachaClient.ts`), `createBattle` (`src/onchain/packBattleClient.ts`), theme `formatUsd`/`COLORS`/`FONTS`, the existing `useDelegationGate`/`DelegationGate`.
- **Bundle:** 1–10 boxes (`MAX_BOXES = 10`). `packs` carries only machines with `count > 0`. Cost shown is `Σ(machine.price × count)` in USD (approx; the backend reserves the true total).
- **Machine prices** from `GachaMachine.price` are in **USD** (not base units).
- **Only `available !== false` machines** are steppable.
- **Royale unchanged** (single-machine `<select>` + `buildCreateBody('royale', ...)`).
- **Out of scope (do NOT build):** backend (done #4e-1); royale changes; the reveal; per-machine odds/EV in the builder; exact base-unit cost.

---

### Task 1: Bundle helpers + `createBattle` accepts `packs`

**Files:**
- Modify: `src/ui/screens/Hub/createBattleBody.ts` (add helpers)
- Modify: `src/ui/screens/Hub/createBattleBody.test.ts` (add helper tests)
- Modify: `src/onchain/packBattleClient.ts` (`createBattle` body type)

**Interfaces:**
- Consumes: `GachaMachine` (`src/onchain/gachaClient.ts`).
- Produces:
  - `bundleToPacks(counts: Record<string, number>): { machine_code: string; count: number }[]`.
  - `totalBoxes(counts: Record<string, number>): number`.
  - `bundleCostUsd(counts: Record<string, number>, machines: GachaMachine[]): number`.
  - `createBattle(token, body: { machine_code?: string; max_players: number; mode?: BattleMode; packs?: { machine_code: string; count: number }[] })`.

- [ ] **Step 1: Write the failing tests**

Add to `src/ui/screens/Hub/createBattleBody.test.ts` (keep the existing `buildCreateBody` tests):

```ts
import { bundleToPacks, totalBoxes, bundleCostUsd } from './createBattleBody'
import type { GachaMachine } from '../../../onchain/gachaClient'

const M = (code: string, price: number): GachaMachine => ({
  code, name: code, price, odds: {}, stock: {}, ev: null, image: null,
})

describe('bundle helpers', () => {
  it('bundleToPacks keeps only count>0, in key order', () => {
    expect(bundleToPacks({ a: 2, b: 0, c: 1 })).toEqual([
      { machine_code: 'a', count: 2 }, { machine_code: 'c', count: 1 }])
    expect(bundleToPacks({})).toEqual([])
  })

  it('totalBoxes sums the counts', () => {
    expect(totalBoxes({ a: 2, b: 0, c: 1 })).toBe(3)
    expect(totalBoxes({})).toBe(0)
  })

  it('bundleCostUsd sums price*count; unknown machine contributes 0', () => {
    const machines = [M('m25', 25), M('m50', 50)]
    expect(bundleCostUsd({ m25: 1, m50: 2 }, machines)).toBe(125)
    expect(bundleCostUsd({ ghost: 3 }, machines)).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- createBattleBody`
Expected: FAIL — `bundleToPacks`/`totalBoxes`/`bundleCostUsd` not exported.

- [ ] **Step 3: Implement the helpers**

In `src/ui/screens/Hub/createBattleBody.ts`, add the import and the three helpers (keep `buildCreateBody`):

```ts
import type { GachaMachine } from '../../../onchain/gachaClient'

export function bundleToPacks(counts: Record<string, number>): { machine_code: string; count: number }[] {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([machine_code, count]) => ({ machine_code, count }))
}

export function totalBoxes(counts: Record<string, number>): number {
  return Object.values(counts).reduce((s, n) => s + n, 0)
}

export function bundleCostUsd(counts: Record<string, number>, machines: GachaMachine[]): number {
  const price = new Map(machines.map((m) => [m.code, m.price]))
  return Object.entries(counts).reduce((s, [code, n]) => s + (price.get(code) ?? 0) * n, 0)
}
```

- [ ] **Step 4: Extend the `createBattle` body type**

In `src/onchain/packBattleClient.ts`, change `createBattle`'s `body` type (additive — `machine_code` becomes optional, add `packs`):

```ts
export function createBattle(
  token: string,
  body: { machine_code?: string; max_players: number; mode?: BattleMode
          packs?: { machine_code: string; count: number }[] },
): Promise<Battle> {
  return battleFetch<Battle>('/pack-battles', {
    method: 'POST', headers: authHeaders(token), body: JSON.stringify(body),
  })
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -- createBattleBody` then `npx tsc --noEmit`
Expected: tests PASS (helpers + existing `buildCreateBody`); tsc clean (the existing `CreateBattleModal` still compiles — its current `buildCreateBody` body is assignable to the widened `createBattle` type).

- [ ] **Step 6: Commit**

```bash
git add src/ui/screens/Hub/createBattleBody.ts src/ui/screens/Hub/createBattleBody.test.ts src/onchain/packBattleClient.ts
git commit -m "feat(fe): bundle helpers + createBattle accepts packs (#4e-2)"
```

---

### Task 2: `CreateBattleModal` bundle builder (pack mode)

**Files:**
- Modify: `src/ui/screens/Hub/CreateBattleModal.tsx`
- Create: `src/ui/screens/Hub/CreateBattleModal.test.tsx`

**Interfaces:**
- Consumes: `bundleToPacks`/`totalBoxes`/`bundleCostUsd` (Task 1), `createBattle` (Task 1), `fetchMachines`/`GachaMachine`, `formatUsd`, `useDelegationGate`/`DelegationGate`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/screens/Hub/CreateBattleModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@privy-io/react-auth', () => ({ useIdentityToken: () => ({ identityToken: 'tok' }) }))
vi.mock('../../components/useDelegationGate', () => ({
  useDelegationGate: () => ({ requireDelegation: (fn: () => void) => fn(), open: false, busy: false, error: null, confirm: () => {}, cancel: () => {} }),
}))
vi.mock('../../components/DelegationGate', () => ({ DelegationGate: () => null }))
vi.mock('../../../onchain/gachaClient', () => ({
  fetchMachines: vi.fn().mockResolvedValue([
    { code: 'm25', name: 'PKMN 25', price: 25, odds: {}, stock: {}, ev: null, image: null, available: true },
    { code: 'm50', name: 'PKMN 50', price: 50, odds: {}, stock: {}, ev: null, image: null, available: true },
  ]),
}))
vi.mock('../../../onchain/packBattleClient', () => ({ createBattle: vi.fn().mockResolvedValue({ id: 'b1' }) }))
import { createBattle } from '../../../onchain/packBattleClient'
import { CreateBattleModal } from './CreateBattleModal'

const plusButtons = () => screen.getAllByRole('button', { name: '+' })

describe('CreateBattleModal multi-pack', () => {
  beforeEach(() => (createBattle as unknown as ReturnType<typeof vi.fn>).mockClear())

  it('builds a bundle with steppers and submits packs', async () => {
    render(<CreateBattleModal onClose={() => {}} onCreated={() => {}} />)
    await screen.findByText('PKMN 25')
    // Create is disabled with 0 boxes
    expect((screen.getByRole('button', { name: 'Crear' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(plusButtons()[0])   // m25 → 1
    fireEvent.click(plusButtons()[0])   // m25 → 2
    fireEvent.click(plusButtons()[1])   // m50 → 1
    expect(screen.getByText(/3\/10 cajas/)).toBeTruthy()
    const create = screen.getByRole('button', { name: 'Crear' }) as HTMLButtonElement
    expect(create.disabled).toBe(false)
    fireEvent.click(create)
    expect(createBattle).toHaveBeenCalledWith('tok', {
      packs: [{ machine_code: 'm25', count: 2 }, { machine_code: 'm50', count: 1 }],
      max_players: 4, mode: 'pack',
    })
  })

  it('caps the bundle at 10 boxes (+ disabled)', async () => {
    render(<CreateBattleModal onClose={() => {}} onCreated={() => {}} />)
    await screen.findByText('PKMN 25')
    for (let i = 0; i < 10; i++) fireEvent.click(plusButtons()[0])   // m25 → 10
    expect(screen.getByText(/10\/10 cajas/)).toBeTruthy()
    expect(plusButtons().every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- CreateBattleModal`
Expected: FAIL — no `+` stepper buttons (the current modal is a single `<select>`).

- [ ] **Step 3: Rewrite `CreateBattleModal.tsx`**

Replace `src/ui/screens/Hub/CreateBattleModal.tsx` with:

```tsx
import { useEffect, useState, type CSSProperties } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS, formatUsd } from '../../theme'
import { fetchMachines, type GachaMachine } from '../../../onchain/gachaClient'
import { createBattle, type BattleMode } from '../../../onchain/packBattleClient'
import { buildCreateBody, bundleToPacks, totalBoxes, bundleCostUsd } from './createBattleBody'
import { useDelegationGate } from '../../components/useDelegationGate'
import { DelegationGate } from '../../components/DelegationGate'

const PLAYER_COUNTS = [2, 3, 4, 5, 6, 8, 10]
const MAX_BOXES = 10

export function CreateBattleModal({ onClose, onCreated }: {
  onClose: () => void; onCreated: (battleId: string) => void
}) {
  const { identityToken } = useIdentityToken()
  const gate = useDelegationGate()
  const [machines, setMachines] = useState<GachaMachine[]>([])
  const [machineCode, setMachineCode] = useState<string>('')   // royale single machine
  const [counts, setCounts] = useState<Record<string, number>>({})   // pack bundle
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

  const boxes = totalBoxes(counts)
  const costUsd = bundleCostUsd(counts, machines)

  function step(code: string, delta: number) {
    setCounts((c) => {
      if (delta > 0 && totalBoxes(c) >= MAX_BOXES) return c
      return { ...c, [code]: Math.max(0, (c[code] ?? 0) + delta) }
    })
  }

  const createDisabled = busy || !identityToken
    || (mode === 'pack' ? boxes === 0 : !machineCode)

  function submit() {
    if (!identityToken) return
    if (mode === 'pack' && boxes === 0) return
    if (mode === 'royale' && !machineCode) return
    gate.requireDelegation(async () => {
      setBusy(true); setError(null)
      try {
        const body = mode === 'pack'
          ? { packs: bundleToPacks(counts), max_players: players, mode: 'pack' as BattleMode }
          : buildCreateBody('royale', machineCode, players)
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
    <div role="dialog" aria-modal="true" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: '#000000aa', zIndex: 40,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`,
          borderRadius: 14, padding: 22, maxWidth: 420, width: '100%' }}>
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
              {m === 'pack' ? 'Pack' : 'Royale'}
            </button>
          ))}
        </div>

        {mode === 'pack' ? (
          /* Bundle builder */
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: COLORS.muted }}>Cajas del bundle (máx {MAX_BOXES})</label>
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
              {machines.filter((m) => m.available !== false).map((m) => {
                const n = counts[m.code] ?? 0
                return (
                  <div key={m.code} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#0c1019',
                    border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: '8px 10px' }}>
                    <span style={{ flex: 1, fontSize: 12, color: COLORS.text }}>{m.name}</span>
                    <span style={{ fontSize: 11, color: COLORS.muted }}>${m.price}</span>
                    <button aria-label="−" onClick={() => step(m.code, -1)} disabled={n === 0} style={stepBtn}>−</button>
                    <span style={{ width: 18, textAlign: 'center', fontFamily: FONTS.mono, color: COLORS.text }}>{n}</span>
                    <button aria-label="+" onClick={() => step(m.code, +1)} disabled={boxes >= MAX_BOXES} style={stepBtn}>+</button>
                  </div>
                )
              })}
            </div>
            <div style={{ marginTop: 8, fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted }}>
              {boxes}/{MAX_BOXES} cajas · {formatUsd(costUsd)} total
            </div>
          </div>
        ) : (
          /* Royale: single machine */
          <>
            <label style={{ fontSize: 11, color: COLORS.muted }}>Machine</label>
            <select value={machineCode} onChange={(e) => setMachineCode(e.target.value)}
              style={{ width: '100%', margin: '6px 0 14px', padding: '10px',
                background: '#0c1019', color: COLORS.text, border: `1px solid ${COLORS.border}`, borderRadius: 10 }}>
              {machines.map((m) => (
                <option key={m.code} value={m.code}>{m.name} · ${m.price}</option>
              ))}
            </select>
          </>
        )}

        {/* Player count */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: COLORS.muted }}>Jugadores</label>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {PLAYER_COUNTS.map((nn) => (
              <button key={nn} onClick={() => setPlayers(nn)}
                style={{ width: 44, padding: '8px 0', borderRadius: 9, cursor: 'pointer',
                  background: players === nn ? COLORS.green : '#0c1019',
                  color: players === nn ? '#03110a' : COLORS.muted,
                  border: `1px solid ${COLORS.border}`, fontWeight: 700 }}>
                {nn}
              </button>
            ))}
          </div>
        </div>

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
          <button onClick={submit} disabled={createDisabled}
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

const stepBtn: CSSProperties = {
  width: 26, height: 26, borderRadius: 7, border: `1px solid ${COLORS.border}`,
  background: '#161b24', color: COLORS.text, cursor: 'pointer', fontWeight: 800, lineHeight: 1,
}
```

- [ ] **Step 4: Run test + typecheck + full suite**

Run: `npm test -- CreateBattleModal` then `npx tsc --noEmit` then `npm test`
Expected: the 2 new cases PASS; tsc clean; full suite green (the existing Hub/`createBattleBody` tests still pass — `buildCreateBody` for royale is unchanged).

- [ ] **Step 5: Manual smoke (optional)**

With backend (`:9090`) + ngrok up and the frontend (`:5173`): open the Hub → Create → Pack mode → step a couple of machines → "X/10 cajas · $Y" updates → Crear → lands on `/play/battle/:id`.

- [ ] **Step 6: Commit**

```bash
git add src/ui/screens/Hub/CreateBattleModal.tsx src/ui/screens/Hub/CreateBattleModal.test.tsx
git commit -m "feat(fe): CreateBattleModal bundle builder for multi-pack (#4e-2)"
```

---

## Final whole-branch review

After Task 2, run the full frontend suite (`npm test` + `npx tsc --noEmit`) and request a whole-branch review before merging to `master`. Update `.superpowers/sdd/progress.md` with the #4e-2 sub-project entry. Note for the reviewer: royale must stay single-machine (`buildCreateBody` path unchanged); the bundle cost shown is an approximate USD sum (`machine.price × count`), not the backend's base-unit total. This completes #4e (backend #4e-1 + frontend #4e-2).
