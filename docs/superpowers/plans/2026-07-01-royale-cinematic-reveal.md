# Battle Royale Cinematic Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Battle Royale running-view with a paced client-side replay — cards revealed one-by-one in seating order, a live leaderboard by accumulated insured value, and a blurred "La ronda X empezará en 5" countdown between rounds.

**Architecture:** A `useRoyaleReveal` hook owns an animation cursor `(round, card, phase)` and **projects** the existing `RevealVM` down to a "revealed-so-far" view; every visible component reads from that projection. The cursor advances on timers but never outruns the data (a card reveals only once its pull has resolved). `BattleFlow` gates the swap to `RoyaleResult` on an `onComplete` callback so the final round finishes animating. No backend changes.

**Tech Stack:** React 19, TypeScript, Vite, Vitest + @testing-library/react (`renderHook`, fake timers). Existing helpers: `RevealCard`, `useAliases`, `EmoteBar`, theme (`COLORS/FONTS/GRADIENT/formatUsd`).

## Global Constraints

- No backend changes. The royale engine already produces pulls progressively; clients poll via `useBattle(id, 1500)`.
- Card value source is **only** `RevealCardVM.insuredValue` (never a computed/estimated value).
- Reveal order within a round is **seating order** = `vm.players` order, filtered to players alive at the start of that round.
- The grid stays in **stable seating order** during the reveal (cards never reorder); live ranking is the leaderboard's job. Only `RoyaleResult` keeps ranked (`useRanked`) ordering.
- Timing defaults: per-card dwell `DWELL_MS = 900`, elimination beat `ELIM_BEAT_MS = 800`, countdown `COUNTDOWN_FROM = 5` (1s/tick).
- Reduced motion: no flips/countdown — show the full current `vm` and fire `onComplete` once the battle is `settled`.
- `onComplete` fires at most once (ref-guarded).
- Spanish copy in the overlay: `La ronda {N} empezará en {n}`.

---

## File Structure

- **Create `src/ui/screens/battle/royaleShared.ts`** — shared pure helpers (`shortWallet`, `tintFor`, `medalColor`) used by the reveal, the leaderboard, and the result view. Extracted from `RoyaleReveal.tsx` so the new components can import them without a circular dependency.
- **Create `src/ui/screens/battle/useRoyaleReveal.ts`** — the animation state machine + pure helpers `revealOrderWallets`, `totalRounds`, `project`. One clear responsibility: turn `(vm, cursor)` into a paced, projected view.
- **Create `src/ui/screens/battle/LiveLeaderboard.tsx`** — presentational leaderboard sorted by accumulated insured value. Reused in the board sidebar and the countdown overlay.
- **Create `src/ui/screens/battle/RoundBreakOverlay.tsx`** — the blurred countdown overlay.
- **Modify `src/ui/screens/battle/RoyaleReveal.tsx`** — rewrite the running view (`RoyaleReveal`) to compose the hook + new components + `onComplete` prop; keep `RoyaleResult` unchanged; import shared helpers; re-export `shortWallet`.
- **Modify `src/ui/flows/BattleFlow.tsx`** — add the `royaleRevealDone` gate.
- **Modify `src/index.css`** — add the countdown-number pop keyframes.
- **Tests:** `useRoyaleReveal.test.ts` (new), `LiveLeaderboard.test.tsx` (new), `RoundBreakOverlay.test.tsx` (new), `RoyaleReveal.test.tsx` (update).

---

## Task 1: Shared helpers module

**Files:**
- Create: `src/ui/screens/battle/royaleShared.ts`
- Modify: `src/ui/screens/battle/RoyaleReveal.tsx` (remove the local copies of these helpers, import them instead, re-export `shortWallet`)
- Test: `src/ui/screens/battle/royaleShared.test.ts`

**Interfaces:**
- Produces:
  - `shortWallet(w: string): string`
  - `tintFor(w: string): string` — a deterministic CSS gradient string for an avatar
  - `medalColor(rank: number): string`

- [ ] **Step 1: Write the failing test**

Create `src/ui/screens/battle/royaleShared.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { shortWallet, tintFor, medalColor } from './royaleShared'

describe('royaleShared', () => {
  it('shortWallet truncates long wallets and leaves short ones', () => {
    expect(shortWallet('ABCDEFGHIJKL')).toBe('ABCD…IJKL')
    expect(shortWallet('short')).toBe('short')
  })

  it('tintFor is deterministic per wallet', () => {
    expect(tintFor('wallet-x')).toBe(tintFor('wallet-x'))
    expect(tintFor('wallet-x')).toMatch(/linear-gradient/)
  })

  it('medalColor returns gold/silver/bronze for the podium', () => {
    expect(medalColor(1)).toBe('#f5c542')
    expect(medalColor(2)).toBe('#c8d0da')
    expect(medalColor(3)).toBe('#e8964e')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/screens/battle/royaleShared.test.ts`
Expected: FAIL — `Failed to resolve import "./royaleShared"`.

- [ ] **Step 3: Create the shared module**

Create `src/ui/screens/battle/royaleShared.ts`:

```ts
import { COLORS } from '../../theme'

export function shortWallet(w: string): string {
  return w.length > 9 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w
}

const TINTS = [
  'linear-gradient(135deg,#ff6bb5,#d4127a)',
  'linear-gradient(135deg,#4ea8ff,#6a5bff)',
  'linear-gradient(135deg,#f5c542,#e8732c)',
  'linear-gradient(135deg,#00ffc4,#1aa0d8)',
  'linear-gradient(135deg,#ff6e8a,#d23a5e)',
]

export function tintFor(w: string): string {
  const h = Math.abs([...w].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) | 0, 0))
  return TINTS[h % TINTS.length]
}

export function medalColor(rank: number): string {
  return rank === 1 ? '#f5c542' : rank === 2 ? '#c8d0da' : rank === 3 ? '#e8964e' : COLORS.muted
}
```

- [ ] **Step 4: Update `RoyaleReveal.tsx` to import the shared helpers**

In `src/ui/screens/battle/RoyaleReveal.tsx`:

Remove the local `shortWallet` export (lines ~12-14), the `TINTS`/`tintFor` constants (lines ~27-28), and the `medalColor` const (line ~29).

Add this import near the other imports (after the `battleReveal` type import):

```ts
import { shortWallet, tintFor, medalColor } from './royaleShared'
```

Add this re-export at the very bottom of the file (so `BattleFlow`'s `import { shortWallet } from './RoyaleReveal'` keeps working):

```ts
export { shortWallet }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/ui/screens/battle/royaleShared.test.ts src/ui/screens/battle/RoyaleReveal.test.tsx`
Expected: PASS (both files). The existing `RoyaleReveal.test.tsx` still passes because behavior is unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/ui/screens/battle/royaleShared.ts src/ui/screens/battle/royaleShared.test.ts src/ui/screens/battle/RoyaleReveal.tsx
git commit -m "refactor(royale): extract shared avatar/wallet helpers to royaleShared"
```

---

## Task 2: The `useRoyaleReveal` animation hook

**Files:**
- Create: `src/ui/screens/battle/useRoyaleReveal.ts`
- Test: `src/ui/screens/battle/useRoyaleReveal.test.ts`

**Interfaces:**
- Consumes: `RevealVM`, `RevealCardVM`, `RevealPlayerVM` from `./battleReveal`.
- Produces:
  - `DWELL_MS = 900`, `ELIM_BEAT_MS = 800`, `COUNTDOWN_FROM = 5`
  - `revealOrderWallets(vm: RevealVM, roundNumber: number): string[]`
  - `totalRounds(vm: RevealVM): number`
  - `project(vm: RevealVM, round: number, card: number): RevealVM`
  - `type RevealPhase = 'revealing' | 'roundBreak' | 'done'`
  - `interface RoyaleRevealState { phase: RevealPhase; projection: RevealVM; revealRound: number; countdown: number; upcomingRound: number; openingWallet: string | null; justEliminated: string | null }`
  - `useRoyaleReveal(vm: RevealVM, opts: { reducedMotion: boolean; onComplete?: () => void }): RoyaleRevealState`

- [ ] **Step 1: Write the failing test**

Create `src/ui/screens/battle/useRoyaleReveal.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRoyaleReveal, project, revealOrderWallets, totalRounds } from './useRoyaleReveal'
import type { RevealVM, RevealCardVM } from './battleReveal'

const card = (wallet: string, isMe: boolean, val: number | null, addr: string | null): RevealCardVM => ({
  wallet, isMe, nftAddress: addr, rarity: null, insuredValue: val, autoSold: false, grade: null, year: null, name: null,
})

// 2 players, 1 round, settled, fully resolved. A beats B; B out round 1.
const vm2: RevealVM = {
  mode: 'royale', status: 'settled', winner: 'A', meWallet: 'A',
  players: [
    { wallet: 'A', isMe: true, accumulatedValue: 120, eliminatedRound: null, cards: [], total: 120 },
    { wallet: 'B', isMe: false, accumulatedValue: 40, eliminatedRound: 1, cards: [], total: 40 },
  ],
  rounds: [{ roundNumber: 1, eliminatedWallet: 'B', cards: [card('A', true, 120, 'nA1'), card('B', false, 40, 'nB1')] }],
  potValue: 160, machines: ['m'], buybackTotal: 0,
}

// 3 players, 2 rounds. C out round 1, B out round 2, A wins.
const vm3: RevealVM = {
  mode: 'royale', status: 'settled', winner: 'A', meWallet: 'A',
  players: [
    { wallet: 'A', isMe: true, accumulatedValue: 300, eliminatedRound: null, cards: [], total: 300 },
    { wallet: 'B', isMe: false, accumulatedValue: 150, eliminatedRound: 2, cards: [], total: 150 },
    { wallet: 'C', isMe: false, accumulatedValue: 40, eliminatedRound: 1, cards: [], total: 40 },
  ],
  rounds: [
    { roundNumber: 1, eliminatedWallet: 'C', cards: [card('A', true, 100, 'nA1'), card('B', false, 90, 'nB1'), card('C', false, 40, 'nC1')] },
    { roundNumber: 2, eliminatedWallet: 'B', cards: [card('A', true, 200, 'nA2'), card('B', false, 60, 'nB2')] },
  ],
  potValue: 490, machines: ['m'], buybackTotal: 0,
}

describe('pure helpers', () => {
  it('revealOrderWallets keeps players alive at the start of the round, in seating order', () => {
    expect(revealOrderWallets(vm3, 1)).toEqual(['A', 'B', 'C'])
    expect(revealOrderWallets(vm3, 2)).toEqual(['A', 'B'])   // C already out
  })

  it('totalRounds is players - 1', () => {
    expect(totalRounds(vm3)).toBe(2)
    expect(totalRounds(vm2)).toBe(1)
  })

  it('project reveals only cards up to the cursor and only completes eliminations for finished rounds', () => {
    const p = project(vm3, 1, 2)   // round 1, A and B revealed, C not
    const byWallet = Object.fromEntries(p.players.map((x) => [x.wallet, x]))
    expect(byWallet.A.total).toBe(100)
    expect(byWallet.B.total).toBe(90)
    expect(byWallet.C.total).toBe(0)
    expect(byWallet.C.eliminatedRound).toBeNull()             // round 1 not fully revealed yet
  })

  it('project applies an elimination once its round is fully revealed', () => {
    const p = project(vm3, 2, 0)   // round 1 fully revealed, round 2 not started
    const byWallet = Object.fromEntries(p.players.map((x) => [x.wallet, x]))
    expect(byWallet.C.eliminatedRound).toBe(1)
    expect(byWallet.B.eliminatedRound).toBeNull()             // round 2 not revealed
    expect(byWallet.A.total).toBe(100)
  })
})

describe('useRoyaleReveal', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('reduced motion returns the full vm and completes when settled', () => {
    const onComplete = vi.fn()
    const { result } = renderHook(() => useRoyaleReveal(vm2, { reducedMotion: true, onComplete }))
    expect(result.current.projection).toBe(vm2)
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('done')
  })

  it('reveals cards one by one and reaches done on the settled final round', () => {
    const onComplete = vi.fn()
    const { result } = renderHook(() => useRoyaleReveal(vm2, { reducedMotion: false, onComplete }))
    expect(result.current.phase).toBe('revealing')
    act(() => { vi.advanceTimersByTime(900) })   // reveal A
    act(() => { vi.advanceTimersByTime(900) })   // reveal B -> round complete, last, settled -> done
    act(() => { vi.advanceTimersByTime(0) })
    expect(result.current.phase).toBe('done')
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('enters a round break with a countdown between rounds', () => {
    const onComplete = vi.fn()
    const { result } = renderHook(() => useRoyaleReveal(vm3, { reducedMotion: false, onComplete }))
    act(() => { vi.advanceTimersByTime(900 * 3) })   // reveal A, B, C of round 1
    act(() => { vi.advanceTimersByTime(800) })       // elimination beat -> round break
    expect(result.current.phase).toBe('roundBreak')
    expect(result.current.countdown).toBe(5)
    expect(result.current.upcomingRound).toBe(2)
    expect(result.current.justEliminated).toBe('C')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current.countdown).toBe(4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/screens/battle/useRoyaleReveal.test.ts`
Expected: FAIL — `Failed to resolve import "./useRoyaleReveal"`.

- [ ] **Step 3: Implement the hook**

Create `src/ui/screens/battle/useRoyaleReveal.ts`:

```ts
import { useEffect, useRef, useState } from 'react'
import type { RevealVM, RevealCardVM, RevealPlayerVM } from './battleReveal'

export const DWELL_MS = 900
export const ELIM_BEAT_MS = 800
export const COUNTDOWN_FROM = 5

export type RevealPhase = 'revealing' | 'roundBreak' | 'done'

export interface RoyaleRevealState {
  phase: RevealPhase
  projection: RevealVM
  revealRound: number
  countdown: number
  upcomingRound: number
  openingWallet: string | null   // slot currently waiting for its pull to resolve ("abriendo…")
  justEliminated: string | null  // player eliminated in the just-finished round (beat + break)
}

// Players still alive at the START of `roundNumber`, in seating (vm.players) order.
export function revealOrderWallets(vm: RevealVM, roundNumber: number): string[] {
  return vm.players
    .filter((p) => p.eliminatedRound == null || p.eliminatedRound >= roundNumber)
    .map((p) => p.wallet)
}

// Last-one-standing: one elimination per round.
export function totalRounds(vm: RevealVM): number {
  return Math.max(1, vm.players.length - 1)
}

// Project the full VM down to what has been revealed at cursor (round, card).
export function project(vm: RevealVM, round: number, card: number): RevealVM {
  const revealedByWallet = new Map<string, RevealCardVM[]>()
  let lastFullRound = 0
  for (const r of vm.rounds) {
    const order = revealOrderWallets(vm, r.roundNumber)
    const nRevealed = r.roundNumber < round ? order.length
      : r.roundNumber === round ? Math.min(card, order.length)
      : 0
    if (order.length > 0 && nRevealed >= order.length) {
      lastFullRound = Math.max(lastFullRound, r.roundNumber)
    }
    for (let i = 0; i < nRevealed; i++) {
      const w = order[i]
      const c = r.cards.find((cc) => cc.wallet === w)
      if (c && c.nftAddress) {
        const arr = revealedByWallet.get(w) ?? []
        arr.push(c)
        revealedByWallet.set(w, arr)
      }
    }
  }
  const players: RevealPlayerVM[] = vm.players.map((p) => {
    const cards = revealedByWallet.get(p.wallet) ?? []
    const eliminatedRound = p.eliminatedRound != null && p.eliminatedRound <= lastFullRound ? p.eliminatedRound : null
    return { ...p, cards, total: cards.reduce((s, c) => s + (c.insuredValue ?? 0), 0), eliminatedRound }
  })
  const potValue = players.reduce((s, p) => s + p.total, 0)
  return { ...vm, players, potValue }
}

export function useRoyaleReveal(
  vm: RevealVM,
  { reducedMotion, onComplete }: { reducedMotion: boolean; onComplete?: () => void },
): RoyaleRevealState {
  const [round, setRound] = useState(1)
  const [card, setCard] = useState(0)
  const [phase, setPhase] = useState<RevealPhase>('revealing')
  const [countdown, setCountdown] = useState(COUNTDOWN_FROM)
  const firedRef = useRef(false)

  // Minimal derived signals so the scheduler's timers reset only on meaningful changes
  // (NOT on every 1.5s poll, which would restart an in-flight dwell timer forever).
  const order = revealOrderWallets(vm, round)
  const roundData = vm.rounds.find((r) => r.roundNumber === round)
  const targetWallet = phase === 'revealing' && card < order.length ? order[card] : null
  const targetResolved = !!(targetWallet && roundData?.cards.find((c) => c.wallet === targetWallet)?.nftAddress)
  const roundComplete = phase === 'revealing' && order.length > 0 && card >= order.length
  const isLastRound = vm.players.length - round <= 1
  const settled = vm.status === 'settled'

  // Fire onComplete exactly once when we reach 'done'.
  useEffect(() => {
    if (phase === 'done' && !firedRef.current) {
      firedRef.current = true
      onComplete?.()
    }
  }, [phase, onComplete])

  // Reduced motion: skip the whole animation, complete as soon as the battle settles.
  useEffect(() => {
    if (!reducedMotion) return
    if (settled && phase !== 'done') setPhase('done')
  }, [reducedMotion, settled, phase])

  // Scheduler: exactly one scheduled transition at a time.
  useEffect(() => {
    if (reducedMotion || phase === 'done') return

    if (phase === 'roundBreak') {
      if (countdown <= 0) {
        setRound((r) => r + 1)
        setCard(0)
        setPhase('revealing')
        return
      }
      const t = setTimeout(() => setCountdown((n) => n - 1), 1000)
      return () => clearTimeout(t)
    }

    // phase === 'revealing'
    if (!roundComplete) {
      if (targetResolved) {
        const t = setTimeout(() => setCard((c) => c + 1), DWELL_MS)
        return () => clearTimeout(t)
      }
      return   // waiting for the next pull to resolve; re-runs when targetResolved flips
    }

    // round fully revealed
    if (isLastRound) {
      if (settled) setPhase('done')
      return   // else hold on the fully-revealed final round until the battle settles
    }
    const t = setTimeout(() => { setPhase('roundBreak'); setCountdown(COUNTDOWN_FROM) }, ELIM_BEAT_MS)
    return () => clearTimeout(t)
  }, [reducedMotion, phase, countdown, roundComplete, targetResolved, isLastRound, settled])

  if (reducedMotion) {
    return {
      phase, projection: vm, revealRound: round, countdown,
      upcomingRound: round + 1, openingWallet: null, justEliminated: null,
    }
  }

  const projection = project(vm, round, card)
  const openingWallet = targetWallet && !targetResolved ? targetWallet : null
  const justEliminated = roundComplete || phase === 'roundBreak' ? (roundData?.eliminatedWallet ?? null) : null
  return { phase, projection, revealRound: round, countdown, upcomingRound: round + 1, openingWallet, justEliminated }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/screens/battle/useRoyaleReveal.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/battle/useRoyaleReveal.ts src/ui/screens/battle/useRoyaleReveal.test.ts
git commit -m "feat(royale): useRoyaleReveal — paced projection state machine"
```

---

## Task 3: LiveLeaderboard component

**Files:**
- Create: `src/ui/screens/battle/LiveLeaderboard.tsx`
- Test: `src/ui/screens/battle/LiveLeaderboard.test.tsx`

**Interfaces:**
- Consumes: `shortWallet`/`tintFor`/`medalColor` from `./royaleShared` (Task 1); `RevealVM`, `RevealPlayerVM` from `./battleReveal`.
- Produces: `LiveLeaderboard({ vm, name, title? }): JSX.Element` where `name: (p: RevealPlayerVM) => string`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/screens/battle/LiveLeaderboard.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { LiveLeaderboard } from './LiveLeaderboard'
import type { RevealVM, RevealPlayerVM } from './battleReveal'

const vm: RevealVM = {
  mode: 'royale', status: 'running', winner: null, meWallet: 'A',
  players: [
    { wallet: 'A', isMe: true, accumulatedValue: 90, eliminatedRound: null, cards: [], total: 90 },
    { wallet: 'B', isMe: false, accumulatedValue: 210, eliminatedRound: null, cards: [], total: 210 },
    { wallet: 'C', isMe: false, accumulatedValue: 30, eliminatedRound: 1, cards: [], total: 30 },
  ],
  rounds: [], potValue: 330, machines: ['m'], buybackTotal: 0,
}
const name = (p: RevealPlayerVM) => (p.isMe ? 'You' : p.wallet)

describe('LiveLeaderboard', () => {
  it('orders rows by accumulated value descending', () => {
    render(<LiveLeaderboard vm={vm} name={name} />)
    const rows = screen.getAllByTestId('lb-row')
    expect(rows.map((r) => within(r).getByTestId('lb-name').textContent)).toEqual(['B', 'You', 'C'])
  })

  it('shows the accumulated value for each player', () => {
    render(<LiveLeaderboard vm={vm} name={name} />)
    expect(screen.getByText('$210')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/screens/battle/LiveLeaderboard.test.tsx`
Expected: FAIL — `Failed to resolve import "./LiveLeaderboard"`.

- [ ] **Step 3: Implement the component**

Create `src/ui/screens/battle/LiveLeaderboard.tsx`:

```tsx
import { COLORS, FONTS, formatUsd } from '../../theme'
import { tintFor, medalColor } from './royaleShared'
import type { RevealVM, RevealPlayerVM } from './battleReveal'

export function LiveLeaderboard({ vm, name, title = 'LEADERBOARD' }: {
  vm: RevealVM; name: (p: RevealPlayerVM) => string; title?: string
}) {
  const ranked = [...vm.players].sort((a, b) => (b.total - a.total) || a.wallet.localeCompare(b.wallet))
  const aliveCount = vm.players.filter((p) => p.eliminatedRound == null).length
  const leader = ranked.find((p) => p.eliminatedRound == null)?.wallet ?? null
  const atRisk = aliveCount > 1 ? [...ranked].reverse().find((p) => p.eliminatedRound == null)?.wallet ?? null : null

  return (
    <div style={{ borderRadius: 16, border: `1px solid ${COLORS.border}`, background: 'linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,.008))', overflow: 'hidden', minWidth: 240 }}>
      <div style={{ padding: '11px 14px', borderBottom: `1px solid ${COLORS.border}`, fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.18em', color: COLORS.muted }}>{title}</div>
      {ranked.map((p, i) => {
        const rank = i + 1
        const elim = p.eliminatedRound != null
        return (
          <div key={p.wallet} data-testid="lb-row" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: '1px solid #ffffff08', background: p.isMe ? 'rgba(0,255,196,.06)' : 'transparent', opacity: elim ? 0.5 : 1 }}>
            <span style={{ width: 20, textAlign: 'center', fontFamily: FONTS.mono, fontSize: 13, fontWeight: 700, color: medalColor(rank) }}>{rank}</span>
            <span style={{ flex: 'none', width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#06170f', background: tintFor(p.wallet), border: `2px solid ${p.isMe ? 'rgba(0,255,196,.7)' : 'rgba(255,255,255,.12)'}` }}>{name(p).slice(0, 1).toUpperCase()}</span>
            <span data-testid="lb-name" style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: p.isMe ? COLORS.green : COLORS.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: elim ? 'line-through' : 'none' }}>{name(p)}</span>
            {p.wallet === leader && !elim && <span aria-label="leader" style={{ fontSize: 12 }}>👑</span>}
            {p.wallet === atRisk && !elim && <span aria-label="at risk" style={{ width: 7, height: 7, borderRadius: '50%', background: '#ff5e7a', boxShadow: '0 0 6px #ff5e7a' }} />}
            <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 14, color: elim ? COLORS.muted : COLORS.text }}>{formatUsd(p.total)}</span>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/screens/battle/LiveLeaderboard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/battle/LiveLeaderboard.tsx src/ui/screens/battle/LiveLeaderboard.test.tsx
git commit -m "feat(royale): LiveLeaderboard ranked by accumulated insured value"
```

---

## Task 4: RoundBreakOverlay + countdown CSS

**Files:**
- Create: `src/ui/screens/battle/RoundBreakOverlay.tsx`
- Modify: `src/index.css` (append the countdown pop keyframes)
- Test: `src/ui/screens/battle/RoundBreakOverlay.test.tsx`

**Interfaces:**
- Consumes: `LiveLeaderboard` (Task 3); `RevealVM`, `RevealPlayerVM` from `./battleReveal`.
- Produces: `RoundBreakOverlay({ vm, name, upcomingRound, countdown }): JSX.Element`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/screens/battle/RoundBreakOverlay.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RoundBreakOverlay } from './RoundBreakOverlay'
import type { RevealVM, RevealPlayerVM } from './battleReveal'

const vm: RevealVM = {
  mode: 'royale', status: 'running', winner: null, meWallet: 'A',
  players: [
    { wallet: 'A', isMe: true, accumulatedValue: 90, eliminatedRound: null, cards: [], total: 90 },
    { wallet: 'B', isMe: false, accumulatedValue: 40, eliminatedRound: null, cards: [], total: 40 },
  ],
  rounds: [], potValue: 130, machines: ['m'], buybackTotal: 0,
}
const name = (p: RevealPlayerVM) => (p.isMe ? 'You' : p.wallet)

describe('RoundBreakOverlay', () => {
  it('announces the upcoming round and the countdown, with the leaderboard below', () => {
    render(<RoundBreakOverlay vm={vm} name={name} upcomingRound={3} countdown={4} />)
    expect(screen.getByText(/La ronda 3 empezará en/i)).toBeTruthy()
    expect(screen.getByText('4')).toBeTruthy()
    expect(screen.getByText(/CLASIFICACIÓN ACTUAL/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/screens/battle/RoundBreakOverlay.test.tsx`
Expected: FAIL — `Failed to resolve import "./RoundBreakOverlay"`.

- [ ] **Step 3: Implement the component**

Create `src/ui/screens/battle/RoundBreakOverlay.tsx`:

```tsx
import { COLORS, FONTS } from '../../theme'
import { LiveLeaderboard } from './LiveLeaderboard'
import type { RevealVM, RevealPlayerVM } from './battleReveal'

export function RoundBreakOverlay({ vm, name, upcomingRound, countdown }: {
  vm: RevealVM; name: (p: RevealPlayerVM) => string; upcomingRound: number; countdown: number
}) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, padding: 24, background: 'rgba(6,8,11,.55)' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 12, letterSpacing: '.28em', color: COLORS.muted, marginBottom: 10 }}>SIGUIENTE RONDA</div>
        <div style={{ fontFamily: FONTS.display, fontSize: 'clamp(22px,3vw,30px)', fontWeight: 700, letterSpacing: '-.02em', color: COLORS.text }}>
          La ronda {upcomingRound} empezará en
        </div>
        <div key={countdown} className="ca-count-pop" style={{ fontFamily: FONTS.display, fontSize: 'clamp(56px,9vw,96px)', fontWeight: 800, lineHeight: 1, marginTop: 6, background: 'linear-gradient(135deg,#ff2e97,#00ffc4)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
          {Math.max(0, countdown)}
        </div>
      </div>
      <div style={{ width: 'min(420px,92%)' }}>
        <LiveLeaderboard vm={vm} name={name} title="CLASIFICACIÓN ACTUAL" />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Append the countdown pop keyframes to `src/index.css`**

At the end of `src/index.css` (after the `ca-spin` keyframe, ~line 162), append:

```css
/* Royale round-break countdown number pop */
@keyframes ca-count-pop { 0%{transform:scale(.6);opacity:0} 45%{transform:scale(1.12);opacity:1} 100%{transform:scale(1);opacity:1} }
.ca-count-pop { animation: ca-count-pop .5s cubic-bezier(.2,.8,.2,1) both; }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/ui/screens/battle/RoundBreakOverlay.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/screens/battle/RoundBreakOverlay.tsx src/ui/screens/battle/RoundBreakOverlay.test.tsx src/index.css
git commit -m "feat(royale): RoundBreakOverlay countdown + ca-count-pop keyframes"
```

---

## Task 5: Rewrite the RoyaleReveal running view

**Files:**
- Modify: `src/ui/screens/battle/RoyaleReveal.tsx` (rewrite the running-view `RoyaleReveal` + its `RoundView`; keep `RoyaleResult`/`ResultView` intact)
- Test: `src/ui/screens/battle/RoyaleReveal.test.tsx` (update the smoke test for the new structure)

**Interfaces:**
- Consumes: `useRoyaleReveal`, `totalRounds` (Task 2); `LiveLeaderboard` (Task 3); `RoundBreakOverlay` (Task 4); `shortWallet`/`tintFor`/`medalColor` (Task 1); `RevealCard`; `useAliases`; `EmoteBar`.
- Produces: `RoyaleReveal({ vm, reducedMotion?, battleId?, onComplete? })`; still exports `RoyaleResult` and re-exports `shortWallet`.

- [ ] **Step 1: Update the existing test to the new structure (failing)**

Replace the body of `src/ui/screens/battle/RoyaleReveal.test.tsx` with:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RoyaleReveal } from './RoyaleReveal'
import type { RevealVM } from './battleReveal'

const vm: RevealVM = {
  mode: 'royale', status: 'running', winner: null, meWallet: 'A',
  players: [
    { wallet: 'A', isMe: true, accumulatedValue: 120, eliminatedRound: null, cards: [], total: 120 },
    { wallet: 'B', isMe: false, accumulatedValue: 40, eliminatedRound: 1, cards: [], total: 40 },
  ],
  rounds: [{ roundNumber: 1, eliminatedWallet: 'B', cards: [
    { wallet: 'A', isMe: true, nftAddress: 'nftA', rarity: 'Epic', insuredValue: 120, autoSold: false, grade: 10, year: '2018', name: 'Charizard' },
    { wallet: 'B', isMe: false, nftAddress: 'nftB', rarity: null, insuredValue: 40, autoSold: false, grade: null, year: null, name: null },
  ] }],
  potValue: 160, machines: ['m'], buybackTotal: 0,
}

afterEach(() => vi.restoreAllMocks())

describe('RoyaleReveal', () => {
  it('reduced motion shows the full board: alive count, me, and the eliminated player', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alias: null }) }))
    render(<MemoryRouter><RoyaleReveal vm={vm} reducedMotion /></MemoryRouter>)
    expect(screen.getByText(/ALIVE/i)).toBeTruthy()                        // battle bar
    expect(screen.getAllByText('You').length).toBeGreaterThan(0)           // A is me (grid + leaderboard)
    expect(screen.getAllByText(/eliminated/i).length).toBeGreaterThan(0)   // B marked out
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/screens/battle/RoyaleReveal.test.tsx`
Expected: FAIL — the current `RoyaleReveal` renders a single `getByText('You')` path that the old assertion used; the new test expects `getAllByText('You')` from both the grid and the leaderboard, which don't exist yet.

- [ ] **Step 3: Rewrite `RoyaleReveal.tsx`**

Replace the entire contents of `src/ui/screens/battle/RoyaleReveal.tsx` with:

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useIdentityToken } from '@privy-io/react-auth'
import { startRematch } from '../../battle/startRematch'
import { COLORS, FONTS, GRADIENT, formatUsd } from '../../theme'
import { VerifyPanel } from './VerifyPanel'
import { RevealCard } from './RevealCard'
import { useAliases } from '../../useAliases'
import { EmoteBar } from '../../emotes/EmoteBar'
import { shortWallet, tintFor, medalColor } from './royaleShared'
import { useRoyaleReveal, totalRounds } from './useRoyaleReveal'
import { LiveLeaderboard } from './LiveLeaderboard'
import { RoundBreakOverlay } from './RoundBreakOverlay'
import type { RevealVM, RevealPlayerVM } from './battleReveal'

const TITLE = (
  <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 'clamp(22px,3vw,30px)', fontWeight: 700, letterSpacing: '-.02em' }}>
    Battle <span style={{ color: '#ff6bb5' }}>Royale</span>
  </h1>
)
const screenStyle = { padding: '18px clamp(14px,2.4vw,28px) 28px', display: 'flex', flexDirection: 'column' as const, gap: 18 }

function useRanked(vm: RevealVM) {
  // Finish ranking: still-alive on top by value; eliminated below by when they went out.
  return [...vm.players]
    .sort((a, b) => ((b.eliminatedRound ?? 1e9) - (a.eliminatedRound ?? 1e9)) || (b.total - a.total))
    .map((p, i) => ({ p, rank: i + 1 }))
}
const nameOf = (aliases: Record<string, string | null>) => (p: RevealPlayerVM) =>
  p.isMe ? aliases[p.wallet] ?? 'You' : aliases[p.wallet] ?? shortWallet(p.wallet)

// Round-by-round cinematic reveal — shown while the royale is running (and until the final
// round finishes animating, at which point onComplete lets BattleFlow show RoyaleResult).
export function RoyaleReveal({ vm, reducedMotion = false, battleId, onComplete }: {
  vm: RevealVM; reducedMotion?: boolean; battleId?: string; onComplete?: () => void
}) {
  const aliases = useAliases(vm.players.map((p) => p.wallet))
  const name = nameOf(aliases)
  const rv = useRoyaleReveal(vm, { reducedMotion, onComplete })
  const proj = rv.projection
  const alive = proj.players.filter((p) => p.eliminatedRound == null).length
  const entry = vm.players.length ? vm.potValue / vm.players.length : 0
  const blurred = rv.phase === 'roundBreak' && !reducedMotion

  return (
    <div style={{ ...screenStyle, position: 'relative' }}>
      {TITLE}
      <div style={{ filter: blurred ? 'blur(6px)' : 'none', transition: 'filter .3s ease' }}>
        <BattleBar proj={proj} totalPlayers={vm.players.length} alive={alive} entry={entry}
          revealRound={rv.revealRound} rounds={totalRounds(vm)} settled={vm.status === 'settled'} />
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 520px', minWidth: 280, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 14 }}>
            {proj.players.map((p) => (
              <PlayerRevealCard key={p.wallet} p={p} name={name} reducedMotion={reducedMotion}
                opening={p.wallet === rv.openingWallet} eliminatedBeat={p.wallet === rv.justEliminated} />
            ))}
          </div>
          <div style={{ flex: '0 1 300px', minWidth: 240 }}>
            <LiveLeaderboard vm={proj} name={name} />
          </div>
        </div>
      </div>
      {blurred && <RoundBreakOverlay vm={proj} name={name} upcomingRound={rv.upcomingRound} countdown={rv.countdown} />}
      {vm.meWallet && <div style={{ display: 'flex', marginTop: 4 }}><EmoteBar meWallet={vm.meWallet} battleId={battleId} /></div>}
    </div>
  )
}

// Separate result screen — shown once every round has finished (battle settled + reveal done).
export function RoyaleResult({ vm, battleId, onExit }: { vm: RevealVM; battleId?: string; onExit?: () => void }) {
  const navigate = useNavigate()
  const { identityToken } = useIdentityToken()
  const aliases = useAliases(vm.players.map((p) => p.wallet))
  const [verifyOpen, setVerifyOpen] = useState(false)
  const name = nameOf(aliases)
  const ranked = useRanked(vm)
  const entry = vm.players.length ? vm.potValue / vm.players.length : 0

  return (
    <div style={screenStyle}>
      {TITLE}
      <ResultView
        vm={vm} name={name} ranked={ranked} entry={entry}
        onRematch={() => startRematch({ battleId, mode: 'royale', token: identityToken, navigate })} onExit={onExit} onVerify={() => setVerifyOpen(true)}
      />
      {verifyOpen && battleId && <VerifyPanel battleId={battleId} onClose={() => setVerifyOpen(false)} />}
    </div>
  )
}

// ─────────────────────────── BATTLE BAR ───────────────────────────
function BattleBar({ proj, totalPlayers, alive, entry, revealRound, rounds, settled }: {
  proj: RevealVM; totalPlayers: number; alive: number; entry: number; revealRound: number; rounds: number; settled: boolean
}) {
  const progress = totalPlayers > 1 ? (totalPlayers - alive) / (totalPlayers - 1) : 0
  return (
    <section style={{
      position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap',
      padding: '16px 22px', borderRadius: 18, marginBottom: 22,
      background: 'linear-gradient(135deg,rgba(255,46,151,.16),rgba(13,17,22,.55) 46%,rgba(0,255,196,.10))',
      border: `1px solid ${COLORS.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
        <div style={{ width: 50, height: 50, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(160deg,#2a1f47,#160f2b)', border: '1px solid rgba(255,46,151,.5)', boxShadow: '0 0 24px -8px rgba(255,46,151,.7)' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff6bb5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.52l4.276 3.664a1 1 0 0 0 1.516-.294z" /><path d="M5 21h14" /></svg>
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ fontFamily: FONTS.display, fontSize: 19, fontWeight: 700, letterSpacing: '-.01em' }}>ROYALE {Math.round(entry)}</span>
            {!settled && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', borderRadius: 7, background: 'rgba(255,94,122,.12)', border: '1px solid rgba(255,94,122,.32)', fontFamily: FONTS.mono, fontSize: 11, color: '#ff8198' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff5e7a', boxShadow: '0 0 6px #ff5e7a' }} />LIVE
              </span>
            )}
          </div>
          <div style={{ fontFamily: FONTS.mono, fontSize: 11.5, color: COLORS.muted, marginTop: 3 }}>
            Battle Royale · entry {formatUsd(entry)} · last one standing
          </div>
        </div>
      </div>
      <div style={{ flex: '1 1 220px', minWidth: 190 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.muted }}>
            {settled ? 'Battle complete' : 'Revealing the round'}
          </span>
          <span style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted }}>round <span style={{ color: COLORS.text, fontWeight: 700 }}>{Math.min(revealRound, rounds)}</span> / {rounds}</span>
        </div>
        <div style={{ height: 8, borderRadius: 8, background: '#ffffff10', overflow: 'hidden', border: `1px solid ${COLORS.border}` }}>
          <div style={{ height: '100%', width: `${Math.round(progress * 100)}%`, borderRadius: 8, background: GRADIENT, boxShadow: '0 0 16px -2px rgba(0,255,196,.7)', transition: 'width .4s ease' }} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.18em', color: COLORS.muted }}>ALIVE</div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em' }}><span style={{ color: COLORS.green }}>{alive}</span><span style={{ color: '#5c6675', fontSize: 16 }}> / {totalPlayers}</span></div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.18em', color: COLORS.muted }}>POT REVEALED</div>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.02em', background: GRADIENT, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{formatUsd(proj.potValue)}</div>
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────── PLAYER CARD ───────────────────────────
function PlayerRevealCard({ p, name, reducedMotion, opening, eliminatedBeat }: {
  p: RevealPlayerVM; name: (p: RevealPlayerVM) => string; reducedMotion: boolean; opening: boolean; eliminatedBeat: boolean
}) {
  const elim = p.eliminatedRound != null
  const latest = p.cards[p.cards.length - 1] ?? null
  const pending = { wallet: p.wallet, isMe: p.isMe, nftAddress: null, rarity: null, insuredValue: null, autoSold: false, grade: null, year: null, name: null }
  return (
    <div data-player-anchor={p.wallet} style={{
      position: 'relative', borderRadius: 18, padding: 14, overflow: 'hidden',
      background: 'linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.01))',
      border: `1px solid ${eliminatedBeat ? 'rgba(255,94,122,.6)' : COLORS.border}`,
      boxShadow: eliminatedBeat ? '0 0 40px -14px rgba(255,94,122,.8)' : 'none',
      transition: 'box-shadow .3s, border-color .3s',
    }}>
      <div style={{ opacity: elim ? 0.45 : 1, filter: elim ? 'grayscale(.9)' : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ flex: 'none', width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#06170f', background: tintFor(p.wallet), border: `2px solid ${p.isMe ? 'rgba(0,255,196,.7)' : 'rgba(255,255,255,.12)'}` }}>{name(p).slice(0, 1).toUpperCase()}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: p.isMe ? COLORS.green : COLORS.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 104 }}>{name(p)}</span>
              {p.isMe && <span style={{ flex: 'none', padding: '1px 6px', borderRadius: 5, background: 'rgba(0,255,196,.14)', border: '1px solid rgba(0,255,196,.4)', fontSize: 9, fontWeight: 700, color: COLORS.green }}>YOU</span>}
            </div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 10.5, color: '#6c7682', marginTop: 2 }}>{p.cards.length} card{p.cards.length === 1 ? '' : 's'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, minHeight: 128 }}>
          {opening || !latest
            ? <RevealCard card={pending} reducedMotion={reducedMotion} />
            : <RevealCard key={latest.nftAddress} card={latest} reducedMotion={reducedMotion} />}
        </div>
        <div>
          <div style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: '.16em', color: COLORS.muted }}>TOTAL</div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', color: elim ? COLORS.muted : COLORS.text }}>{formatUsd(p.total)}</div>
        </div>
      </div>
      {elim && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(6,8,11,.34)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 13px', borderRadius: 10, background: 'rgba(255,94,122,.14)', border: '1px solid rgba(255,94,122,.45)', color: '#ff8198', fontSize: 12, fontWeight: 700 }}>✕ ELIMINATED · R{p.eliminatedRound}</span>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────── RESULT VIEW ───────────────────────────
function ResultView({ vm, name, ranked, entry, onRematch, onExit, onVerify }: {
  vm: RevealVM; name: (p: RevealPlayerVM) => string; ranked: { p: RevealPlayerVM; rank: number }[]
  entry: number; onRematch: () => void; onExit?: () => void; onVerify: () => void
}) {
  const champ = ranked[0]?.p
  const iAmPlayer = vm.players.some((p) => p.isMe)
  const iWon = !!champ?.isMe
  const me = ranked.find((r) => r.p.isMe)
  const myRank = me?.rank
  const myElimRound = me?.p.eliminatedRound
  const allLoot = vm.players.flatMap((p) => p.cards)
  const lootTotal = allLoot.reduce((s, c) => s + (c.insuredValue ?? 0), 0)

  return (
    <div>
      <section style={{
        position: 'relative', overflow: 'hidden', borderRadius: 22, padding: 'clamp(26px,3vw,40px)', marginBottom: 22, textAlign: 'center',
        background: iWon ? 'linear-gradient(135deg,rgba(245,197,66,.14),rgba(13,17,22,.6) 50%,rgba(0,255,196,.12))' : 'linear-gradient(135deg,rgba(255,94,122,.10),rgba(13,17,22,.6) 50%,rgba(255,46,151,.08))',
        border: `1px solid ${iWon ? 'rgba(245,197,66,.4)' : 'rgba(255,94,122,.32)'}`,
      }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 12, letterSpacing: '.3em', color: iWon ? '#f5c542' : '#ff8198', marginBottom: 12 }}>
          {iWon ? 'LAST ONE STANDING' : iAmPlayer ? `ELIMINATED${myElimRound != null ? ` · ROUND ${myElimRound}` : ''}` : 'BATTLE OVER'}
        </div>
        <h2 style={{ margin: '0 0 12px', fontFamily: FONTS.display, fontSize: 'clamp(34px,5.5vw,60px)', fontWeight: 700, lineHeight: 1, letterSpacing: '-.03em', color: iWon ? '#f5c542' : COLORS.text }}>
          {iWon ? 'VICTORY!' : iAmPlayer ? 'You lost' : 'Battle over'}
        </h2>
        <p style={{ margin: 0, fontSize: 16, color: '#9aa4b2' }}>
          {iWon ? `You outlasted everyone and take the full ${formatUsd(vm.potValue)} pot.`
            : iAmPlayer ? `You finished #${myRank ?? '—'} · ${champ ? name(champ) : 'the winner'} took the ${formatUsd(vm.potValue)} pot.`
            : `${champ ? name(champ) : 'The winner'} took the ${formatUsd(vm.potValue)} pot.`}
        </p>
      </section>

      {champ && (
        <section style={{
          position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 'clamp(22px,3vw,44px)', flexWrap: 'wrap', justifyContent: 'center',
          borderRadius: 22, padding: 'clamp(22px,2.6vw,34px)', marginBottom: 22,
          background: 'linear-gradient(135deg,rgba(245,197,66,.10),rgba(13,17,22,.6) 50%,rgba(245,197,66,.05))', border: '1px solid rgba(245,197,66,.4)',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, minWidth: 200 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 14px', borderRadius: 20, background: 'linear-gradient(135deg,#f5c542,#e8964e)', color: '#1a1206', fontSize: 12, fontWeight: 700, letterSpacing: '.04em', boxShadow: '0 8px 26px -8px rgba(245,197,66,.8)' }}>👑 CHAMPION</span>
            <span style={{ width: 88, height: 88, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, fontWeight: 700, color: '#06170f', background: tintFor(champ.wallet), border: '3px solid rgba(245,197,66,.7)', boxShadow: '0 0 40px -8px rgba(245,197,66,.8)' }}>{name(champ).slice(0, 1).toUpperCase()}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 24, fontWeight: 700, color: champ.isMe ? COLORS.green : COLORS.text }}>{name(champ)}</span>
              {champ.isMe && <span style={{ padding: '2px 8px', borderRadius: 6, background: 'rgba(0,255,196,.14)', border: '1px solid rgba(0,255,196,.4)', fontSize: 10, fontWeight: 700, color: COLORS.green }}>YOU</span>}
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.2em', color: COLORS.muted }}>TAKES THE POT</div>
              <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: '-.02em', background: 'linear-gradient(120deg,#f5c542,#5cffd8)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{formatUsd(lootTotal)}</div>
            </div>
          </div>
          <div style={{ flex: '1 1 320px', minWidth: 280 }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.2em', color: COLORS.muted, marginBottom: 12 }}>CHAMPION LOOT · {formatUsd(lootTotal)}</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {allLoot.map((c, i) => (
                <RevealCard key={i} card={c} reducedMotion w={120} h={200} />
              ))}
            </div>
          </div>
        </section>
      )}

      <div style={{ borderRadius: 18, overflow: 'hidden', border: `1px solid ${COLORS.border}`, background: 'linear-gradient(180deg,rgba(255,255,255,.025),rgba(255,255,255,.008))' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderBottom: `1px solid ${COLORS.border}` }}>
          <span style={{ fontFamily: FONTS.display, fontSize: 15, fontWeight: 700, letterSpacing: '-.01em' }}>Final standings</span>
          <span style={{ fontFamily: FONTS.mono, fontSize: 11.5, color: COLORS.muted }}>{vm.players.length} players · pot {formatUsd(vm.potValue)}</span>
        </div>
        {ranked.map(({ p, rank }) => {
          const net = rank === 1 ? vm.potValue - entry : -entry
          return (
            <div key={p.wallet} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 18px', borderBottom: `1px solid #ffffff0a`, background: p.isMe ? 'rgba(0,255,196,.06)' : 'transparent' }}>
              <span style={{ flex: 'none', width: 30, textAlign: 'center', fontFamily: FONTS.mono, fontSize: 15, fontWeight: 700, color: medalColor(rank) }}>#{rank}</span>
              <span style={{ flex: 'none', width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#06170f', background: tintFor(p.wallet), border: `2px solid ${p.isMe ? 'rgba(0,255,196,.7)' : 'rgba(255,255,255,.12)'}` }}>{name(p).slice(0, 1).toUpperCase()}</span>
              <div style={{ flex: '1 1 120px', minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: p.isMe ? COLORS.green : COLORS.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name(p)}</span>
                {p.isMe && <span style={{ flex: 'none', padding: '1px 6px', borderRadius: 5, background: 'rgba(0,255,196,.14)', border: '1px solid rgba(0,255,196,.4)', fontSize: 9, fontWeight: 700, color: COLORS.green }}>YOU</span>}
              </div>
              <div style={{ flex: 'none', width: 74, textAlign: 'right' }}>
                <div style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: '.12em', color: '#6c7682' }}>LOOT</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#cdd4dd' }}>{formatUsd(p.total)}</div>
              </div>
              <div style={{ flex: 'none', width: 70, textAlign: 'right', fontSize: 14.5, fontWeight: 700, color: net >= 0 ? COLORS.green : '#ff8198' }}>
                {net >= 0 ? `+${formatUsd(net)}` : `-${formatUsd(Math.abs(net))}`}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 18, justifyContent: 'center' }}>
        <button onClick={onRematch} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 26px', borderRadius: 13, border: 0, cursor: 'pointer', fontFamily: FONTS.display, fontSize: 15, fontWeight: 700, color: '#06170f', background: GRADIENT, boxShadow: '0 0 22px -6px rgba(0,255,196,.7)' }}>↻ Rematch</button>
        <button onClick={onVerify} style={{ padding: '13px 22px', borderRadius: 13, border: `1px solid ${COLORS.border}`, background: '#ffffff08', color: COLORS.muted, cursor: 'pointer', fontFamily: FONTS.body, fontSize: 14, fontWeight: 600 }}>Verify (Provably Fair)</button>
        <button onClick={onExit} style={{ padding: '13px 26px', borderRadius: 13, border: `1px solid ${COLORS.border}`, background: '#ffffff08', color: COLORS.text, cursor: 'pointer', fontFamily: FONTS.body, fontSize: 15, fontWeight: 600 }}>Back to lobby</button>
      </div>
    </div>
  )
}

export { shortWallet }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/screens/battle/RoyaleReveal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full suite + type-check**

Run: `npx vitest run && npm run build`
Expected: all test files pass; `npm run build` prints `✓ built in …` with no TypeScript errors. (A `INVALID_ANNOTATION` warning from `node_modules/@privy-io/...` is pre-existing and unrelated.)

- [ ] **Step 6: Commit**

```bash
git add src/ui/screens/battle/RoyaleReveal.tsx src/ui/screens/battle/RoyaleReveal.test.tsx
git commit -m "feat(royale): cinematic one-by-one reveal with live leaderboard + round-break countdown"
```

---

## Task 6: Gate RoyaleResult on reveal completion in BattleFlow

**Files:**
- Modify: `src/ui/flows/BattleFlow.tsx:37` (add state) and `:170-176` (royale branch)

**Interfaces:**
- Consumes: `RoyaleReveal`'s new `onComplete?: () => void` prop (Task 5).

- [ ] **Step 1: Add the `royaleRevealDone` state**

In `src/ui/flows/BattleFlow.tsx`, next to the existing `const [revealDone, setRevealDone] = useState(false)` (line ~37), add:

```tsx
  const [royaleRevealDone, setRoyaleRevealDone] = useState(false)
```

- [ ] **Step 2: Gate the royale branch on it**

Replace the royale return block (currently lines ~170-176):

```tsx
  // royale: round-by-round grid while running; once every round is done (settled) the
  // separate result screen (champion + standings) replaces it — like the pack reveal.
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      {battle.status === 'settled'
        ? <RoyaleResult vm={vm} battleId={battle.id} onExit={exit} />
        : <RoyaleReveal vm={vm} reducedMotion={!!reduced} battleId={battle.id} />}
    </div>
  )
```

with:

```tsx
  // royale: cinematic round-by-round reveal while running AND until the final round finishes
  // animating (onComplete). Only then does the champion/standings result screen replace it —
  // like the pack reveal's revealDone gate.
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      {battle.status === 'settled' && royaleRevealDone
        ? <RoyaleResult vm={vm} battleId={battle.id} onExit={exit} />
        : <RoyaleReveal vm={vm} reducedMotion={!!reduced} battleId={battle.id} onComplete={() => setRoyaleRevealDone(true)} />}
    </div>
  )
```

- [ ] **Step 3: Run the related test + type-check**

Run: `npx vitest run src/ui/flows/BattleFlow.test.tsx && npm run build`
Expected: PASS; build succeeds with no TypeScript errors.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: all test files pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/flows/BattleFlow.tsx
git commit -m "feat(royale): hold RoyaleResult until the reveal animation finishes"
```

---

## Self-Review

**1. Spec coverage:**
- One-by-one reveal in seating order → Task 2 (`revealOrderWallets`, cursor) + Task 5 (`PlayerRevealCard`, `openingWallet`). ✅
- Live leaderboard by accumulated insured value → Task 3 + used in Task 5. ✅
- Blur + "La ronda X empezará en 5" countdown 5→0 with leaderboard below → Task 4 + Task 5 (`blurred` wrapper). ✅
- Countdown starts a new round at 0 → Task 2 scheduler (`countdown <= 0` → advance). ✅
- Finish gate so the final round animates before RoyaleResult → Task 6. ✅
- Reduced motion / already-settled / latecomer edge cases → Task 2 (reduced-motion effect; hold until settled). ✅
- "revealed-so-far" projection drives everything → Task 2 `project`. ✅

**2. Placeholder scan:** No TBD/TODO; every code step has complete code; every test step has real assertions. ✅

**3. Type consistency:**
- `RoyaleRevealState` fields (`phase, projection, revealRound, countdown, upcomingRound, openingWallet, justEliminated`) are produced in Task 2 and consumed exactly in Task 5. ✅
- `project(vm, round, card)`, `revealOrderWallets(vm, roundNumber)`, `totalRounds(vm)` signatures match between Task 2 definition and Task 5 usage (`totalRounds(vm)`). ✅
- `LiveLeaderboard({ vm, name, title? })` and `RoundBreakOverlay({ vm, name, upcomingRound, countdown })` match between their definitions (Tasks 3/4) and usage (Task 5). ✅
- `shortWallet` re-exported from `RoyaleReveal.tsx` keeps `BattleFlow`'s `import { shortWallet } from '../screens/battle/RoyaleReveal'` valid. ✅
- `RoyaleReveal` gains optional `onComplete` used by Task 6; existing callers without it stay valid (optional prop). ✅
