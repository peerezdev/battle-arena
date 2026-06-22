# Watch + result, live round-by-round reveal (#4b-3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A routed full-screen flow (`/play/battle/:battleId`) that polls a battle and reveals each player's pulls live, round by round (gacha-style, real card images by mint), culminating in the winner + pot recap — for royale (multi-round elimination) and pack (single round, 2–10 players).

**Architecture:** One scoped backend change exposes the pull recap during `running` (PF seed stays settle-only). The frontend adds a pure adapter (`battleToReveal`) that turns the polled `Battle` into a view-model, gacha-style reveal components driven entirely by the polled state, and a routed `BattleFlow` the Hub navigates to after create/join (replacing the #4b-2 `BattleWaiting` modal). Card images come directly from CollectorCrypt's `/front/{mint}` endpoint (no DAS, no persistence). Also opens the create modal to pack 2–10 players (backend already supports it).

**Tech Stack:** Backend FastAPI + SQLAlchemy (pytest, in-memory SQLite). Frontend React 19 + Vite + TypeScript, react-router, framer-motion, vitest + @testing-library/react. Inline-style components using `src/ui/theme.ts` tokens.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-22-watch-result-design.md`.
- **Backend tests** run from `backend/` with `.venv/bin/pytest`. **Frontend tests** run from repo root with `npm test` (`vitest run`); typecheck with `npx tsc --noEmit`.
- **No new dependencies.** Reuse `useBattle`, `packBattleClient` types, `theme` tokens (`COLORS/FONTS/RARITY/formatUsd`), `useEmbeddedSolanaAddress`, `useReducedMotion`, `framer-motion`, `ccAssetUrl`.
- **Secrecy-safe backend split:** `get_battle` includes `pulls` for ALL statuses; `server_seed`/`client_seed`/`tie_break_index` remain **settle-only**. Never expose the seed pre-settle.
- **Card image:** `ccCardImageUrl(mint)` = `https://nft-dev.collectorcrypt.com/front/${mint}` (devnet; CC 302-redirects to the image and falls back to a placeholder server-side). Used directly as `<img src>`, `onError` → 🃏 fallback. No DAS, no backend image persistence.
- **Rarity colors:** key `theme.RARITY` on `rarity?.toLowerCase()` (backend sends `"Epic"`, `"common"`, …); unknown → `COLORS.muted`.
- **Pack pulls** default to `round_number = 1` → adapter groups them into one round group keyed `1`. Royale → one group per round, ascending.
- **"Me"** = `wallet === useEmbeddedSolanaAddress()`; spectators (`meWallet == null`) see the reveal with nothing marked "tú".
- **Reveal is polling-driven:** cards flip / eliminations mark as `useBattle` re-polls; framer-motion is decoration only (respect `useReducedMotion`).
- **Out of scope (do NOT build):** PF verify panel (#4d), money/reserved/cancel UI (#4c), multi-pack pack battles (#4e), engine/PF/pacing changes, online mana.

---

### Task 1: Backend — `get_battle` exposes `pulls` during running (seed stays settle-only)

**Files:**
- Modify: `backend/app/services/pack_lobby.py` (`get_battle`, ~line 107-116)
- Test: `backend/tests/test_pack_lobby.py` (update `test_get_battle_royale_live_state_no_cards`)

**Interfaces:**
- Produces: `get_battle` always includes `pulls: _pull_recap(...)`; `server_seed`/`client_seed`/`tie_break_index` only when `status == "settled"`.

- [ ] **Step 1: Update the failing test**

In `backend/tests/test_pack_lobby.py`, replace `test_get_battle_royale_live_state_no_cards` (the `running` battle, ~lines 71-90) with a version that adds pulls and asserts they are exposed while the seed is not:

```python
def test_get_battle_running_reveals_pulls_but_not_seed(session):
    from app.models import BattleRound, BattlePull
    b = PackBattle(id="rv", mode="royale", machine_code="m", price=50, max_players=3,
                   status="running", server_seed="ab" * 32, server_seed_hash="h", creator_wallet="A")
    session.add(b)
    session.add_all([
        BattlePlayer(battle_id="rv", player_wallet="A", eliminated_round=None, accumulated_value=120.0),
        BattlePlayer(battle_id="rv", player_wallet="B", eliminated_round=1, accumulated_value=40.0),
    ])
    session.add(BattleRound(battle_id="rv", round_number=1, client_seed="cs1",
                            eliminated_wallet="B", tie_break_index=None))
    # one resolved pull + one still "pending" (nft_address is None)
    session.add_all([
        BattlePull(battle_id="rv", player_wallet="A", memo="m1", round_number=1,
                   nft_address="nftA", rarity="Epic", insured_value=120.0, auto_sold=False),
        BattlePull(battle_id="rv", player_wallet="B", memo="m2", round_number=2, nft_address=None),
    ])
    session.commit()
    v = get_battle(session, "rv")
    assert v["creator_wallet"] == "A"
    assert v["rounds"] == [{"round_number": 1, "eliminated_wallet": "B", "tie_break_index": None}]
    # pulls ARE exposed during running (live reveal)
    assert {p["player_wallet"] for p in v["pulls"]} == {"A", "B"}
    pending = next(p for p in v["pulls"] if p["player_wallet"] == "B")
    assert pending["nft_address"] is None
    # ...but the PF seed is NOT revealed pre-settle
    assert "server_seed" not in v and "client_seed" not in v and "tie_break_index" not in v
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `.venv/bin/pytest tests/test_pack_lobby.py::test_get_battle_running_reveals_pulls_but_not_seed -v`
Expected: FAIL with `KeyError: 'pulls'`.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/services/pack_lobby.py`, change `get_battle`'s tail (currently the `if b.status == "settled":` block that adds seeds + pulls together):

```python
    out = {"id": b.id, "mode": b.mode, "machine_code": b.machine_code, "price": b.price,
           "max_players": b.max_players, "status": b.status, "winner": b.winner,
           "creator_wallet": b.creator_wallet,
           "players": _player_states(session, battle_id),
           "rounds": _rounds(session, battle_id),
           "server_seed_hash": b.server_seed_hash,
           "pulls": _pull_recap(session, battle_id)}   # card recap is live (safe; the seed is not)
    if b.status == "settled":   # PF seed reveal ONLY post-settle (predicting future rounds must stay impossible)
        out.update(server_seed=b.server_seed, client_seed=b.client_seed,
                   tie_break_index=b.tie_break_index)
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `backend/`): `.venv/bin/pytest tests/test_pack_lobby.py -v`
Expected: PASS — the new test, plus `test_get_battle_hides_server_seed_until_settled` and `test_get_battle_postsettle_pull_recap` stay green (settle still reveals seed + pulls; pre-settle still hides the seed).

Then the API + royale-state suites for no regression:
Run: `.venv/bin/pytest tests/test_pack_lobby_api.py tests/test_royale_engine.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/pack_lobby.py backend/tests/test_pack_lobby.py
git commit -m "feat(be): get_battle exposes pulls during running (seed stays settle-only) (#4b-3)"
```

---

### Task 2: `ccCardImageUrl` helper

**Files:**
- Modify: `src/onchain/gachaClient.ts` (add near `ccAssetUrl`, ~line 175)
- Test: `src/onchain/gachaClient.test.ts`

**Interfaces:**
- Produces: `ccCardImageUrl(mint: string): string` → `https://nft-dev.collectorcrypt.com/front/${mint}`.

- [ ] **Step 1: Write the failing test**

Add to `src/onchain/gachaClient.test.ts`:

```ts
import { ccCardImageUrl } from './gachaClient'

describe('ccCardImageUrl', () => {
  it('returns the CC devnet front-image endpoint for a mint', () => {
    expect(ccCardImageUrl('7mNc3Hr1Aqr16u8Y5VKQDinLHbBumUxV6T6kxFRz2xGH'))
      .toBe('https://nft-dev.collectorcrypt.com/front/7mNc3Hr1Aqr16u8Y5VKQDinLHbBumUxV6T6kxFRz2xGH')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- gachaClient`
Expected: FAIL — `ccCardImageUrl` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/onchain/gachaClient.ts`, just below `ccAssetUrl`:

```ts
// CollectorCrypt serves the card front image by mint (302 → CDN image; placeholder if missing).
// Devnet base; usable directly as an <img src>. https://docs.collectorcrypt.com/metadata
export function ccCardImageUrl(mint: string): string {
  return `https://nft-dev.collectorcrypt.com/front/${mint}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- gachaClient`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/onchain/gachaClient.ts src/onchain/gachaClient.test.ts
git commit -m "feat(fe): ccCardImageUrl (CC front-image by mint) (#4b-3)"
```

---

### Task 3: `battleToReveal` adapter + `RevealVM` types

**Files:**
- Create: `src/ui/screens/battle/battleReveal.ts`
- Create: `src/ui/screens/battle/battleReveal.test.ts`

**Interfaces:**
- Consumes: `Battle`, `BattleMode`, `BattleStatus`, `BattlePullInfo` from `../../../onchain/packBattleClient`.
- Produces: types `RevealCardVM`, `RevealRoundVM`, `RevealPlayerVM`, `RevealVM`, and `battleToReveal(battle: Battle, meWallet: string | null): RevealVM`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/screens/battle/battleReveal.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { battleToReveal } from './battleReveal'
import type { Battle } from '../../../onchain/packBattleClient'

const base: Battle = {
  id: 'b1', mode: 'royale', machine_code: 'm', price: 50, max_players: 3,
  status: 'running', winner: null, creator_wallet: 'A',
  players: [
    { wallet: 'A', eliminated_round: null, accumulated_value: 120 },
    { wallet: 'B', eliminated_round: 1, accumulated_value: 40 },
  ],
  rounds: [{ round_number: 1, eliminated_wallet: 'B', tie_break_index: null }],
  server_seed_hash: 'h',
  pulls: [
    { round_number: 1, player_wallet: 'A', nft_address: 'nftA', rarity: 'Epic', insured_value: 120, auto_sold: false },
    { round_number: 1, player_wallet: 'B', nft_address: 'nftB', rarity: 'common', insured_value: 40, auto_sold: true },
    { round_number: 2, player_wallet: 'A', nft_address: null, rarity: null, insured_value: null, auto_sold: false },
  ],
}

describe('battleToReveal', () => {
  it('groups royale pulls by round and pulls elimination from rounds', () => {
    const vm = battleToReveal(base, 'A')
    expect(vm.rounds.map((r) => r.roundNumber)).toEqual([1, 2])
    expect(vm.rounds[0].eliminatedWallet).toBe('B')
    expect(vm.rounds[1].eliminatedWallet).toBeNull()           // round 2 not decided yet
    expect(vm.rounds[0].cards.map((c) => c.wallet)).toEqual(['A', 'B'])
    expect(vm.rounds[1].cards[0].nftAddress).toBeNull()        // pending
    expect(vm.players.find((p) => p.wallet === 'A')!.isMe).toBe(true)
    expect(vm.potValue).toBe(160)                              // 120 + 40, pending null ignored
  })

  it('groups pack pulls (round_number 1) into a single round', () => {
    const packBattle: Battle = {
      ...base, mode: 'pack', status: 'settled', winner: 'A', rounds: [],
      pulls: [
        { round_number: 1, player_wallet: 'A', nft_address: 'nftA', rarity: 'Rare', insured_value: 300, auto_sold: false },
        { round_number: 1, player_wallet: 'B', nft_address: 'nftB', rarity: 'common', insured_value: 10, auto_sold: false },
      ],
    }
    const vm = battleToReveal(packBattle, 'B')
    expect(vm.rounds).toHaveLength(1)
    expect(vm.rounds[0].roundNumber).toBe(1)
    expect(vm.rounds[0].cards).toHaveLength(2)
    expect(vm.winner).toBe('A')
    expect(vm.players.find((p) => p.wallet === 'B')!.isMe).toBe(true)
  })

  it('handles a battle with no pulls yet', () => {
    const vm = battleToReveal({ ...base, pulls: [] }, null)
    expect(vm.rounds).toEqual([])
    expect(vm.potValue).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- battleReveal`
Expected: FAIL — "Cannot find module './battleReveal'".

- [ ] **Step 3: Write minimal implementation**

Create `src/ui/screens/battle/battleReveal.ts`:

```ts
import type { Battle, BattleMode, BattleStatus, BattlePullInfo } from '../../../onchain/packBattleClient'

export interface RevealCardVM {
  wallet: string; isMe: boolean; nftAddress: string | null
  rarity: string | null; insuredValue: number | null; autoSold: boolean
}
export interface RevealRoundVM {
  roundNumber: number; eliminatedWallet: string | null; cards: RevealCardVM[]
}
export interface RevealPlayerVM {
  wallet: string; isMe: boolean; accumulatedValue: number; eliminatedRound: number | null
}
export interface RevealVM {
  mode: BattleMode; status: BattleStatus; winner: string | null; meWallet: string | null
  players: RevealPlayerVM[]; rounds: RevealRoundVM[]; potValue: number
}

export function battleToReveal(battle: Battle, meWallet: string | null): RevealVM {
  const pulls: BattlePullInfo[] = battle.pulls ?? []

  // group pulls by round_number (ascending)
  const byRound = new Map<number, BattlePullInfo[]>()
  for (const p of pulls) {
    const arr = byRound.get(p.round_number) ?? []
    arr.push(p)
    byRound.set(p.round_number, arr)
  }
  const elimByRound = new Map<number, string>()
  for (const r of battle.rounds) elimByRound.set(r.round_number, r.eliminated_wallet)

  const rounds: RevealRoundVM[] = [...byRound.keys()]
    .sort((a, b) => a - b)
    .map((rn) => ({
      roundNumber: rn,
      eliminatedWallet: elimByRound.get(rn) ?? null,
      cards: byRound.get(rn)!.map((p) => ({
        wallet: p.player_wallet,
        isMe: p.player_wallet === meWallet,
        nftAddress: p.nft_address,
        rarity: p.rarity,
        insuredValue: p.insured_value,
        autoSold: p.auto_sold,
      })),
    }))

  const players: RevealPlayerVM[] = battle.players.map((p) => ({
    wallet: p.wallet,
    isMe: p.wallet === meWallet,
    accumulatedValue: p.accumulated_value,
    eliminatedRound: p.eliminated_round,
  }))

  const potValue = pulls.reduce((s, p) => s + (p.insured_value ?? 0), 0)

  return { mode: battle.mode, status: battle.status, winner: battle.winner, meWallet, players, rounds, potValue }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- battleReveal`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/battle/battleReveal.ts src/ui/screens/battle/battleReveal.test.ts
git commit -m "feat(fe): battleToReveal adapter (Battle -> reveal view-model) (#4b-3)"
```

---

### Task 4: `RevealCard` (gacha-style card tile)

**Files:**
- Create: `src/ui/screens/battle/RevealCard.tsx`
- Create: `src/ui/screens/battle/RevealCard.test.tsx`

**Interfaces:**
- Consumes: `RevealCardVM` (Task 3), `ccCardImageUrl` (Task 2), `theme` (`COLORS/FONTS/RARITY/formatUsd`).
- Produces: `RevealCard({ card, reducedMotion }: { card: RevealCardVM; reducedMotion: boolean }): JSX.Element`. Helper `rarityColor(rarity: string | null): string` (exported for reuse/test).

- [ ] **Step 1: Write the failing test**

Create `src/ui/screens/battle/RevealCard.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RevealCard, rarityColor } from './RevealCard'
import { RARITY, COLORS } from '../../theme'

const card = {
  wallet: 'A', isMe: true, nftAddress: 'nftA', rarity: 'Epic', insuredValue: 120, autoSold: false,
}

describe('RevealCard', () => {
  it('shows a face-down opening state when the pull is pending', () => {
    render(<RevealCard card={{ ...card, nftAddress: null }} reducedMotion />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText(/abriendo/i)).toBeTruthy()
  })

  it('shows the card image (by mint) once resolved', () => {
    render(<RevealCard card={card} reducedMotion />)
    const img = screen.getByRole('img') as HTMLImageElement
    expect(img.src).toBe('https://nft-dev.collectorcrypt.com/front/nftA')
    expect(screen.getByText('$120')).toBeTruthy()
  })

  it('marks auto-sold cards', () => {
    render(<RevealCard card={{ ...card, autoSold: true }} reducedMotion />)
    expect(screen.getByText(/auto-sold/i)).toBeTruthy()
  })

  it('maps rarity case-insensitively, unknown → muted', () => {
    expect(rarityColor('Epic')).toBe(RARITY.epic)
    expect(rarityColor('common')).toBe(RARITY.common)
    expect(rarityColor(null)).toBe(COLORS.muted)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- RevealCard`
Expected: FAIL — "Cannot find module './RevealCard'".

- [ ] **Step 3: Write minimal implementation**

Create `src/ui/screens/battle/RevealCard.tsx`:

```tsx
import { useState } from 'react'
import { COLORS, FONTS, RARITY, formatUsd } from '../../theme'
import { ccCardImageUrl } from '../../../onchain/gachaClient'
import type { RevealCardVM } from './battleReveal'

export function rarityColor(rarity: string | null): string {
  const key = (rarity ?? '').toLowerCase()
  return (RARITY as Record<string, string>)[key] ?? COLORS.muted
}

export function RevealCard({ card, reducedMotion }: { card: RevealCardVM; reducedMotion: boolean }) {
  const [imgError, setImgError] = useState(false)
  const color = rarityColor(card.rarity)

  if (!card.nftAddress) {
    // pending: face-down "opening…" tile
    return (
      <div style={{
        width: 92, height: 128, borderRadius: 10, border: `1px solid ${COLORS.border}`,
        background: 'linear-gradient(160deg,#1b2236,#11161f)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6,
      }}>
        <span style={{ fontSize: 26, opacity: reducedMotion ? 1 : 0.8 }}>🂠</span>
        <span style={{ fontFamily: FONTS.mono, fontSize: 9.5, color: COLORS.muted }}>abriendo…</span>
      </div>
    )
  }

  return (
    <div style={{
      width: 92, borderRadius: 10, border: `1px solid ${color}`, background: COLORS.panel,
      overflow: 'hidden', boxShadow: card.isMe ? `0 0 0 2px ${COLORS.green}55` : 'none',
    }}>
      <div style={{ height: 100, background: '#0c1019', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {imgError
          ? <span style={{ fontSize: 34 }}>🃏</span>
          : <img src={ccCardImageUrl(card.nftAddress)} alt="" onError={() => setImgError(true)}
                 style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
      </div>
      <div style={{ padding: '5px 7px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 12, color }}>
          {formatUsd(card.insuredValue ?? 0)}
        </span>
        {card.autoSold && (
          <span style={{ fontFamily: FONTS.mono, fontSize: 8.5, color: COLORS.muted }}>⚡ auto-sold</span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- RevealCard` then `npx tsc --noEmit`
Expected: tests PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/battle/RevealCard.tsx src/ui/screens/battle/RevealCard.test.tsx
git commit -m "feat(fe): RevealCard gacha-style tile (CC image, rarity, pending) (#4b-3)"
```

---

### Task 5: `RoyaleReveal` (live round-by-round)

**Files:**
- Create: `src/ui/screens/battle/RoyaleReveal.tsx`
- Create: `src/ui/screens/battle/RoyaleReveal.test.tsx`

**Interfaces:**
- Consumes: `RevealVM` (Task 3), `RevealCard` (Task 4), `theme`.
- Produces: `RoyaleReveal({ vm, reducedMotion }: { vm: RevealVM; reducedMotion: boolean }): JSX.Element`. Helper `shortWallet(w: string): string` (exported).

- [ ] **Step 1: Write the failing test**

Create `src/ui/screens/battle/RoyaleReveal.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RoyaleReveal } from './RoyaleReveal'
import type { RevealVM } from './battleReveal'

const vm: RevealVM = {
  mode: 'royale', status: 'running', winner: null, meWallet: 'A',
  players: [
    { wallet: 'A', isMe: true, accumulatedValue: 120, eliminatedRound: null },
    { wallet: 'B', isMe: false, accumulatedValue: 40, eliminatedRound: 1 },
  ],
  rounds: [
    { roundNumber: 1, eliminatedWallet: 'B', cards: [
      { wallet: 'A', isMe: true, nftAddress: 'nftA', rarity: 'Epic', insuredValue: 120, autoSold: false },
      { wallet: 'B', isMe: false, nftAddress: null, rarity: null, insuredValue: null, autoSold: false },
    ] },
  ],
  potValue: 120,
}

describe('RoyaleReveal', () => {
  it('renders the round cards (resolved + pending) and marks the eliminated player', () => {
    render(<RoyaleReveal vm={vm} reducedMotion />)
    expect(screen.getByRole('img')).toBeTruthy()          // A's resolved card
    expect(screen.getByText(/abriendo/i)).toBeTruthy()    // B's pending card
    expect(screen.getByText(/Ronda 1/i)).toBeTruthy()
    expect(screen.getAllByText(/eliminad/i).length).toBeGreaterThan(0)  // B marked out
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- RoyaleReveal`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

Create `src/ui/screens/battle/RoyaleReveal.tsx`:

```tsx
import { COLORS, FONTS, formatUsd } from '../../theme'
import { RevealCard } from './RevealCard'
import type { RevealVM } from './battleReveal'

export function shortWallet(w: string): string {
  return w.length > 9 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w
}

export function RoyaleReveal({ vm, reducedMotion }: { vm: RevealVM; reducedMotion: boolean }) {
  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {vm.rounds.map((round) => (
        <div key={round.roundNumber}>
          <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 14, color: COLORS.text, marginBottom: 10 }}>
            Ronda {round.roundNumber}
            {round.eliminatedWallet && (
              <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.red, marginLeft: 10 }}>
                {shortWallet(round.eliminatedWallet)} eliminado
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {round.cards.map((card) => {
              const isElim = card.wallet === round.eliminatedWallet
              const player = vm.players.find((p) => p.wallet === card.wallet)
              return (
                <div key={card.wallet} style={{ opacity: isElim ? 0.55 : 1, textAlign: 'center' }}>
                  <RevealCard card={card} reducedMotion={reducedMotion} />
                  <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: card.isMe ? COLORS.green : COLORS.muted, marginTop: 5 }}>
                    {card.isMe ? 'tú' : shortWallet(card.wallet)}
                  </div>
                  {player && (
                    <div style={{ fontFamily: FONTS.mono, fontSize: 9.5, color: COLORS.muted }}>
                      {formatUsd(player.accumulatedValue)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- RoyaleReveal` then `npx tsc --noEmit`
Expected: tests PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/battle/RoyaleReveal.tsx src/ui/screens/battle/RoyaleReveal.test.tsx
git commit -m "feat(fe): RoyaleReveal live round-by-round reveal (#4b-3)"
```

---

### Task 6: `PackReveal` (1v1…10, single round)

**Files:**
- Create: `src/ui/screens/battle/PackReveal.tsx`
- Create: `src/ui/screens/battle/PackReveal.test.tsx`

**Interfaces:**
- Consumes: `RevealVM` (Task 3), `RevealCard` (Task 4), `shortWallet` from `./RoyaleReveal`, `theme`.
- Produces: `PackReveal({ vm, reducedMotion }: { vm: RevealVM; reducedMotion: boolean }): JSX.Element`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/screens/battle/PackReveal.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PackReveal } from './PackReveal'
import type { RevealVM } from './battleReveal'

const vm: RevealVM = {
  mode: 'pack', status: 'settled', winner: 'A', meWallet: 'B',
  players: [
    { wallet: 'A', isMe: false, accumulatedValue: 0, eliminatedRound: null },
    { wallet: 'B', isMe: true, accumulatedValue: 0, eliminatedRound: null },
  ],
  rounds: [
    { roundNumber: 1, eliminatedWallet: null, cards: [
      { wallet: 'A', isMe: false, nftAddress: 'nftA', rarity: 'Rare', insuredValue: 300, autoSold: false },
      { wallet: 'B', isMe: true, nftAddress: 'nftB', rarity: 'common', insuredValue: 10, autoSold: false },
    ] },
  ],
  potValue: 310,
}

describe('PackReveal', () => {
  it('renders both cards and highlights the winner once settled', () => {
    render(<PackReveal vm={vm} reducedMotion />)
    expect(screen.getAllByRole('img')).toHaveLength(2)
    expect(screen.getByText(/ganador/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- PackReveal`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

Create `src/ui/screens/battle/PackReveal.tsx`:

```tsx
import { COLORS, FONTS } from '../../theme'
import { RevealCard } from './RevealCard'
import { shortWallet } from './RoyaleReveal'
import type { RevealVM } from './battleReveal'

export function PackReveal({ vm, reducedMotion }: { vm: RevealVM; reducedMotion: boolean }) {
  const cards = vm.rounds[0]?.cards ?? []
  const settled = vm.status === 'settled'
  return (
    <div style={{ padding: '16px', display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
      {cards.map((card) => {
        const isWinner = settled && card.wallet === vm.winner
        return (
          <div key={card.wallet} style={{ textAlign: 'center' }}>
            <RevealCard card={card} reducedMotion={reducedMotion} />
            <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: card.isMe ? COLORS.green : COLORS.muted, marginTop: 5 }}>
              {card.isMe ? 'tú' : shortWallet(card.wallet)}
            </div>
            {isWinner && (
              <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 11, color: COLORS.green, marginTop: 2 }}>
                🏆 Ganador
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- PackReveal` then `npx tsc --noEmit`
Expected: tests PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/battle/PackReveal.tsx src/ui/screens/battle/PackReveal.test.tsx
git commit -m "feat(fe): PackReveal 1v1..10 single-round reveal (#4b-3)"
```

---

### Task 7: `BattleResult` (winner + pot recap)

**Files:**
- Create: `src/ui/screens/battle/BattleResult.tsx`
- Create: `src/ui/screens/battle/BattleResult.test.tsx`

**Interfaces:**
- Consumes: `RevealVM` (Task 3), `shortWallet` from `./RoyaleReveal`, `theme`.
- Produces: `BattleResult({ vm, onExit }: { vm: RevealVM; onExit: () => void }): JSX.Element`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/screens/battle/BattleResult.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BattleResult } from './BattleResult'
import type { RevealVM } from './battleReveal'

const baseVm: RevealVM = {
  mode: 'royale', status: 'settled', winner: 'A', meWallet: 'A',
  players: [], rounds: [], potValue: 160,
}

describe('BattleResult', () => {
  it('celebrates when I am the winner and shows the pot', () => {
    render(<BattleResult vm={baseVm} onExit={() => {}} />)
    expect(screen.getByText(/ganaste/i)).toBeTruthy()
    expect(screen.getByText('$160')).toBeTruthy()
  })

  it('shows the winner wallet when it is not me, and Volver works', () => {
    const onExit = vi.fn()
    render(<BattleResult vm={{ ...baseVm, meWallet: 'B' }} onExit={onExit} />)
    expect(screen.queryByText(/ganaste/i)).toBeNull()
    fireEvent.click(screen.getByText(/volver/i))
    expect(onExit).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- BattleResult`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

Create `src/ui/screens/battle/BattleResult.tsx`:

```tsx
import { COLORS, FONTS, formatUsd } from '../../theme'
import { shortWallet } from './RoyaleReveal'
import type { RevealVM } from './battleReveal'

export function BattleResult({ vm, onExit }: { vm: RevealVM; onExit: () => void }) {
  const iWon = vm.winner != null && vm.winner === vm.meWallet
  return (
    <div style={{ padding: '24px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 22, color: iWon ? COLORS.green : COLORS.text }}>
        {iWon ? '🏆 ¡Ganaste!' : 'Batalla terminada'}
      </div>
      {!iWon && vm.winner && (
        <div style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.muted }}>
          Ganador: {shortWallet(vm.winner)}
        </div>
      )}
      <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted }}>Bote</div>
      <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 28, color: COLORS.green }}>
        {formatUsd(vm.potValue)}
      </div>
      <button onClick={onExit} style={{
        marginTop: 12, background: '#0c1019', color: COLORS.text, border: `1px solid ${COLORS.border}`,
        borderRadius: 10, padding: '10px 22px', fontWeight: 700, cursor: 'pointer',
      }}>
        Volver
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- BattleResult` then `npx tsc --noEmit`
Expected: tests PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/battle/BattleResult.tsx src/ui/screens/battle/BattleResult.test.tsx
git commit -m "feat(fe): BattleResult winner + pot recap (#4b-3)"
```

---

### Task 8: `BattleFlow` routed shell + route

**Files:**
- Create: `src/ui/flows/BattleFlow.tsx`
- Create: `src/ui/flows/BattleFlow.test.tsx`
- Modify: `src/App.tsx` (add the route)
- Modify: `src/ui/layouts/navRoutes.ts` (`activeNavFromPath`)

**Interfaces:**
- Consumes: `useBattle` (`src/onchain/useBattle.ts`), `useEmbeddedSolanaAddress` (`src/wallet/embedded.ts`), `useReducedMotion` (`src/ui/useReducedMotion.ts`), `useParams`/`useNavigate` (react-router-dom), `battleToReveal` (Task 3), `RoyaleReveal`/`PackReveal`/`BattleResult` (Tasks 5/6/7), `theme`.
- Produces: `BattleFlow(): JSX.Element` (reads `:battleId`). Route `/play/battle/:battleId`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/flows/BattleFlow.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../onchain/useBattle', () => ({ useBattle: vi.fn() }))
vi.mock('../../wallet/embedded', () => ({ useEmbeddedSolanaAddress: () => 'A' }))
vi.mock('react-router-dom', () => ({ useParams: () => ({ battleId: 'b1' }), useNavigate: () => vi.fn() }))
import { useBattle } from '../../onchain/useBattle'
import { BattleFlow } from './BattleFlow'

const mockUseBattle = useBattle as unknown as ReturnType<typeof vi.fn>
const royaleRunning = {
  id: 'b1', mode: 'royale', machine_code: 'm', price: 50, max_players: 3, status: 'running',
  winner: null, creator_wallet: 'A', server_seed_hash: 'h',
  players: [{ wallet: 'A', eliminated_round: null, accumulated_value: 120 }],
  rounds: [], pulls: [{ round_number: 1, player_wallet: 'A', nft_address: 'nftA', rarity: 'Epic', insured_value: 120, auto_sold: false }],
}

describe('BattleFlow', () => {
  beforeEach(() => mockUseBattle.mockReset())

  it('shows the waiting room in lobby', () => {
    mockUseBattle.mockReturnValue({ battle: { ...royaleRunning, status: 'lobby', pulls: [] }, loading: false, error: null })
    render(<BattleFlow />)
    expect(screen.getByText(/esperando/i)).toBeTruthy()
  })

  it('renders the royale reveal while running', () => {
    mockUseBattle.mockReturnValue({ battle: royaleRunning, loading: false, error: null })
    render(<BattleFlow />)
    expect(screen.getByText(/Ronda 1/i)).toBeTruthy()
  })

  it('shows the result once settled', () => {
    mockUseBattle.mockReturnValue({ battle: { ...royaleRunning, status: 'settled', winner: 'A' }, loading: false, error: null })
    render(<BattleFlow />)
    expect(screen.getByText(/ganaste/i)).toBeTruthy()
  })

  it('shows the voided message', () => {
    mockUseBattle.mockReturnValue({ battle: { ...royaleRunning, status: 'voided' }, loading: false, error: null })
    render(<BattleFlow />)
    expect(screen.getByText(/anulad/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- BattleFlow`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

Create `src/ui/flows/BattleFlow.tsx`:

```tsx
import { type ReactNode, type CSSProperties } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { COLORS, FONTS } from '../theme'
import { useBattle } from '../../onchain/useBattle'
import { useEmbeddedSolanaAddress } from '../../wallet/embedded'
import { useReducedMotion } from '../useReducedMotion'
import { battleToReveal } from '../screens/battle/battleReveal'
import { RoyaleReveal } from '../screens/battle/RoyaleReveal'
import { PackReveal } from '../screens/battle/PackReveal'
import { BattleResult } from '../screens/battle/BattleResult'

function Centered({ children }: { children: ReactNode }) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 12, padding: 24, textAlign: 'center', color: COLORS.text }}>
      {children}
    </div>
  )
}

export function BattleFlow() {
  const { battleId } = useParams<{ battleId: string }>()
  const navigate = useNavigate()
  const meWallet = useEmbeddedSolanaAddress()
  const reduced = useReducedMotion()
  const { battle, error } = useBattle(battleId ?? null, 1500)
  const exit = () => navigate('/app')

  if (!battle) {
    return <Centered>
      <div style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.muted }}>
        {error ? 'reconectando…' : 'Cargando batalla…'}
      </div>
    </Centered>
  }

  if (battle.status === 'lobby') {
    return <Centered>
      <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 18 }}>Esperando jugadores</div>
      <div style={{ fontFamily: FONTS.mono, fontSize: 24, color: COLORS.green }}>
        {battle.players.length}/{battle.max_players}
      </div>
      <button onClick={exit} style={backBtn}>Volver</button>
    </Centered>
  }

  if (battle.status === 'voided' || battle.status === 'cancelled') {
    return <Centered>
      <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 18 }}>
        {battle.status === 'voided' ? 'Batalla anulada — reembolsado' : 'Lobby cancelado'}
      </div>
      <button onClick={exit} style={backBtn}>Volver</button>
    </Centered>
  }

  // running | settled → reveal (+ result when settled)
  const vm = battleToReveal(battle, meWallet)
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      {vm.mode === 'royale'
        ? <RoyaleReveal vm={vm} reducedMotion={!!reduced} />
        : <PackReveal vm={vm} reducedMotion={!!reduced} />}
      {battle.status === 'settled' && <BattleResult vm={vm} onExit={exit} />}
    </div>
  )
}

const backBtn: CSSProperties = {
  marginTop: 8, background: '#0c1019', color: COLORS.text, border: `1px solid ${COLORS.border}`,
  borderRadius: 10, padding: '10px 22px', fontWeight: 700, cursor: 'pointer',
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- BattleFlow`
Expected: PASS (4 cases).

- [ ] **Step 5: Add the route + nav mapping**

In `src/App.tsx`, add the import and a route inside the `<Route element={<AppShell />}>` group (next to the other `/play/...` routes):

```tsx
import { BattleFlow } from './ui/flows/BattleFlow'
```
```tsx
<Route path="/play/battle/:battleId" element={<BattleFlow />} />
```

In `src/ui/layouts/navRoutes.ts`, in `activeNavFromPath`, add (before the `/app` check):

```ts
  if (pathname.startsWith('/play/battle')) return 'lobby'
```

- [ ] **Step 6: Typecheck + run the touched tests**

Run: `npx tsc --noEmit` then `npm test -- BattleFlow navRoutes`
Expected: no type errors; tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/flows/BattleFlow.tsx src/ui/flows/BattleFlow.test.tsx src/App.tsx src/ui/layouts/navRoutes.ts
git commit -m "feat(fe): BattleFlow routed watch/result shell at /play/battle/:id (#4b-3)"
```

---

### Task 9: Open the create modal to pack 2–10 players

**Files:**
- Modify: `src/ui/screens/Hub/createBattleBody.ts`
- Modify: `src/ui/screens/Hub/createBattleBody.test.ts`
- Modify: `src/ui/screens/Hub/CreateBattleModal.tsx`

**Interfaces:**
- Produces: `buildCreateBody(mode, machineCode, players)` returns `max_players = players` for BOTH modes (pack no longer forced to 2).

- [ ] **Step 1: Update the test**

In `src/ui/screens/Hub/createBattleBody.test.ts`, replace the pack assertion so pack uses the chosen count:

```ts
import { describe, it, expect } from 'vitest'
import { buildCreateBody } from './createBattleBody'

describe('buildCreateBody', () => {
  it('uses the chosen player count for pack (2-10 supported by the backend)', () => {
    expect(buildCreateBody('pack', 'pokemon_50', 5)).toEqual({
      machine_code: 'pokemon_50', max_players: 5, mode: 'pack',
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

Run: `npm test -- createBattleBody`
Expected: FAIL — pack currently returns `max_players: 2`.

- [ ] **Step 3: Update the implementation**

In `src/ui/screens/Hub/createBattleBody.ts`, drop the pack special-case:

```ts
import type { BattleMode } from '../../../onchain/packBattleClient'

export function buildCreateBody(
  mode: BattleMode, machineCode: string, players: number,
): { machine_code: string; max_players: number; mode: BattleMode } {
  return { machine_code: machineCode, mode, max_players: players }
}
```

- [ ] **Step 4: Show the player selector for pack in the modal**

In `src/ui/screens/Hub/CreateBattleModal.tsx`: the player-count selector is currently gated on `mode === 'royale'`. Change it to show for **both** modes (the `ROYALE_COUNTS` list `[3,4,5,6,8,10]` becomes the player options; add `2` so pack can be 1v1). Replace the `const ROYALE_COUNTS = [3, 4, 5, 6, 8, 10]` line with:

```tsx
const PLAYER_COUNTS = [2, 3, 4, 5, 6, 8, 10]
```

Change the `submit` call to pass `players` for both modes (it already does, since `buildCreateBody(mode, machineCode, players)` no longer forces 2). Change the selector's render guard from `{mode === 'royale' && (` to always render, using `PLAYER_COUNTS`, and update its `.map` from `ROYALE_COUNTS` to `PLAYER_COUNTS`. Update the label to "Jugadores" (already is). Ensure the default `players` state remains valid (e.g. keep `useState(4)`).

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -- createBattleBody` then `npx tsc --noEmit`
Expected: tests PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/ui/screens/Hub/createBattleBody.ts src/ui/screens/Hub/createBattleBody.test.ts src/ui/screens/Hub/CreateBattleModal.tsx
git commit -m "feat(fe): allow pack 2-10 players in create modal (backend already supports it) (#4b-3)"
```

---

### Task 10: Hub wiring — navigate to the flow, remove the BattleWaiting modal

**Files:**
- Modify: `src/ui/screens/Hub/Hub.tsx`
- Delete: `src/ui/screens/Hub/BattleWaiting.tsx`
- Delete: `src/ui/screens/Hub/BattleWaiting.test.tsx`

**Interfaces:**
- Consumes: `BattleFlow` route `/play/battle/:id` (Task 8). No new exports.

- [ ] **Step 1: Rewire `Hub.tsx`**

In `src/ui/screens/Hub/Hub.tsx`:
- Remove the `BattleWaiting` import and the `import { BattleWaiting } ...` line.
- Remove the `waitingId` state and the `{waitingId && <BattleWaiting .../>}` render.
- In `onBattleAction`: Watch → `navigate('/play/battle/' + b.id)`; Join → inside the gate callback, after `await joinBattle(identityToken, b.id)`, call `navigate('/play/battle/' + b.id)` (instead of `setWaitingId`).
- In the `CreateBattleModal`, change `onCreated={(id) => { setCreateOpen(false); setWaitingId(id) }}` to `onCreated={(id) => { setCreateOpen(false); navigate('/play/battle/' + id) }}`.

Concretely, the handlers become:

```tsx
  function onBattleAction(b: LiveBattle) {
    setActionError(null)
    if (b.action === 'watch') { navigate('/play/battle/' + b.id); return }
    if (!identityToken) { setActionError('Inicia sesión para unirte.'); return }
    gate.requireDelegation(async () => {
      try {
        await joinBattle(identityToken, b.id)
        navigate('/play/battle/' + b.id)
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e))
      }
    })
  }
```
and the modal render:
```tsx
      {createOpen && (
        <CreateBattleModal
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => { setCreateOpen(false); navigate('/play/battle/' + id) }}
        />
      )}
```
Remove the now-unused `waitingId`/`setWaitingId` `useState` and the `BattleWaiting` JSX. Keep `DelegationGate`, `CreateBattleModal`, `useOpenBattles`, `openBattleToLive`, `actionError` as-is.

- [ ] **Step 2: Delete the superseded modal**

```bash
git rm src/ui/screens/Hub/BattleWaiting.tsx src/ui/screens/Hub/BattleWaiting.test.tsx
```

- [ ] **Step 3: Typecheck + full suite**

Run: `npx tsc --noEmit` then `npm test`
Expected: no type errors; all tests PASS. Confirm nothing still imports `BattleWaiting` (`grep -rn BattleWaiting src/` → only matches inside `docs`/none in `src`).

- [ ] **Step 4: Manual smoke (optional)**

With backend (`:9090`) + frontend (`:5173`) running (`docs/STARTUP.md`): create a battle from the Hub → lands on `/play/battle/:id` waiting room; when it runs, cards reveal round by round; at settle, the result shows.

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/Hub/Hub.tsx
git commit -m "feat(fe): Hub navigates to /play/battle/:id; remove BattleWaiting modal (#4b-3)"
```

---

## Final whole-branch review

After Task 10, run the full backend + frontend suites (`backend/`: `.venv/bin/pytest`; root: `npm test` + `npx tsc --noEmit`) and request a whole-branch review before merging to `master`. Update `.superpowers/sdd/progress.md` with the #4b-3 sub-project entry (per-task commit ranges + review notes). Carry-over to #4d: `BattleResult` is where the PF-verify entry point will attach.
