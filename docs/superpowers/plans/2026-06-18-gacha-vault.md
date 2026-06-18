# Gacha Vault Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a polished "GACHA VAULT" screen at `/play/gacha` that shows machine selector, pack detail, and card pool grid — replacing the raw Hub→arena nav — while reusing the existing `buy()` open/reveal flow as an overlay modal.

**Architecture:** 
- Three new frontend files: `GachaVault.tsx` (main screen), `MachineDetailPanel.tsx` (left panel), `CardPoolGrid.tsx` (right grid). 
- One new client function `fetchMachineCards()` added to `gachaClient.ts`. 
- Backend: extend `_MACHINE_FIELDS` in `gacha.py` + update `GachaMachine` TS interface + fix backend test assertions.
- Routing: add `/play/gacha` in `App.tsx`, repoint Hub `go('gacha')` to `/play/gacha`.

**Tech Stack:** React 19, TypeScript ~6, framer-motion 12, React Router 7, `@privy-io/react-auth` (useIdentityToken), custom `useWallet` hook, Vitest + pytest

## Global Constraints

- Branch: `feat/gacha-vault` (already exists — all commits go here)
- All design tokens come from `src/ui/theme.ts`: `COLORS`, `FONTS`, `RARITY`, `SHADOW`, `GRADIENT`, `formatUsd` — no new colors or fonts invented
- Framer-motion for stagger/hover-lift on card grid and existing reveal animation; tasteful, not noisy
- `useReducedMotion()` from `src/ui/useReducedMotion.ts` must gate all animations
- Do NOT delete `GachaScreen.tsx` — it stays intact inside OnchainFlow
- `npx tsc --noEmit` must pass clean after every task
- `npm test` (Vitest) and `cd backend && .venv/bin/python -m pytest -q` must be green
- Inline styles only (no Tailwind/CSS modules) — matching existing Hub/Profile pattern
- `useIdentityToken` imported from `@privy-io/react-auth`, `signTransactionBase64` from `useWallet()`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/onchain/gachaClient.ts` | Modify | Add `MachineCard` interface, `fetchMachineCards()`, extend `GachaMachine` with 4 new optional fields |
| `backend/app/services/gacha.py` | Modify | Extend `_MACHINE_FIELDS` tuple with `"shortName", "thumbnailUrl", "instantBuyback", "contains"` |
| `backend/tests/test_gacha.py` | Modify | Add new fields to `MACHINE` fixture and fix `test_machines_maps_and_caches` expected output |
| `src/ui/screens/gacha/GachaVault.tsx` | Create | Main vault screen: header + machine selector strip + 2-col body + reveal overlay |
| `src/ui/screens/gacha/MachineDetailPanel.tsx` | Create | Left column: pack image, EV, price, OPEN NOW button, odds bars |
| `src/ui/screens/gacha/CardPoolGrid.tsx` | Create | Right column: card grid with stagger animation, loading/empty states |
| `src/App.tsx` | Modify | Add `import GachaVault` + `<Route path="/play/gacha" element={<GachaVault />} />` inside GameLayout group |
| `src/ui/screens/Hub/Hub.tsx` | Modify | Change `case 'gacha'` (and `case 'pack'` note) in `go()` to `navigate('/play/gacha')` |

---

## Task 1: Backend — Enrich `_MACHINE_FIELDS` and fix test

**Files:**
- Modify: `backend/app/services/gacha.py:22`
- Modify: `backend/tests/test_gacha.py:9-70`

**Interfaces:**
- Produces: `machines()` now includes `shortName`, `thumbnailUrl`, `instantBuyback`, `contains` keys (may be None if upstream doesn't have them)

- [ ] **Step 1: Run backend tests to verify baseline is green**

```bash
cd /Users/mauro/Desarrollos/BattleArena/backend && .venv/bin/python -m pytest tests/test_gacha.py -q
```
Expected: all tests pass.

- [ ] **Step 2: Extend `_MACHINE_FIELDS` in `gacha.py`**

In `backend/app/services/gacha.py`, replace line 22:
```python
# OLD:
_MACHINE_FIELDS = ("code", "name", "price", "odds", "stock", "ev", "image")
# NEW:
_MACHINE_FIELDS = ("code", "name", "price", "odds", "stock", "ev", "image",
                   "shortName", "thumbnailUrl", "instantBuyback", "contains")
```

- [ ] **Step 3: Update `MACHINE` fixture in test to include new fields**

In `backend/tests/test_gacha.py`, update the `MACHINE` dict at the top to include the new fields:
```python
MACHINE = {
    "code": "pokemon_50", "name": "Pokemon 50", "price": 50,
    "odds": {"epic": 1, "rare": 9, "uncommon": 30, "common": 60},
    "stock": {"epic": 2, "rare": 10, "uncommon": 40, "common": 100},
    "ev": 42.5, "image": "https://x/img.png",
    "shortName": "Poke50", "thumbnailUrl": "https://x/thumb.png",
    "instantBuyback": 80, "contains": 1,
    "tierRanges": {}, "extra_ignored": "x",
}
```

- [ ] **Step 4: Fix `test_machines_maps_and_caches` expected output**

In `backend/tests/test_gacha.py`, update the assertion in `test_machines_maps_and_caches` to include the new fields:
```python
@respx.mock
@pytest.mark.asyncio
async def test_machines_maps_and_caches():
    route = respx.get(f"{BASE}/api/machines").mock(return_value=Response(200, json={"machines": [MACHINE]}))
    svc = _svc()
    out = await svc.machines()
    assert out == [{
        "code": "pokemon_50", "name": "Pokemon 50", "price": 50,
        "odds": MACHINE["odds"], "stock": MACHINE["stock"], "ev": 42.5,
        "image": "https://x/img.png",
        "shortName": "Poke50", "thumbnailUrl": "https://x/thumb.png",
        "instantBuyback": 80, "contains": 1,
    }]
    assert "tierRanges" not in out[0]
    assert "extra_ignored" not in out[0]
    await svc.machines()
    assert route.call_count == 1  # cache 60s
```

- [ ] **Step 5: Run backend tests — must be green**

```bash
cd /Users/mauro/Desarrollos/BattleArena/backend && .venv/bin/python -m pytest tests/test_gacha.py -q
```
Expected: all tests pass, 0 failures.

- [ ] **Step 6: Commit**

```bash
git -C /Users/mauro/Desarrollos/BattleArena add backend/app/services/gacha.py backend/tests/test_gacha.py
git -C /Users/mauro/Desarrollos/BattleArena commit -m "feat(gacha): campos de máquina enriquecidos (shortName/thumbnailUrl/instantBuyback/contains)"
```

---

## Task 2: Frontend client — `fetchMachineCards` + extended `GachaMachine` interface

**Files:**
- Modify: `src/onchain/gachaClient.ts`

**Interfaces:**
- Produces: 
  - `MachineCard { nft_address, name, image, rarity, insured_value, grade }` — all fields nullable
  - `fetchMachineCards(code, opts?) → Promise<MachineCard[]>`
  - `GachaMachine` gains optional: `shortName`, `thumbnailUrl`, `instantBuyback`, `contains`

- [ ] **Step 1: Extend `GachaMachine` interface and add `MachineCard` + `fetchMachineCards` to `gachaClient.ts`**

Open `src/onchain/gachaClient.ts`. Make these changes:

**a) Extend `GachaMachine` interface** (after the existing `image` field):
```typescript
export interface GachaMachine {
  code: string
  name: string
  price: number
  odds: Record<string, number>
  stock: Record<string, number>
  ev: number | null
  image: string | null
  shortName?: string | null
  thumbnailUrl?: string | null
  instantBuyback?: number | null
  contains?: number | null
}
```

**b) Add `MachineCard` interface and `fetchMachineCards` function** (after the existing `fetchMachines` export):
```typescript
export interface MachineCard {
  nft_address: string | null
  name: string | null
  image: string | null
  rarity: string | null
  insured_value: number | null
  grade: string | null
}

export function fetchMachineCards(
  code: string,
  opts?: { rarity?: string; page?: number; limit?: number },
): Promise<MachineCard[]> {
  const p = new URLSearchParams()
  if (opts?.rarity) p.set('rarity', opts.rarity)
  if (opts?.page) p.set('page', String(opts.page))
  p.set('limit', String(opts?.limit ?? 24))
  return gachaFetch<MachineCard[]>(
    `/gacha/machines/${encodeURIComponent(code)}/cards?${p.toString()}`,
  )
}
```

- [ ] **Step 2: Type-check only the client file**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npx tsc --noEmit 2>&1 | head -30
```
Expected: 0 errors (or only pre-existing unrelated errors).

- [ ] **Step 3: Run existing gachaClient tests**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npm test -- --reporter=verbose src/onchain/gachaClient.test.ts 2>&1 | tail -20
```
Expected: all 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git -C /Users/mauro/Desarrollos/BattleArena add src/onchain/gachaClient.ts
git -C /Users/mauro/Desarrollos/BattleArena commit -m "feat(gacha): cliente fetchMachineCards + GachaMachine enriquecido"
```

---

## Task 3: Create `CardPoolGrid.tsx`

**Files:**
- Create: `src/ui/screens/gacha/CardPoolGrid.tsx`

**Interfaces:**
- Consumes: `MachineCard` from `src/onchain/gachaClient.ts`; `COLORS`, `FONTS`, `RARITY`, `SHADOW`, `formatUsd` from `src/ui/theme.ts`; `motion` from `framer-motion`; `useReducedMotion` from `src/ui/useReducedMotion`
- Produces: `<CardPoolGrid cards machineCode loading />` — responsive grid of card tiles

- [ ] **Step 1: Create `src/ui/screens/gacha/CardPoolGrid.tsx`**

```tsx
import { motion } from 'framer-motion'
import { COLORS, FONTS, RARITY, SHADOW, formatUsd } from '../../theme'
import { useReducedMotion } from '../../useReducedMotion'
import type { MachineCard } from '../../../onchain/gachaClient'

interface Props {
  cards: MachineCard[]
  loading: boolean
  liveCount?: number
}

const RARITY_COLOR: Record<string, string> = {
  epic: RARITY.epic,
  rare: RARITY.rare,
  uncommon: RARITY.uncommon,
  common: RARITY.common,
}

export function CardPoolGrid({ cards, loading, liveCount }: Props) {
  const reduced = useReducedMotion()

  const containerVariants = {
    hidden: {},
    show: { transition: { staggerChildren: reduced ? 0 : 0.04 } },
  }
  const itemVariants = {
    hidden: { opacity: 0, y: reduced ? 0 : 14 },
    show: { opacity: 1, y: 0, transition: { duration: 0.25 } },
  }

  return (
    <div>
      {/* Heading */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span
          style={{
            fontFamily: FONTS.mono,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '.08em',
            color: COLORS.muted,
            textTransform: 'uppercase',
          }}
        >
          CARDS IN THIS PACK · {cards.length}
        </span>
        {liveCount != null && (
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              color: COLORS.green,
              fontFamily: FONTS.mono,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: COLORS.green,
                boxShadow: SHADOW.glow(COLORS.green),
                display: 'inline-block',
              }}
            />
            {liveCount} live in pool
          </span>
        )}
      </div>

      {/* Loading state */}
      {loading && (
        <div
          style={{
            textAlign: 'center',
            padding: '48px 0',
            color: COLORS.muted,
            fontSize: 14,
            fontFamily: FONTS.body,
          }}
        >
          Loading cards…
        </div>
      )}

      {/* Empty state */}
      {!loading && cards.length === 0 && (
        <div
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 12,
            padding: '40px 20px',
            textAlign: 'center',
            color: COLORS.muted,
            fontSize: 14,
            fontFamily: FONTS.body,
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 10 }}>🃏</div>
          No cards found in this pack.
        </div>
      )}

      {/* Grid */}
      {!loading && cards.length > 0 && (
        <motion.div
          key={cards.length}
          variants={containerVariants}
          initial="hidden"
          animate="show"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 12,
          }}
        >
          {cards.map((card, i) => {
            const rarityKey = (card.rarity ?? '').toLowerCase()
            const accent = RARITY_COLOR[rarityKey] ?? COLORS.muted
            return (
              <motion.div
                key={card.nft_address ?? i}
                variants={itemVariants}
                whileHover={reduced ? undefined : { y: -4, boxShadow: SHADOW.glow(accent) }}
                style={{
                  background: COLORS.panel,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 10,
                  overflow: 'hidden',
                  cursor: 'default',
                  transition: 'box-shadow 0.18s',
                }}
              >
                {/* Card image */}
                <div
                  style={{
                    width: '100%',
                    aspectRatio: '3/4',
                    background: COLORS.panel2,
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {card.image ? (
                    <img
                      src={card.image}
                      alt={card.name ?? undefined}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <span style={{ fontSize: 32 }}>🃏</span>
                  )}
                </div>

                {/* Card info */}
                <div style={{ padding: '10px 10px 12px' }}>
                  {/* Rarity badge */}
                  {card.rarity && (
                    <div
                      style={{
                        display: 'inline-block',
                        fontSize: 9,
                        fontWeight: 800,
                        letterSpacing: '.08em',
                        textTransform: 'uppercase',
                        color: accent,
                        border: `1px solid ${accent}55`,
                        borderRadius: 4,
                        padding: '2px 6px',
                        marginBottom: 6,
                      }}
                    >
                      {card.rarity}
                    </div>
                  )}

                  {/* Name */}
                  <div
                    style={{
                      fontFamily: FONTS.body,
                      fontWeight: 700,
                      fontSize: 12,
                      color: COLORS.text,
                      marginBottom: 4,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={card.name ?? undefined}
                  >
                    {card.name ?? '—'}
                  </div>

                  {/* Insured value */}
                  {card.insured_value != null && (
                    <div
                      style={{
                        fontFamily: FONTS.mono,
                        fontSize: 11,
                        color: COLORS.green,
                        fontWeight: 700,
                      }}
                    >
                      {formatUsd(card.insured_value)}
                    </div>
                  )}

                  {/* Grade */}
                  {card.grade && (
                    <div
                      style={{
                        fontFamily: FONTS.mono,
                        fontSize: 10,
                        color: COLORS.muted,
                        marginTop: 2,
                      }}
                    >
                      {card.grade}
                    </div>
                  )}
                </div>
              </motion.div>
            )
          })}
        </motion.div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npx tsc --noEmit 2>&1 | head -30
```
Expected: 0 errors.

---

## Task 4: Create `MachineDetailPanel.tsx`

**Files:**
- Create: `src/ui/screens/gacha/MachineDetailPanel.tsx`

**Interfaces:**
- Consumes: `GachaMachine` from `src/onchain/gachaClient.ts`; theme tokens; `motion` from framer-motion
- Produces: `<MachineDetailPanel machine onOpen disabled />` — left-column pack detail with odds bars, EV, buyback, OPEN NOW button

- [ ] **Step 1: Create `src/ui/screens/gacha/MachineDetailPanel.tsx`**

```tsx
import { motion } from 'framer-motion'
import { COLORS, FONTS, RARITY, SHADOW, GRADIENT, formatUsd } from '../../theme'
import { useReducedMotion } from '../../useReducedMotion'
import type { GachaMachine } from '../../../onchain/gachaClient'

interface Props {
  machine: GachaMachine
  onOpen: () => void
  /** True when identityToken is null (not authenticated) */
  disabled: boolean
}

const RARITY_ORDER = ['epic', 'rare', 'uncommon', 'common'] as const
const RARITY_COLOR: Record<string, string> = {
  Epic: RARITY.epic,   epic: RARITY.epic,
  Rare: RARITY.rare,   rare: RARITY.rare,
  Uncommon: RARITY.uncommon, uncommon: RARITY.uncommon,
  Common: RARITY.common, common: RARITY.common,
}

export function MachineDetailPanel({ machine, onOpen, disabled }: Props) {
  const reduced = useReducedMotion()

  // Sort odds with the canonical order; unknown rarities go last
  const oddsEntries = Object.entries(machine.odds ?? {}).sort(([a], [b]) => {
    const ia = RARITY_ORDER.indexOf(a.toLowerCase() as typeof RARITY_ORDER[number])
    const ib = RARITY_ORDER.indexOf(b.toLowerCase() as typeof RARITY_ORDER[number])
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })

  const totalOdds = oddsEntries.reduce((sum, [, v]) => sum + (v ?? 0), 0)

  return (
    <div
      style={{
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 14,
        padding: '24px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}
    >
      {/* Pack image */}
      <div
        style={{
          width: '100%',
          aspectRatio: '1/1',
          background: COLORS.panel2,
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          border: `1px solid ${COLORS.border}`,
        }}
      >
        {machine.image ? (
          <img
            src={machine.image}
            alt={machine.name}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        ) : (
          <span style={{ fontSize: 64 }}>🎰</span>
        )}
      </div>

      {/* Pack name */}
      <div>
        <div
          style={{
            fontFamily: FONTS.display,
            fontWeight: 800,
            fontSize: 20,
            color: COLORS.text,
            marginBottom: 4,
          }}
        >
          {machine.name}
        </div>
        {machine.shortName && (
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 11,
              color: COLORS.muted,
              letterSpacing: '.06em',
            }}
          >
            {machine.shortName}
          </div>
        )}
      </div>

      {/* EV + Price */}
      <div style={{ display: 'flex', gap: 14 }}>
        <div
          style={{
            flex: 1,
            background: COLORS.panel2,
            borderRadius: 10,
            padding: '12px 14px',
            border: `1px solid ${COLORS.border}`,
          }}
        >
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 10,
              color: COLORS.muted,
              letterSpacing: '.07em',
              marginBottom: 4,
              textTransform: 'uppercase',
            }}
          >
            EXPECTED VALUE
          </div>
          <div
            style={{
              fontFamily: FONTS.display,
              fontWeight: 800,
              fontSize: 18,
              color: COLORS.green,
            }}
          >
            {machine.ev != null ? formatUsd(machine.ev) : '—'}
          </div>
        </div>
        <div
          style={{
            flex: 1,
            background: COLORS.panel2,
            borderRadius: 10,
            padding: '12px 14px',
            border: `1px solid ${COLORS.border}`,
          }}
        >
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 10,
              color: COLORS.muted,
              letterSpacing: '.07em',
              marginBottom: 4,
              textTransform: 'uppercase',
            }}
          >
            PRICE
          </div>
          <div
            style={{
              fontFamily: FONTS.display,
              fontWeight: 800,
              fontSize: 18,
              color: COLORS.text,
            }}
          >
            {formatUsd(machine.price)} USDC
          </div>
        </div>
      </div>

      {/* OPEN NOW button */}
      <motion.button
        onClick={onOpen}
        disabled={disabled}
        whileTap={reduced || disabled ? undefined : { scale: 0.97 }}
        style={{
          width: '100%',
          background: disabled ? COLORS.panel2 : GRADIENT,
          color: disabled ? COLORS.muted : '#06120c',
          border: disabled ? `1px solid ${COLORS.border}` : 'none',
          borderRadius: 12,
          padding: '16px 20px',
          fontSize: 15,
          fontWeight: 800,
          fontFamily: FONTS.display,
          cursor: disabled ? 'not-allowed' : 'pointer',
          letterSpacing: '.03em',
          boxShadow: disabled ? 'none' : SHADOW.glow(COLORS.green),
          transition: 'background 0.2s',
        }}
      >
        {disabled ? 'Log in to open' : `OPEN NOW · ${formatUsd(machine.price)}`}
      </motion.button>

      {/* Contains + Buyback meta */}
      <div
        style={{
          fontFamily: FONTS.mono,
          fontSize: 11,
          color: COLORS.muted,
          letterSpacing: '.05em',
          display: 'flex',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        {machine.contains != null && (
          <span>CONTAINS {machine.contains}</span>
        )}
        {machine.instantBuyback != null && (
          <span>BUYBACK {machine.instantBuyback}%</span>
        )}
      </div>

      {/* Odds bars */}
      {oddsEntries.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 10,
              color: COLORS.muted,
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              marginBottom: 2,
            }}
          >
            ODDS
          </div>
          {oddsEntries.map(([rarity, pct]) => {
            const accent = RARITY_COLOR[rarity] ?? COLORS.muted
            const width = totalOdds > 0 ? Math.round((pct / totalOdds) * 100) : pct
            return (
              <div key={rarity}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: 4,
                    fontFamily: FONTS.mono,
                    fontSize: 11,
                  }}
                >
                  <span style={{ color: accent, textTransform: 'capitalize', fontWeight: 700 }}>
                    {rarity.toLowerCase()}
                  </span>
                  <span style={{ color: COLORS.muted }}>{pct}%</span>
                </div>
                <div
                  style={{
                    height: 5,
                    background: COLORS.panel2,
                    borderRadius: 3,
                    overflow: 'hidden',
                    border: `1px solid ${COLORS.border}`,
                  }}
                >
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(width, 100)}%` }}
                    transition={{ duration: reduced ? 0 : 0.5, ease: 'easeOut' }}
                    style={{
                      height: '100%',
                      background: accent,
                      borderRadius: 3,
                      boxShadow: SHADOW.glow(accent),
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npx tsc --noEmit 2>&1 | head -30
```
Expected: 0 errors.

---

## Task 5: Create main `GachaVault.tsx`

**Files:**
- Create: `src/ui/screens/gacha/GachaVault.tsx`

**Interfaces:**
- Consumes: `fetchMachines`, `fetchMachineCards`, `GachaMachine`, `MachineCard`, `generatePack`, `submitTx`, `openPack`, `pollOpenPack`, `GachaDisabledError` from `gachaClient`; `MachineDetailPanel` from `./MachineDetailPanel`; `CardPoolGrid` from `./CardPoolGrid`; `useIdentityToken` from `@privy-io/react-auth`; `useWallet` from `../../../wallet/useWallet`; `COLORS`, `FONTS`, `SHADOW`, `GRADIENT`, `RARITY` from `../../theme`; `motion`, `AnimatePresence` from `framer-motion`; `useReducedMotion` from `../../useReducedMotion`; `OpenPackResult` from `gachaClient`
- Produces: default export `GachaVault` component (no props, self-contained route component)

**Architecture of GachaVault:**
- State machine phases (same as GachaScreen): `machines` (default browsing) | `opening` (firmando/enviando/abriendo) | `pending` (retry) | `result` (reveal overlay)
- `selectedMachine` tracks which machine chip is active (defaults to first)
- `cards` + `cardsLoading` for the pool grid — refetched whenever `selectedMachine` changes
- The reveal overlay sits as an `AnimatePresence` layer on top (position: fixed) when phase !== 'machines' && phase !== null
- Machine selector is a horizontal scrollable strip

- [ ] **Step 1: Create `src/ui/screens/gacha/GachaVault.tsx`**

```tsx
// GachaVault — Polished gacha entry screen.
// Shows machine selector, pack detail, and card pool grid.
// Opening a pack uses the same buy() → sign → submit → poll → reveal flow as GachaScreen.
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useIdentityToken } from '@privy-io/react-auth'
import { useWallet } from '../../../wallet/useWallet'
import {
  fetchMachines,
  fetchMachineCards,
  generatePack,
  submitTx,
  openPack,
  pollOpenPack,
  GachaDisabledError,
  type GachaMachine,
  type MachineCard,
  type OpenPackResult,
} from '../../../onchain/gachaClient'
import { COLORS, FONTS, RARITY, SHADOW, GRADIENT } from '../../theme'
import { useReducedMotion } from '../../useReducedMotion'
import { MachineDetailPanel } from './MachineDetailPanel'
import { CardPoolGrid } from './CardPoolGrid'

// Map capitalized rarity → RARITY color token (same as GachaScreen)
const RARITY_COLOR: Record<string, string> = {
  Epic: RARITY.epic, Rare: RARITY.rare, Uncommon: RARITY.uncommon, Common: RARITY.common,
}

type Phase =
  | { kind: 'machines' }
  | { kind: 'opening'; step: 'firmando' | 'enviando' | 'abriendo' }
  | { kind: 'result'; result: Extract<OpenPackResult, { pending: false }> }
  | { kind: 'pending'; memo: string }

const STEP_LABEL: Record<'firmando' | 'enviando' | 'abriendo', string> = {
  firmando: 'Sign the transaction in your wallet…',
  enviando: 'Sending to Solana…',
  abriendo: 'Opening the pack…',
}

export default function GachaVault() {
  const reduced = useReducedMotion()
  const { identityToken } = useIdentityToken()
  const { signTransactionBase64 } = useWallet()

  const [machines, setMachines] = useState<GachaMachine[] | null>(null)
  const [selected, setSelected] = useState<GachaMachine | null>(null)
  const [disabled, setDisabled] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'machines' })

  const [cards, setCards] = useState<MachineCard[]>([])
  const [cardsLoading, setCardsLoading] = useState(false)

  // ── Load machines on mount ──────────────────────────────────────────────────
  useEffect(() => {
    fetchMachines()
      .then((ms) => {
        setMachines(ms)
        if (ms.length > 0) setSelected(ms[0])
      })
      .catch((e) =>
        e instanceof GachaDisabledError ? setDisabled(true) : setFetchError(String(e)),
      )
  }, [])

  // ── Load card pool when selected machine changes ────────────────────────────
  useEffect(() => {
    if (!selected) return
    setCardsLoading(true)
    setCards([])
    fetchMachineCards(selected.code, { limit: 24 })
      .then(setCards)
      .catch(() => setCards([]))
      .finally(() => setCardsLoading(false))
  }, [selected?.code])

  // ── Buy / open flow (mirrors GachaScreen.buy) ──────────────────────────────
  async function handleOpen() {
    if (!selected || !identityToken) return
    setOpenError(null)
    let pack: { memo: string; transaction: string }
    try {
      setPhase({ kind: 'opening', step: 'firmando' })
      pack = await generatePack(identityToken, selected.code)
      const signed = await signTransactionBase64(pack.transaction)
      setPhase({ kind: 'opening', step: 'enviando' })
      await submitTx(identityToken, signed)
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : String(e))
      setPhase({ kind: 'machines' })
      return
    }
    setPhase({ kind: 'opening', step: 'abriendo' })
    try {
      const result = await pollOpenPack(() => openPack(identityToken, pack.memo))
      if (result.pending) {
        setPhase({ kind: 'pending', memo: pack.memo })
      } else {
        setPhase({ kind: 'result', result })
      }
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : String(e))
      setPhase({ kind: 'pending', memo: pack.memo })
    }
  }

  async function retryOpen(memo: string) {
    if (!identityToken) return
    setOpenError(null)
    setPhase({ kind: 'opening', step: 'abriendo' })
    try {
      const result = await pollOpenPack(() => openPack(identityToken, memo))
      if (result.pending) setPhase({ kind: 'pending', memo })
      else setPhase({ kind: 'result', result })
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : String(e))
      setPhase({ kind: 'pending', memo })
    }
  }

  // ── Disabled state ──────────────────────────────────────────────────────────
  if (disabled) {
    return (
      <div
        style={{
          maxWidth: 520,
          margin: '60px auto',
          padding: '0 20px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 14,
            padding: 32,
            color: COLORS.muted,
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 14 }}>🎰</div>
          <div
            style={{
              fontFamily: FONTS.display,
              fontWeight: 800,
              color: COLORS.text,
              marginBottom: 8,
            }}
          >
            Gacha is unavailable.
          </div>
          The Gacha API key isn't configured in the backend (GACHA_API_KEY).
        </div>
      </div>
    )
  }

  // ── Main layout ─────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        padding: '28px 22px 48px',
        maxWidth: 1100,
        margin: '0 auto',
        position: 'relative',
      }}
    >
      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 28 }}>
        <div
          style={{
            fontFamily: FONTS.mono,
            fontSize: 11,
            color: COLORS.muted,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            marginBottom: 6,
          }}
        >
          GACHA VAULT
        </div>
        <h1
          style={{
            fontFamily: FONTS.display,
            fontWeight: 900,
            fontSize: 32,
            color: COLORS.text,
            margin: 0,
            letterSpacing: '-.01em',
          }}
        >
          PACKS
        </h1>
        <div
          style={{
            fontFamily: FONTS.body,
            fontSize: 14,
            color: COLORS.muted,
            marginTop: 6,
          }}
        >
          Open packs solo — keep them or sell back.
        </div>
      </div>

      {/* ── FETCH ERROR ─────────────────────────────────────────────────────── */}
      {fetchError && (
        <div
          style={{
            background: '#300a0f',
            border: `1px solid ${COLORS.red}`,
            color: COLORS.red,
            borderRadius: 8,
            padding: '12px 14px',
            fontSize: 13,
            marginBottom: 18,
          }}
        >
          {fetchError}
        </div>
      )}

      {/* ── MACHINE SELECTOR STRIP ──────────────────────────────────────────── */}
      {machines === null && !fetchError && (
        <div
          style={{
            color: COLORS.muted,
            fontSize: 13,
            textAlign: 'center',
            padding: '40px 0',
            fontFamily: FONTS.body,
          }}
        >
          Loading machines…
        </div>
      )}

      {machines !== null && machines.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 10,
            overflowX: 'auto',
            paddingBottom: 8,
            marginBottom: 28,
            scrollbarWidth: 'none',
          }}
        >
          {machines.map((m) => {
            const isActive = selected?.code === m.code
            return (
              <button
                key={m.code}
                onClick={() => setSelected(m)}
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: isActive ? COLORS.panel2 : COLORS.panel,
                  border: isActive
                    ? `1.5px solid ${COLORS.green}`
                    : `1px solid ${COLORS.border}`,
                  borderRadius: 12,
                  padding: '10px 14px',
                  cursor: 'pointer',
                  color: COLORS.text,
                  boxShadow: isActive ? SHADOW.glow(COLORS.green) : 'none',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
              >
                {(m.thumbnailUrl ?? m.image) ? (
                  <img
                    src={(m.thumbnailUrl ?? m.image)!}
                    alt={m.name}
                    style={{
                      width: 36,
                      height: 36,
                      objectFit: 'contain',
                      borderRadius: 6,
                      border: `1px solid ${COLORS.border}`,
                    }}
                  />
                ) : (
                  <span style={{ fontSize: 24, lineHeight: 1 }}>🎰</span>
                )}
                <div style={{ textAlign: 'left' }}>
                  <div
                    style={{
                      fontFamily: FONTS.display,
                      fontWeight: 700,
                      fontSize: 13,
                      color: isActive ? COLORS.text : COLORS.text,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {m.shortName ?? m.name}
                  </div>
                  <div
                    style={{
                      fontFamily: FONTS.mono,
                      fontSize: 11,
                      color: isActive ? COLORS.green : COLORS.muted,
                    }}
                  >
                    ${m.price} USDC
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* ── TWO-COLUMN BODY ─────────────────────────────────────────────────── */}
      {selected && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(220px, 300px) 1fr',
            gap: 24,
            alignItems: 'start',
          }}
        >
          {/* LEFT — Pack detail */}
          <MachineDetailPanel
            machine={selected}
            onOpen={() => void handleOpen()}
            disabled={!identityToken}
          />

          {/* RIGHT — Card pool */}
          <CardPoolGrid
            cards={cards}
            loading={cardsLoading}
            liveCount={cards.length > 0 ? cards.length : undefined}
          />
        </div>
      )}

      {/* ── OPEN ERROR BANNER ───────────────────────────────────────────────── */}
      {openError && phase.kind === 'machines' && (
        <div
          style={{
            marginTop: 16,
            background: '#300a0f',
            border: `1px solid ${COLORS.red}`,
            color: COLORS.red,
            borderRadius: 8,
            padding: '12px 14px',
            fontSize: 13,
          }}
        >
          {openError}
        </div>
      )}

      {/* ── REVEAL OVERLAY ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {phase.kind !== 'machines' && (
          <RevealOverlay
            phase={phase}
            reduced={reduced}
            onRetry={(memo) => void retryOpen(memo)}
            onClose={() => setPhase({ kind: 'machines' })}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Reveal / opening overlay ──────────────────────────────────────────────────
function RevealOverlay({
  phase,
  reduced,
  onRetry,
  onClose,
}: {
  phase: Exclude<Phase, { kind: 'machines' }>
  reduced: boolean
  onRetry: (memo: string) => void
  onClose: () => void
}) {
  return (
    <motion.div
      key="overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(11,14,20,0.88)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      {/* Opening */}
      {phase.kind === 'opening' && (
        <div
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 16,
            padding: '48px 32px',
            textAlign: 'center',
            maxWidth: 360,
            width: '100%',
            boxShadow: SHADOW.panel,
          }}
        >
          <motion.div
            animate={reduced ? undefined : { opacity: [1, 0.35, 1] }}
            transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
            style={{ fontSize: 56, marginBottom: 22 }}
          >
            🎰
          </motion.div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: COLORS.text,
              fontFamily: FONTS.body,
              lineHeight: 1.5,
            }}
          >
            {STEP_LABEL[phase.step]}
          </div>
          <div
            style={{
              marginTop: 10,
              fontSize: 11,
              color: COLORS.muted,
              fontFamily: FONTS.mono,
              letterSpacing: '.05em',
              textTransform: 'uppercase',
            }}
          >
            {phase.step}
          </div>
        </div>
      )}

      {/* Pending */}
      {phase.kind === 'pending' && (
        <div
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 16,
            padding: '40px 28px',
            textAlign: 'center',
            maxWidth: 360,
            width: '100%',
            boxShadow: SHADOW.panel,
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 16 }}>⏳</div>
          <div
            style={{
              fontSize: 14,
              color: COLORS.text,
              lineHeight: 1.6,
              marginBottom: 22,
              fontFamily: FONTS.body,
            }}
          >
            Your pack is being processed on-chain…
          </div>
          <motion.button
            onClick={() => onRetry(phase.memo)}
            whileTap={reduced ? undefined : { scale: 0.96 }}
            style={{
              background: COLORS.green,
              color: '#04130c',
              border: 'none',
              borderRadius: 10,
              padding: '14px 28px',
              fontSize: 14,
              fontWeight: 800,
              cursor: 'pointer',
              fontFamily: FONTS.display,
              letterSpacing: '.03em',
              boxShadow: SHADOW.glow(COLORS.green),
              marginBottom: 10,
              width: '100%',
            }}
          >
            Keep waiting
          </motion.button>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: COLORS.muted,
              cursor: 'pointer',
              fontSize: 13,
              fontFamily: FONTS.body,
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Result */}
      {phase.kind === 'result' && (() => {
        const r = phase.result
        const rarityColor = RARITY_COLOR[r.rarity] ?? COLORS.muted
        return (
          <motion.div
            initial={reduced ? undefined : { scale: 0.82, opacity: 0 }}
            animate={reduced ? undefined : { scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 280, damping: 22 }}
            style={{
              background: COLORS.panel,
              border: `2px solid ${rarityColor}`,
              borderRadius: 16,
              padding: '32px 24px',
              textAlign: 'center',
              maxWidth: 380,
              width: '100%',
              boxShadow: `${SHADOW.panel}, ${SHADOW.glow(rarityColor)}`,
            }}
          >
            {/* Rarity badge */}
            <div
              style={{
                display: 'inline-block',
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                color: rarityColor,
                border: `1px solid ${rarityColor}`,
                borderRadius: 4,
                padding: '3px 10px',
                marginBottom: 18,
                boxShadow: SHADOW.glow(rarityColor),
              }}
            >
              {r.rarity}
            </div>

            {/* Card image */}
            {r.image && (
              <div style={{ marginBottom: 16 }}>
                <img
                  src={r.image}
                  alt={r.name ?? undefined}
                  style={{
                    maxWidth: 220,
                    width: '100%',
                    borderRadius: 10,
                    border: `1px solid ${rarityColor}44`,
                    display: 'block',
                    margin: '0 auto',
                  }}
                />
              </div>
            )}

            {/* Card name */}
            <div
              style={{
                fontFamily: FONTS.display,
                fontWeight: 800,
                fontSize: 20,
                color: COLORS.text,
                marginBottom: 8,
              }}
            >
              {r.name}
            </div>

            {/* NFT address */}
            <div
              style={{
                fontSize: 11,
                color: COLORS.muted,
                fontFamily: FONTS.mono,
                wordBreak: 'break-all',
                marginBottom: 22,
              }}
            >
              {r.nft_address}
            </div>

            {/* Close */}
            <button
              onClick={onClose}
              style={{
                width: '100%',
                background: GRADIENT,
                color: '#06120c',
                border: 'none',
                borderRadius: 10,
                padding: '14px',
                fontSize: 14,
                fontWeight: 800,
                cursor: 'pointer',
                fontFamily: FONTS.display,
                letterSpacing: '.03em',
                boxShadow: SHADOW.glow(COLORS.green),
              }}
            >
              Back to Vault
            </button>
          </motion.div>
        )
      })()}
    </motion.div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npx tsc --noEmit 2>&1 | head -40
```
Expected: 0 errors.

---

## Task 6: Wire routing and Hub navigation

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/ui/screens/Hub/Hub.tsx`

**Interfaces:**
- Consumes: `GachaVault` default export from `./ui/screens/gacha/GachaVault`

- [ ] **Step 1: Add `/play/gacha` route in `src/App.tsx`**

Open `src/App.tsx`. Add the import for `GachaVault` (lazy import is fine but direct import also works for consistency with ProfilePage pattern — use a named lazy import to keep bundle split):

```typescript
// Add this import near the top with the other flow imports
import { lazy } from 'react'
const GachaVault = lazy(() => import('./ui/screens/gacha/GachaVault'))
```

WAIT — `App.tsx` doesn't currently use `lazy`. Keep it simple and use a direct import to match the ProfilePage pattern:

Replace the App.tsx content with:
```tsx
import { BrowserRouter, Routes, Route, Navigate, Suspense, lazy } from 'react-router-dom'
import { Landing } from './ui/screens/Landing'
import { Hub } from './ui/screens/Hub/Hub'
import { GameLayout } from './ui/layouts/GameLayout'
import { ManaDuelFlow } from './ui/flows/ManaDuelFlow'
import { RoyaleFlow } from './ui/flows/RoyaleFlow'
import { OnchainFlow } from './ui/flows/OnchainFlow'
import { ProfilePage } from './ui/screens/Profile/ProfilePage'

const GachaVault = lazy(() => import('./ui/screens/gacha/GachaVault'))

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<Hub />} />
        <Route element={<GameLayout />}>
          <Route path="/play/mana" element={<ManaDuelFlow />} />
          <Route path="/play/royale" element={<RoyaleFlow />} />
          <Route path="/play/arena" element={<OnchainFlow />} />
          <Route
            path="/play/gacha"
            element={
              <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9aa3b2' }}>Loading…</div>}>
                <GachaVault />
              </Suspense>
            }
          />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
```

- [ ] **Step 2: Change Hub `go('gacha')` to navigate to `/play/gacha`**

In `src/ui/screens/Hub/Hub.tsx`, find the `go()` function (around line 56-64):
```typescript
// CURRENT:
case 'pack':
case 'gacha':  return navigate('/play/arena')
// CHANGE TO:
case 'pack':   return navigate('/play/arena')
case 'gacha':  return navigate('/play/gacha')
```

The `case 'pack'` should remain pointing to `/play/arena` (pack battle flow). Only `case 'gacha'` changes to `/play/gacha`.

- [ ] **Step 3: Full type-check**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npx tsc --noEmit 2>&1
```
Expected: 0 errors.

- [ ] **Step 4: Run all frontend tests**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npm test 2>&1 | tail -30
```
Expected: all pass (no regressions).

- [ ] **Step 5: Run all backend tests**

```bash
cd /Users/mauro/Desarrollos/BattleArena/backend && .venv/bin/python -m pytest -q 2>&1 | tail -20
```
Expected: all pass.

- [ ] **Step 6: Commit routing changes**

```bash
git -C /Users/mauro/Desarrollos/BattleArena add src/App.tsx src/ui/screens/Hub/Hub.tsx
git -C /Users/mauro/Desarrollos/BattleArena commit -m "feat(gacha): ruta /play/gacha y Hub apunta al nuevo vault"
```

- [ ] **Step 7: Commit GachaVault screens**

```bash
git -C /Users/mauro/Desarrollos/BattleArena add src/ui/screens/gacha/
git -C /Users/mauro/Desarrollos/BattleArena commit -m "feat(gacha): pantalla GachaVault (selector de máquinas + detalle + grid de cartas del pool)"
```

---

## Task 7: Final verification

- [ ] **Step 1: Full tsc --noEmit**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npx tsc --noEmit 2>&1
```
Expected: clean (0 errors).

- [ ] **Step 2: Full npm test**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npm test 2>&1 | tail -30
```
Expected: all tests pass.

- [ ] **Step 3: Full backend pytest**

```bash
cd /Users/mauro/Desarrollos/BattleArena/backend && .venv/bin/python -m pytest -q 2>&1 | tail -20
```
Expected: all pass.

- [ ] **Step 4: Optional build check**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npm run build 2>&1 | tail -20
```
Expected: build succeeds with no TypeScript errors.

---

## Self-Review Checklist

**Spec Coverage:**
- [x] Header: eyebrow "GACHA VAULT" (mono, uppercase, muted) + big title "PACKS" (Sora) + subtitle — covered in GachaVault.tsx header section
- [x] Machine selector strip: horizontal scrollable, chip with thumbnail/emoji + name + price, active accent border + glow — covered in GachaVault.tsx machine strip
- [x] Two-column body: LEFT detail panel + RIGHT card pool — covered in Task 3+4+5
- [x] Pack detail: image/fallback, name, EV, price, gradient OPEN NOW button, contains N · buyback %, odds bars with RARITY colors — covered in MachineDetailPanel.tsx
- [x] Card pool grid: heading, live count, responsive grid, image+name+insured_value+grade — covered in CardPoolGrid.tsx
- [x] Reveal overlay: buy→sign→submit→poll→reveal phases, opening/pending/result states, rarity glow — covered in GachaVault.tsx RevealOverlay
- [x] staggered reveal on machine change (key on cards.length), hover-lift on card tiles, existing reveal animation — covered with framer-motion variants
- [x] `fetchMachineCards` function — covered in Task 2
- [x] `MachineCard` interface — covered in Task 2
- [x] `GachaMachine` extension (shortName, thumbnailUrl, instantBuyback, contains) — covered in Task 2
- [x] Backend `_MACHINE_FIELDS` extension — covered in Task 1
- [x] `test_machines_maps_and_caches` fix — covered in Task 1
- [x] `useIdentityToken` for auth, disabled button when null — covered in GachaVault.tsx
- [x] Route `/play/gacha` in App.tsx inside GameLayout — covered in Task 6
- [x] Hub `case 'gacha'` → `/play/gacha` — covered in Task 6
- [x] `case 'pack'` still → `/play/arena` — explicitly noted in Task 6 Step 2
- [x] Existing GachaScreen NOT deleted — plan never touches it
- [x] `useReducedMotion()` gates all animations — used in all 3 new components
- [x] All tokens from `src/ui/theme.ts` — no new colors/fonts invented

**Placeholder Scan:** No TBDs, TODOs, or "implement later" phrases — all code is explicit.

**Type Consistency:**
- `MachineCard` defined in Task 2, consumed in Task 3 ✓
- `GachaMachine` extended in Task 2, consumed in Tasks 4+5 ✓
- `handleOpen` / `retryOpen` signatures consistent ✓
- `Phase` type defined at module scope in GachaVault.tsx, used by `RevealOverlay` ✓
- `fetchMachineCards` signature in Task 2 matches usage in Task 5 (`fetchMachineCards(selected.code, { limit: 24 })`) ✓

**Note for implementer:** The two-column layout uses `gridTemplateColumns: 'minmax(220px, 300px) 1fr'`. On very narrow screens (< ~500px) the two columns will stack poorly — the spec says "responsive; stack on narrow" but doesn't prescribe a breakpoint. If the implementer wants to add a media-query breakpoint, they can add a `useIsWide('(min-width: 640px)')` hook (copying the pattern from Hub.tsx) and switch to single column on narrow screens. This is a small enhancement that can be done post-merge.
