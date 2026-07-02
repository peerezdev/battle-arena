# Lobby v2 + Help Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the Hub to the "Collector Arena Lobby v2" mockup and add a `/help` page, using the existing Neón Cyber palette and only existing data/hooks (plus our own `LOBBY_NEWS` config).

**Architecture:** New self-contained lobby sections (`BigPullTicker`, `BestHitCard`, `NewsCarousel`, `ModeGuide`) read `useDrops()`/config and are composed into `Hub`; existing pieces (`QuickMatch`, `LiveBattles`, `ChatDock`, `LeftRail`, `AppShell` header) are restyled in place preserving their props/handlers; a new `HelpPage` renders inside `AppShell` at `/help`. React 19 + Vite + inline styles + `theme.ts` tokens.

**Tech Stack:** React 19, react-router-dom, TypeScript, Vitest + @testing-library/react, inline styles, `src/ui/theme.ts`.

## Global Constraints

- **Palette unchanged.** Use `theme.ts`: `COLORS.green = #00ffc4`, `COLORS.violet = #ff2e97`, `GRADIENT`, `COLORS.muted #8b95a3`, `COLORS.text #eef2f6`, `COLORS.border #ffffff14`, `COLORS.panel #11161f`, `COLORS.red #ff5e7a`. Royale pink accent `#ff6bb5`; amber `#f5c542`; blue `#4ea8ff`; epic purple `#a98bff`. Fonts: `FONTS.display` (Sora), `FONTS.body` (Inter), `FONTS.mono` (JetBrains Mono). **Never** Space Grotesk; never the mockup's `#2fe28a` green.
- **No hardcoded data.** Ticker/best-hit read `useDrops()`; live games read the existing `LiveBattle[]`; News is our own `LOBBY_NEWS` array with real, non-misleading copy (features, not invented events/dates). Mode-guide/Help copy is UI text.
- **Profile compact:** header account control shows avatar + caret only (no name). Rail: no Settings, no standalone avatar; add Help.
- **The mockup HTML** (lobby v2 + Help) in the conversation is the visual reference for the restyle tasks; match its layout/structure but with our palette/fonts. Preserve all existing component props, handlers and tests.
- Card value source stays `insuredValue`/`valueUsd` (no invented values).
- Reduced motion (`useReducedMotion`) disables auto-advance / marquee / flash animations.

---

## File Structure

- **Modify** `src/ui/screens/Hub/hubMockData.ts` — add `'help'` to `HubNav`; add Help to `NAV_ITEMS`.
- **Modify** `src/ui/layouts/navRoutes.ts` — `NAV_ROUTES.help`, `activeNavFromPath` `/help`.
- **Modify** `src/ui/screens/Hub/LeftRail.tsx` — remove Settings + avatar; add Help item; add `help` to `NAV_ICONS`.
- **Modify** `src/App.tsx` — `<Route path="/help" element={<HelpPage />} />` under `AppShell`.
- **Modify** `src/ui/components/AuthButtons.tsx` — `hideName` behavior for compact.
- **Create** `src/ui/screens/Hub/BigPullTicker.tsx` + test.
- **Create** `src/ui/screens/Hub/BestHitCard.tsx` + test.
- **Create** `src/ui/screens/Hub/lobbyNews.ts` (config) + `src/ui/screens/Hub/NewsCarousel.tsx` + test.
- **Create** `src/ui/screens/Hub/ModeGuide.tsx` + test.
- **Modify** `src/ui/screens/Hub/QuickMatch.tsx` — hero restyle (props unchanged).
- **Modify** `src/ui/screens/Hub/LiveBattles.tsx` — card restyle (props/handlers unchanged).
- **Modify** `src/ui/screens/Hub/ChatDock.tsx` — Recent Drops + chat row restyle.
- **Modify** `src/ui/screens/Hub/Hub.tsx` — compose ticker + best-hit + news + mode guide.
- **Create** `src/ui/screens/Help/HelpPage.tsx` + `src/ui/screens/Help/helpContent.ts` + test.
- **Modify** `src/index.css` — `ba-ticker` + `ba-dropin` keyframes.

All test commands: `npx vitest run <file>` from repo root; full suite `npx vitest run`; typecheck `npm run build` (a pre-existing `@privy-io` node_modules `INVALID_ANNOTATION` warning is unrelated).

---

## Task 1: Nav wiring — add Help, drop Settings + rail avatar

**Files:**
- Modify: `src/ui/screens/Hub/hubMockData.ts:3` (`HubNav`), `:40-44` (`NAV_ITEMS`)
- Modify: `src/ui/layouts/navRoutes.ts` (`NAV_ROUTES`, `activeNavFromPath`)
- Modify: `src/ui/screens/Hub/LeftRail.tsx` (`NAV_ICONS`, `ITEMS`, remove Settings + avatar)
- Modify: `src/App.tsx` (route)
- Modify: `src/ui/layouts/navRoutes.test.ts`

**Interfaces:**
- Produces: `HubNav` now includes `'help'`; `NAV_ROUTES.help === '/help'`; `activeNavFromPath('/help') === 'help'`; `NAV_ICONS.help` React node; `LeftRail` renders Help and no Settings.
- Consumes: `HelpPage` (Task 11) for the route — until Task 11 lands, point the route at `Hub` as a placeholder is NOT allowed; instead add the route in Task 11. In THIS task only wire nav data + rail; add the `/help` route in Task 11.

- [ ] **Step 1: Write the failing test** — append to `src/ui/layouts/navRoutes.test.ts`:

```ts
import { NAV_ROUTES, activeNavFromPath } from './navRoutes'

it('maps help nav to /help and back', () => {
  expect(NAV_ROUTES.help).toBe('/help')
  expect(activeNavFromPath('/help')).toBe('help')
})
```

- [ ] **Step 2: Run — expect FAIL** (`help` not on `NAV_ROUTES`): `npx vitest run src/ui/layouts/navRoutes.test.ts`

- [ ] **Step 3: Extend the nav types + routes**

`hubMockData.ts` line 3:
```ts
export type HubNav = 'lobby' | 'pack' | 'royale' | 'gacha' | 'mana' | 'ranks' | 'help'
```
`hubMockData.ts` `NAV_ITEMS` (add Help after Leaderboard):
```ts
export const NAV_ITEMS: { id: HubNav; icon: string; label: string }[] = [
  { id: 'lobby',  icon: '⌂',  label: 'Lobby'  },
  { id: 'gacha',  icon: '🎰', label: 'Gacha'  },
  { id: 'ranks',  icon: '🏆', label: 'Leaderboard'  },
  { id: 'help',   icon: '?',  label: 'Help'  },
]
```
`navRoutes.ts` — add `help: '/help'` to `NAV_ROUTES` and a branch to `activeNavFromPath`:
```ts
export const NAV_ROUTES: Record<HubNav, string> = {
  lobby: '/app', ranks: '/leaderboard', pack: '/play/arena', royale: '/play/royale',
  gacha: '/play/gacha', mana: '/play/mana', help: '/help',
}
```
In `activeNavFromPath`, before the final `return null`, add:
```ts
  if (pathname.startsWith('/help')) return 'help'
```

- [ ] **Step 4: Rail — add Help icon + item, remove Settings + avatar**

In `LeftRail.tsx` add to `NAV_ICONS` (the `?`-in-circle from the mockup):
```tsx
  help: <Svg><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></Svg>,
```
Add Help to `ITEMS`:
```tsx
const ITEMS: { id: HubNav; label: string }[] = [
  { id: 'lobby', label: 'Lobby' },
  { id: 'gacha', label: 'Gacha' },
  { id: 'ranks', label: 'Leaderboard' },
  { id: 'help', label: 'Help' },
]
```
Delete the `{/* Settings */}` `<button>` block and the `{/* Profile avatar */}` `<button>` block (lines ~113-133). Keep the `<div style={{ flex: 1 }} />` spacer. The `onProfile` prop becomes unused → remove it from the `LeftRail` signature and from its call site in `AppShell.tsx` (`<LeftRail active={active} />`).

- [ ] **Step 5: Run tests + typecheck** — `npx vitest run src/ui/layouts/navRoutes.test.ts && npm run build`
Expected: PASS; build clean (the `/help` route is added in Task 11 — `HelpPage` import there; this task leaves App.tsx untouched).

- [ ] **Step 6: Commit**
```bash
git add src/ui/screens/Hub/hubMockData.ts src/ui/layouts/navRoutes.ts src/ui/layouts/navRoutes.test.ts src/ui/screens/Hub/LeftRail.tsx src/ui/layouts/AppShell.tsx
git commit -m "feat(lobby): add Help nav item; drop rail Settings + standalone avatar"
```

---

## Task 2: Compact header profile (icon-only)

**Files:**
- Modify: `src/ui/components/AuthButtons.tsx`
- Modify: `src/ui/components/AuthButtons.test.tsx` (create if absent)

**Interfaces:**
- Produces: `AuthButtons` with `variant="compact"` renders avatar + caret only — never the display name — while the dropdown still opens and contains Withdraw / My Profile / Inventory / Log out.

- [ ] **Step 1: Write the failing test** — `src/ui/components/AuthButtons.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@privy-io/react-auth', () => ({
  usePrivy: () => ({ ready: true, authenticated: true, user: { wallet: { address: 'ABCDEFGHIJKL' } }, login: vi.fn(), logout: vi.fn() }),
}))
vi.mock('../../hooks/useProfile', () => ({ useProfile: () => ({ username: 'satoshi' }) }))

import { AuthButtons } from './AuthButtons'

describe('AuthButtons compact', () => {
  it('hides the display name but opens the dropdown', () => {
    render(<MemoryRouter><AuthButtons variant="compact" /></MemoryRouter>)
    // name not shown on the trigger
    expect(screen.queryByText('satoshi')).toBeNull()
    // caret trigger present; open it
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('My Profile')).toBeTruthy()
    expect(screen.getByText('Log out')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`satoshi` currently renders on the compact trigger): `npx vitest run src/ui/components/AuthButtons.test.tsx`

- [ ] **Step 3: Implement** — in `AuthButtons.tsx`, force name off in compact. Replace:
```tsx
  const showName = wide
```
with:
```tsx
  const showName = wide && !isCompact   // compact header trigger is icon-only (avatar + caret)
```
(No other change; the dropdown identity header already shows the name.)

- [ ] **Step 4: Run — expect PASS**: `npx vitest run src/ui/components/AuthButtons.test.tsx`

- [ ] **Step 5: Commit**
```bash
git add src/ui/components/AuthButtons.tsx src/ui/components/AuthButtons.test.tsx
git commit -m "feat(lobby): compact header profile is icon-only (no name)"
```

---

## Task 3: BigPullTicker + ba-ticker CSS

**Files:**
- Create: `src/ui/screens/Hub/BigPullTicker.tsx`
- Modify: `src/index.css` (append `ba-ticker`)
- Test: `src/ui/screens/Hub/BigPullTicker.test.tsx`

**Interfaces:**
- Consumes: `useDrops()` → `LiveDrop[]` (`{ name, valueUsd, rarity, username, wallet, ... }`); `shortWallet` from `../battle/royaleShared`; `formatUsd`, `rarityGlow` from `../../theme`.
- Produces: `BigPullTicker()` — a marquee; renders `null` when there are no drops.

- [ ] **Step 1: Write the failing test** — `BigPullTicker.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const drops = vi.hoisted(() => ({ value: [] as any[] }))
vi.mock('../../drops/useDrops', () => ({ useDrops: () => drops.value }))
vi.mock('../../useReducedMotion', () => ({ useReducedMotion: () => false }))

import { BigPullTicker } from './BigPullTicker'

describe('BigPullTicker', () => {
  it('renders nothing with no drops', () => {
    drops.value = []
    const { container } = render(<BigPullTicker meWallet={null} />)
    expect(container.firstChild).toBeNull()
  })
  it('renders a row per drop', () => {
    drops.value = [
      { id: 'a', name: 'Charizard', valueUsd: 2400, rarity: 'epic', username: 'Kx', wallet: 'Kx', source: 'gacha', ts: 1, image: null },
    ]
    render(<BigPullTicker meWallet={null} />)
    expect(screen.getAllByText(/Charizard/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/\$2\.4k|\$2,400/).length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (module missing): `npx vitest run src/ui/screens/Hub/BigPullTicker.test.tsx`

- [ ] **Step 3: Implement** — `BigPullTicker.tsx`:

```tsx
import { COLORS, FONTS, formatUsd, rarityGlow } from '../../theme'
import { shortWallet } from '../battle/royaleShared'
import { useDrops } from '../../drops/useDrops'
import { useReducedMotion } from '../../useReducedMotion'

export function BigPullTicker({ meWallet }: { meWallet: string | null }) {
  const drops = useDrops()
  const reduced = useReducedMotion()
  if (drops.length === 0) return null

  const items = drops.slice(0, 12)
  const row = (d: (typeof items)[number], i: number) => {
    const mine = !!meWallet && d.wallet === meWallet
    const accent = rarityGlow(d.rarity) ?? COLORS.green   // rarityGlow can return null
    const who = d.username ?? shortWallet(d.wallet)
    return (
      <span key={`${d.id}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0 26px', fontFamily: FONTS.mono, fontSize: 11.5, whiteSpace: 'nowrap', color: '#8b95a3' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent, boxShadow: `0 0 6px ${accent}` }} />
        <span style={{ color: mine ? COLORS.green : '#cdd4dd' }}>{who}</span> pulled {d.name}
        <span style={{ color: accent, fontWeight: 700 }}>{formatUsd(d.valueUsd ?? 0)}</span>
      </span>
    )
  }

  return (
    <div style={{ position: 'relative', overflow: 'hidden', margin: '0 0 20px', padding: '8px 0', borderBottom: `1px solid ${COLORS.border}`, background: 'rgba(255,255,255,.016)' }}>
      <div style={{ display: 'flex', width: 'max-content', animation: reduced ? 'none' : 'ba-ticker 36s linear infinite' }}>
        {items.map(row)}
        {!reduced && items.map((d, i) => row(d, i + items.length))}
      </div>
      <span style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 70, background: 'linear-gradient(90deg,#0a0710,transparent)', pointerEvents: 'none' }} />
      <span style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 70, background: 'linear-gradient(270deg,#0a0710,transparent)', pointerEvents: 'none' }} />
    </div>
  )
}
```
Append to `src/index.css`:
```css
/* Lobby big-pull ticker */
@keyframes ba-ticker { 0% { transform: translateX(0) } 100% { transform: translateX(-50%) } }
```
> `rarityGlow(rarity) -> string | null` is exported from `theme.ts:52`; the `?? COLORS.green` fallback covers the null case. Do not invent a color map.

- [ ] **Step 4: Run — expect PASS**: `npx vitest run src/ui/screens/Hub/BigPullTicker.test.tsx`

- [ ] **Step 5: Commit**
```bash
git add src/ui/screens/Hub/BigPullTicker.tsx src/ui/screens/Hub/BigPullTicker.test.tsx src/index.css
git commit -m "feat(lobby): BigPullTicker marquee from the local drops store"
```

---

## Task 4: BestHitCard

**Files:**
- Create: `src/ui/screens/Hub/BestHitCard.tsx`
- Test: `src/ui/screens/Hub/BestHitCard.test.tsx`

**Interfaces:**
- Consumes: `useDrops()`; `shortWallet`; `formatUsd`, `rarityColor`(from `../battle/RevealCard`) or `rarityGlow`.
- Produces: `BestHitCard({ meWallet })` — shows the single highest-`valueUsd` drop; `null` when no drops. No "watch the reveal" link.

- [ ] **Step 1: Write the failing test** — `BestHitCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const drops = vi.hoisted(() => ({ value: [] as any[] }))
vi.mock('../../drops/useDrops', () => ({ useDrops: () => drops.value }))

import { BestHitCard } from './BestHitCard'

describe('BestHitCard', () => {
  it('renders nothing with no drops', () => {
    drops.value = []
    const { container } = render(<BestHitCard meWallet={null} />)
    expect(container.firstChild).toBeNull()
  })
  it('shows the highest-value drop', () => {
    drops.value = [
      { id: 'a', name: 'Low', valueUsd: 50, rarity: 'common', username: 'x', wallet: 'x', image: null, ts: 2 },
      { id: 'b', name: 'Charizard', valueUsd: 2400, rarity: 'epic', username: 'Kx', wallet: 'Kx', image: null, ts: 1 },
    ]
    render(<BestHitCard meWallet={null} />)
    expect(screen.getByText('Charizard')).toBeTruthy()
    expect(screen.getByText(/Kx/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**: `npx vitest run src/ui/screens/Hub/BestHitCard.test.tsx`

- [ ] **Step 3: Implement** — `BestHitCard.tsx`:

```tsx
import { useState } from 'react'
import { COLORS, FONTS, formatUsd } from '../../theme'
import { rarityColor } from '../battle/RevealCard'
import { shortWallet } from '../battle/royaleShared'
import { useDrops } from '../../drops/useDrops'

export function BestHitCard({ meWallet }: { meWallet: string | null }) {
  const drops = useDrops()
  const [imgErr, setImgErr] = useState(false)
  if (drops.length === 0) return null
  const top = drops.reduce((a, b) => ((b.valueUsd ?? 0) > (a.valueUsd ?? 0) ? b : a))
  const accent = rarityColor(top.rarity)
  const mine = !!meWallet && top.wallet === meWallet
  const who = top.username ?? shortWallet(top.wallet)

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 20, padding: 20, background: 'linear-gradient(150deg,rgba(245,197,66,.12),rgba(13,17,22,.65) 58%)', border: '1px solid rgba(245,197,66,.32)', boxShadow: '0 24px 70px -34px rgba(245,197,66,.45)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#f5c542', boxShadow: '0 0 8px #f5c542' }} />
        <span style={{ fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '.22em', color: '#f5c542' }}>BEST HIT</span>
      </div>
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ width: 124, height: 172, flex: 'none', borderRadius: 10, overflow: 'hidden', background: '#0c1019', border: `1px solid ${COLORS.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {top.image && !imgErr
            ? <img src={top.image} alt={top.name} onError={() => setImgErr(true)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            : <span style={{ fontSize: 46 }}>🃏</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 15.5, fontWeight: 700, lineHeight: 1.25, color: COLORS.text }}>{top.name}</div>
          {top.rarity && <div style={{ fontSize: 12, color: '#8b95a3', marginTop: 4, textTransform: 'capitalize' }}>{top.rarity}</div>}
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-.02em', color: accent, marginTop: 12 }}>{formatUsd(top.valueUsd ?? 0)}</div>
          <div style={{ fontSize: 12, color: '#9aa4b2', marginTop: 'auto', paddingTop: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Pulled by <span style={{ color: mine ? COLORS.green : '#cdd4dd', fontWeight: 600 }}>{who}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run — expect PASS**: `npx vitest run src/ui/screens/Hub/BestHitCard.test.tsx`

- [ ] **Step 5: Commit**
```bash
git add src/ui/screens/Hub/BestHitCard.tsx src/ui/screens/Hub/BestHitCard.test.tsx
git commit -m "feat(lobby): BestHitCard from the top local drop"
```

---

## Task 5: NewsCarousel + LOBBY_NEWS config

**Files:**
- Create: `src/ui/screens/Hub/lobbyNews.ts`, `src/ui/screens/Hub/NewsCarousel.tsx`
- Test: `src/ui/screens/Hub/NewsCarousel.test.tsx`

**Interfaces:**
- Produces: `LOBBY_NEWS: NewsItem[]` (`{ id, tag, accent, title, sub, cta, href }`); `NewsCarousel()` renders the current item, prev/next advance, auto-advance under fake timers.

- [ ] **Step 1: Write the failing test** — `NewsCarousel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
vi.mock('../../useReducedMotion', () => ({ useReducedMotion: () => true }))  // no auto-advance in this test
import { NewsCarousel } from './NewsCarousel'
import { LOBBY_NEWS } from './lobbyNews'

describe('NewsCarousel', () => {
  it('shows the first item and advances on next', () => {
    render(<MemoryRouter><NewsCarousel /></MemoryRouter>)
    expect(screen.getByText(LOBBY_NEWS[0].title)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Next'))
    expect(screen.getByText(LOBBY_NEWS[1].title)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**: `npx vitest run src/ui/screens/Hub/NewsCarousel.test.tsx`

- [ ] **Step 3: Implement config** — `lobbyNews.ts` (real features only, no invented events):

```ts
import { COLORS } from '../../theme'

export interface NewsItem { id: string; tag: string; accent: string; title: string; sub: string; cta: string; href: string }

export const LOBBY_NEWS: NewsItem[] = [
  { id: 'royale', tag: 'GAME MODE', accent: '#ff6bb5', title: 'Battle Royale is live', sub: 'Up to 10 players open packs in rounds — the lowest value drops each round, last one standing takes the pot.', cta: 'How it works', href: '/help#royale' },
  { id: 'fair', tag: 'FAIRNESS', accent: COLORS.green, title: 'Provably-fair pulls', sub: 'Every pull is verifiable and settlement is trustless on Solana. The card edge comes from insured value, nothing anyone can move.', cta: 'Learn more', href: '/help#features' },
  { id: 'deposit', tag: 'WALLET', accent: '#4ea8ff', title: 'Deposit USDC from any chain', sub: 'Top up without a seed phrase. Your balance shows what is free vs. reserved in open lobbies.', cta: 'Open help', href: '/help#features' },
  { id: 'gimmi', tag: 'REWARDS', accent: '#f5c542', title: 'Earn Gimmighouls as you play', sub: 'In-app points tracked next to your balance — earned on every battle and pull.', cta: 'Learn more', href: '/help#features' },
]
```

- [ ] **Step 4: Implement carousel** — `NewsCarousel.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { COLORS, FONTS } from '../../theme'
import { useReducedMotion } from '../../useReducedMotion'
import { LOBBY_NEWS } from './lobbyNews'

const INTERVAL_MS = 8000

export function NewsCarousel() {
  const reduced = useReducedMotion()
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const n = LOBBY_NEWS.length
  const next = () => setI((x) => (x + 1) % n)
  const prev = () => setI((x) => (x - 1 + n) % n)

  useEffect(() => {
    if (reduced || paused) return
    const t = setInterval(next, INTERVAL_MS)
    return () => clearInterval(t)
  }, [reduced, paused])

  const cur = LOBBY_NEWS[i]
  const rgba = (hex: string, a: number) => hex  // accents already include their own alpha via usage below

  return (
    <section onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} style={{ marginBottom: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '.2em', color: COLORS.violet }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: COLORS.violet, boxShadow: `0 0 8px ${COLORS.violet}` }} />WHAT'S NEW
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: '#5c6675' }}>{i + 1}/{n}</span>
          <button aria-label="Previous" onClick={prev} style={arrowBtn}>‹</button>
          <button aria-label="Next" onClick={next} style={arrowBtn}>›</button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: '2 1 380px', minWidth: 280, position: 'relative', overflow: 'hidden', borderRadius: 20, padding: 'clamp(20px,2.4vw,28px)', background: `linear-gradient(120deg,${cur.accent}22,rgba(13,17,22,.55) 55%,rgba(255,255,255,.02))`, border: `1px solid ${COLORS.border}` }}>
          <span style={{ display: 'inline-flex', padding: '5px 12px', borderRadius: 999, background: `${cur.accent}22`, border: `1px solid ${cur.accent}66`, fontFamily: FONTS.mono, fontSize: 11, color: cur.accent, marginBottom: 14 }}>{cur.tag}</span>
          <h2 style={{ margin: '0 0 9px', fontFamily: FONTS.display, fontSize: 'clamp(22px,2.6vw,30px)', fontWeight: 700, letterSpacing: '-.025em' }}>{cur.title}</h2>
          <p style={{ margin: '0 0 18px', maxWidth: 460, fontSize: 14.5, lineHeight: 1.55, color: '#b8c0cb' }}>{cur.sub}</p>
          <Link to={cur.href} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 22px', borderRadius: 12, fontFamily: FONTS.display, fontSize: 14, fontWeight: 700, color: '#06170f', background: cur.accent }}>{cur.cta} →</Link>
        </div>
        <div style={{ flex: '1 1 240px', minWidth: 220, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {LOBBY_NEWS.map((nw, idx) => (
            <button key={nw.id} onClick={() => setI(idx)} style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', padding: '12px 13px', borderRadius: 14, cursor: 'pointer', border: `1px solid ${idx === i ? `${nw.accent}66` : COLORS.border}`, background: idx === i ? `${nw.accent}1a` : 'rgba(255,255,255,.028)', flex: 1 }}>
              <span style={{ flex: 'none', width: 8, height: 8, borderRadius: '50%', background: nw.accent, boxShadow: `0 0 8px ${nw.accent}` }} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontFamily: FONTS.mono, fontSize: 9, letterSpacing: '.14em', color: nw.accent, marginBottom: 3 }}>{nw.tag}</span>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#e7ecf2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nw.title}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

const arrowBtn: React.CSSProperties = { width: 32, height: 32, borderRadius: 10, border: `1px solid ${COLORS.border}`, background: 'rgba(255,255,255,.04)', color: '#cdd4dd', cursor: 'pointer', fontSize: 16, lineHeight: 1 }
```
> Remove the unused `rgba` helper before committing (kept here only as a reminder that accents are applied with hex+alpha suffixes like `${accent}22`). YAGNI.

- [ ] **Step 5: Run — expect PASS**: `npx vitest run src/ui/screens/Hub/NewsCarousel.test.tsx`

- [ ] **Step 6: Commit**
```bash
git add src/ui/screens/Hub/lobbyNews.ts src/ui/screens/Hub/NewsCarousel.tsx src/ui/screens/Hub/NewsCarousel.test.tsx
git commit -m "feat(lobby): What's New carousel from LOBBY_NEWS config"
```

---

## Task 6: ModeGuide (collapsible)

**Files:**
- Create: `src/ui/screens/Hub/ModeGuide.tsx`
- Test: `src/ui/screens/Hub/ModeGuide.test.tsx`

**Interfaces:**
- Produces: `ModeGuide()` — collapsible section; persists `ba.lobbyGuideOpen`; "Explain more" links → `/help#pack|#royale|#gacha`.

- [ ] **Step 1: Write the failing test** — `ModeGuide.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ModeGuide } from './ModeGuide'

beforeEach(() => localStorage.clear())

describe('ModeGuide', () => {
  it('shows the three modes and collapses (persisting the state)', () => {
    render(<MemoryRouter><ModeGuide /></MemoryRouter>)
    expect(screen.getByText('Pack Battle')).toBeTruthy()
    expect(screen.getByText('Battle Royale')).toBeTruthy()
    expect(screen.getByText('Gacha')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /got it/i }))
    expect(localStorage.getItem('ba.lobbyGuideOpen')).toBe('0')
    expect(screen.queryByText('Pack Battle')).toBeNull()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**: `npx vitest run src/ui/screens/Hub/ModeGuide.test.tsx`

- [ ] **Step 3: Implement** — `ModeGuide.tsx`:

```tsx
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { COLORS, FONTS } from '../../theme'

const KEY = 'ba.lobbyGuideOpen'

interface Mode { id: string; name: string; tag: string; accent: string; desc: string; icon: ReactNode }
const S = (d: string) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: d }} />
const MODES: Mode[] = [
  { id: 'pack', name: 'Pack Battle', tag: '1V1 · WINNER TAKES ALL', accent: COLORS.green, desc: 'Open a pack head-to-head. The higher pull takes both cards.', icon: S('<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" x2="9" y1="14" y2="18"/><line x1="7" x2="4" y1="17" y2="20"/><line x1="3" x2="5" y1="19" y2="21"/>') },
  { id: 'royale', name: 'Battle Royale', tag: '2–10 PLAYERS', accent: '#ff6bb5', desc: 'Up to 10 players open packs in rounds. The lowest value drops each round — last one standing takes the pot.', icon: S('<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.52l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/>') },
  { id: 'gacha', name: 'Gacha', tag: 'PULL → PLAY', accent: '#a98bff', desc: 'Open Collector Crypt packs solo and jump straight into a battle with whatever card you pull.', icon: S('<rect x="3" y="3" width="12" height="17" rx="1.2"/><path d="M3 9h12M3 15h12M7 9v6M11 9v6"/><path d="M5.5 5.5h7M5.5 7h7"/><path d="M15 11h2v3h-2"/><circle cx="19.5" cy="6" r="2"/><path d="M19.5 8v3"/>') },
]

export function ModeGuide() {
  const [open, setOpen] = useState<boolean>(() => { try { return localStorage.getItem(KEY) !== '0' } catch { return true } })
  const set = (v: boolean) => { setOpen(v); try { localStorage.setItem(KEY, v ? '1' : '0') } catch { /* ignore */ } }

  if (!open) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '12px 18px', marginBottom: 32, borderRadius: 14, background: 'rgba(255,255,255,.022)', border: `1px solid ${COLORS.border}` }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#cdd4dd' }}>New here? How each mode works</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => set(true)} style={pillBtn}>Show</button>
          <Link to="/help" style={{ ...pillBtn, display: 'inline-flex', alignItems: 'center', color: COLORS.green, borderColor: '#00ffc455', background: '#00ffc414' }}>Help →</Link>
        </div>
      </div>
    )
  }

  return (
    <section style={{ position: 'relative', overflow: 'hidden', borderRadius: 22, padding: 'clamp(20px,2.4vw,28px)', marginBottom: 32, background: 'linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,.008))', border: `1px solid ${COLORS.border}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '.26em', color: COLORS.green, marginBottom: 10 }}>GET STARTED</div>
          <h3 style={{ margin: '0 0 6px', fontFamily: FONTS.display, fontSize: 'clamp(22px,2.8vw,28px)', fontWeight: 700, letterSpacing: '-.02em' }}>New here? How each mode works</h3>
          <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, color: '#9aa4b2', maxWidth: 520 }}>Three ways to play with your graded cards. The quick version below — the full guide covers rules, odds and every feature.</p>
        </div>
        <div style={{ flex: 'none', display: 'flex', gap: 10 }}>
          <Link to="/help" style={{ ...pillBtn, display: 'inline-flex', alignItems: 'center', color: COLORS.green, borderColor: '#00ffc466', background: '#00ffc41a' }}>Open Help guide →</Link>
          <button onClick={() => set(false)} style={pillBtn}>Got it ✓</button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14 }}>
        {MODES.map((m) => (
          <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 20, borderRadius: 18, border: `1px solid ${m.accent}44`, background: `linear-gradient(180deg,${m.accent}12,rgba(255,255,255,.01))` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ flex: 'none', width: 44, height: 44, borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${m.accent}22`, border: `1px solid ${m.accent}59`, color: m.accent }}>{m.icon}</span>
              <div>
                <div style={{ fontSize: 16.5, fontWeight: 700, color: COLORS.text }}>{m.name}</div>
                <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.06em', color: m.accent, marginTop: 3 }}>{m.tag}</div>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: '#9aa4b2' }}>{m.desc}</p>
            <Link to={`/help#${m.id}`} style={{ marginTop: 'auto', paddingTop: 2, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: m.accent }}>Explain more →</Link>
          </div>
        ))}
      </div>
    </section>
  )
}

const pillBtn: React.CSSProperties = { padding: '8px 16px', borderRadius: 10, border: `1px solid ${COLORS.border}`, background: 'rgba(255,255,255,.04)', color: '#cdd4dd', cursor: 'pointer', fontFamily: FONTS.body, fontSize: 13, fontWeight: 600, textDecoration: 'none' }
```

- [ ] **Step 4: Run — expect PASS**: `npx vitest run src/ui/screens/Hub/ModeGuide.test.tsx`

- [ ] **Step 5: Commit**
```bash
git add src/ui/screens/Hub/ModeGuide.tsx src/ui/screens/Hub/ModeGuide.test.tsx
git commit -m "feat(lobby): collapsible ModeGuide with persisted state"
```

---

## Task 7: QuickMatch hero restyle

**Files:**
- Modify: `src/ui/screens/Hub/QuickMatch.tsx`

**Interfaces:**
- Consumes: unchanged props (`stakes`, `selectedStake`, `onStake`, `onCreate`, `onPlayDemo`, `stats?`).
- Produces: same component signature; visually matches the mockup's "QUICK MATCH" hero.

**Restyle spec (visual — the lobby-v2 mockup hero is the reference):** keep the exact prop interface and the tier/create/demo handlers. Change the layout to the mockup: eyebrow "QUICK MATCH" (mono, `COLORS.violet`), large display headline `Jump into a Pack Battle` (gradient span on "Pack Battle"), the blurb, the tier chips (active = green ring/tint as today), primary **Create battle** (with the `ba-sweep` shine overlay), and a dashed "or try a free demo →" link calling `onPlayDemo`. Remove the right-hand VS-cards + stats column (the `stats` prop becomes optional/unused — keep it in the signature for compatibility but stop rendering it). All colors from the palette; fonts from `FONTS`. No new deps.

- [ ] **Step 1: Guard test (behavior preserved)** — create `src/ui/screens/Hub/QuickMatch.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QuickMatch } from './QuickMatch'

describe('QuickMatch', () => {
  it('fires stake/create/demo handlers', () => {
    const onStake = vi.fn(), onCreate = vi.fn(), onPlayDemo = vi.fn()
    render(<QuickMatch selectedStake={50} onStake={onStake} onCreate={onCreate} onPlayDemo={onPlayDemo} />)
    fireEvent.click(screen.getByText('$125')); expect(onStake).toHaveBeenCalledWith(125)
    fireEvent.click(screen.getByText(/create battle/i)); expect(onCreate).toHaveBeenCalled()
    fireEvent.click(screen.getByText(/demo/i)); expect(onPlayDemo).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — expect PASS against the current component** (handlers already exist): `npx vitest run src/ui/screens/Hub/QuickMatch.test.tsx` — this test guards behavior across the restyle.

- [ ] **Step 3: Restyle** the component per the spec above (rewrite the JSX; keep imports of `COLORS/GRADIENT/FONTS`, `useReducedMotion`; drop the `MOCK_STATS` import and the VS/stats column). Use `animation: reducedMotion ? 'none' : 'ba-sweep 3.4s infinite'` on the shine overlay (the `ba-sweep` keyframe already exists in `index.css`).

- [ ] **Step 4: Run — expect PASS** (behavior intact) + typecheck: `npx vitest run src/ui/screens/Hub/QuickMatch.test.tsx && npm run build`

- [ ] **Step 5: Commit**
```bash
git add src/ui/screens/Hub/QuickMatch.tsx src/ui/screens/Hub/QuickMatch.test.tsx
git commit -m "feat(lobby): restyle QuickMatch hero to v2 mockup"
```

---

## Task 8: LiveBattles card restyle

**Files:**
- Modify: `src/ui/screens/Hub/LiveBattles.tsx`

**Interfaces:**
- Consumes: unchanged `Props` (`battles`, `onSelectMode`, `onBattleAction`, `onCancel?`, `onOpen`); `LiveBattle` fields (`mode, live, pot, entry, slots, statusText, statusColor, players[{violet}], action, canCancel, costLabel/costValue`).
- Produces: same signature; card grid matching the mockup "Live games".

**Restyle spec (visual — the lobby-v2 "Live games" section is the reference):** keep the header ("Live games" + a live count + the existing filter chips) and every handler. Restyle each battle card to: a mode chip (`MODE_LABEL[b.mode]`, colored per mode — pack=green, royale=`#ff6bb5`, mana=`#a98bff`), a status dot + `b.statusText` in `b.statusColor`, **EST POT** (`formatUsd(b.pot)`) + entry/buy-in (`b.costLabel` / `formatUsd(b.entry)`), stacked player avatars (violet vs green initials) with pulsing empty-slot rings for open seats (parse `b.slots` "x/y"), and the action button (`b.action === 'watch'` → ghost "Watch" via `onOpen`; else primary "Join" via `onBattleAction`; if `b.canCancel` show a danger "Cancel" via `onCancel`). Preserve the existing empty-state and the mode tiles. Colors/fonts from the palette. Add the empty-slot pulse via a keyframe already present or a new `ba-slotpulse` in `index.css` if needed.

- [ ] **Step 1: Confirm existing tests** — run the current suite for this file (there is `openBattleToLive.test.ts`; check for a LiveBattles render test): `npx vitest run src/ui/screens/Hub` and note which tests touch `LiveBattles`. These MUST stay green.

- [ ] **Step 2: Restyle** per the spec. If a `ba-slotpulse` keyframe is needed, append to `index.css`:
```css
/* Live-games empty-seat pulse */
@keyframes ba-slotpulse { 0%,100% { border-color: rgba(245,197,66,.5); box-shadow: 0 0 0 0 rgba(245,197,66,.3) } 50% { border-color: rgba(245,197,66,.9); box-shadow: 0 0 10px -2px rgba(245,197,66,.6) } }
```

- [ ] **Step 3: Add a focused render test** — `src/ui/screens/Hub/LiveBattles.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LiveBattles } from './LiveBattles'
import type { LiveBattle } from './hubMockData'

const b: LiveBattle = { id: 'b1', mode: 'royale', live: false, title: 'ROYALE', sub: '', players: [{ violet: false }, { violet: true }], cards: [], costLabel: 'ENTRY', costValue: 562, action: 'join', entry: 562, pot: 2300, slots: '2/4', statusText: 'Filling', statusColor: '#f5c542' }

describe('LiveBattles', () => {
  it('renders a card and fires join', () => {
    const onBattleAction = vi.fn()
    render(<LiveBattles battles={[b]} onSelectMode={vi.fn()} onBattleAction={onBattleAction} onOpen={vi.fn()} />)
    expect(screen.getByText(/EST\.? POT/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /join/i }))
    expect(onBattleAction).toHaveBeenCalledWith(b)
  })
})
```

- [ ] **Step 4: Run — expect PASS** (new + existing) + typecheck: `npx vitest run src/ui/screens/Hub && npm run build`

- [ ] **Step 5: Commit**
```bash
git add src/ui/screens/Hub/LiveBattles.tsx src/ui/screens/Hub/LiveBattles.test.tsx src/index.css
git commit -m "feat(lobby): restyle Live games cards to v2 mockup"
```

---

## Task 9: ChatDock — Recent Drops + chat restyle

**Files:**
- Modify: `src/ui/screens/Hub/ChatDock.tsx`
- Modify: `src/index.css` (append `ba-dropin`)

**Interfaces:**
- Consumes: unchanged (`useDrops`, `useChat`, existing props `collapsed`, `onToggle`, `chatOnly`).
- Produces: same signature; Recent Drops rows + chat rows restyled to the mockup.

**Restyle spec (visual — the lobby-v2 right rail is the reference):** keep all data/handlers, the collapse/resize behavior, and `chatOnly`. Restyle the "RECENT DROPS" header + rows (rarity-glow dot/tint, own-drop highlight, `formatUsd(valueUsd)`, relative time, a "BIG PULL" gold badge when `valueUsd >= 1000`) and the chat rows/input. New drops animate in with `ba-dropin` (skip when reduced motion).

- [ ] **Step 1: Append CSS** to `src/index.css`:
```css
/* Recent-drops row entrance */
@keyframes ba-dropin { 0% { opacity: 0; transform: translateY(-10px) } 100% { opacity: 1; transform: translateY(0) } }
```

- [ ] **Step 2: Restyle** the Recent Drops + chat sections per the spec (preserve the resize drag, the collapse toggle, `chatOnly`, and the `useDrops`/`useChat` wiring). Gate `ba-dropin` on `!useReducedMotion()`.

- [ ] **Step 3: Guard test** — if `ChatDock` has existing tests, keep them green; otherwise add `src/ui/screens/Hub/ChatDock.test.tsx` rendering with a mocked `useDrops` (one big-pull drop) and `useChat` (empty) and asserting the drop name + "BIG PULL" badge render. Mock both hooks like the other Hub tests.

- [ ] **Step 4: Run — expect PASS** + typecheck: `npx vitest run src/ui/screens/Hub && npm run build`

- [ ] **Step 5: Commit**
```bash
git add src/ui/screens/Hub/ChatDock.tsx src/ui/screens/Hub/ChatDock.test.tsx src/index.css
git commit -m "feat(lobby): restyle Recent Drops + chat rail to v2 mockup"
```

---

## Task 10: Compose the Hub

**Files:**
- Modify: `src/ui/screens/Hub/Hub.tsx`
- Modify: `src/ui/flows` N/A

**Interfaces:**
- Consumes: `BigPullTicker`, `BestHitCard`, `NewsCarousel`, `ModeGuide` (Tasks 3–6); `useEmbeddedSolanaAddress` (already imported for `meWallet`).
- Produces: the assembled lobby.

- [ ] **Step 1: Assemble** — in `Hub.tsx`, inside the content `<div style={{ padding: '24px 16px 40px' }}>`, order the sections to match the mockup:
```tsx
      <BigPullTicker meWallet={meWallet} />
      <div style={{ padding: '24px 16px 40px' }}>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: 26 }}>
          <div style={{ flex: '1 1 380px', minWidth: 280 }}>
            <QuickMatch selectedStake={stake} onStake={setStake} onCreate={() => setCreateOpen(true)} onPlayDemo={() => setDemoOpen(true)} />
          </div>
          <div style={{ flex: '1 1 300px', minWidth: 280, maxWidth: 410 }}>
            <BestHitCard meWallet={meWallet} />
          </div>
        </div>
        <NewsCarousel />
        <ModeGuide />
        {actionError && (<div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.red, margin: '0 0 12px' }}>{actionError}</div>)}
        <LiveBattles battles={liveBattles} onSelectMode={go} onBattleAction={onBattleAction} onCancel={onCancel} onOpen={(b) => navigate('/play/battle/' + b.id)} />
      </div>
```
Add imports for the four new components. Note the `BigPullTicker` sits above the padded content block (edge-to-edge) — place it before the padded `<div>`; remove the now-duplicated old padded wrapper so there is exactly one. Keep the existing "Lobby · N open lobbies" header row above.

- [ ] **Step 2: Run the Hub tests + full suite + typecheck**: `npx vitest run && npm run build`
Expected: all pass; build clean.

- [ ] **Step 3: Commit**
```bash
git add src/ui/screens/Hub/Hub.tsx
git commit -m "feat(lobby): compose ticker + best-hit + news + mode guide into the Hub"
```

---

## Task 11: Help page + route

**Files:**
- Create: `src/ui/screens/Help/helpContent.ts`, `src/ui/screens/Help/HelpPage.tsx`
- Modify: `src/App.tsx` (route)
- Test: `src/ui/screens/Help/HelpPage.test.tsx`

**Interfaces:**
- Consumes: react-router `Link`; `COLORS/FONTS/GRADIENT`.
- Produces: `HelpPage()` rendered at `/help` inside `AppShell`; TOC anchors `#modes/#pack/#royale/#gacha/#features`.

- [ ] **Step 1: Write the failing test** — `HelpPage.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HelpPage } from './HelpPage'

describe('HelpPage', () => {
  it('renders the modes and the platform-fee disclosure', () => {
    render(<MemoryRouter><HelpPage /></MemoryRouter>)
    expect(screen.getByText('How Collector Arena works')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Pack Battle' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Battle Royale' })).toBeTruthy()
    expect(screen.getByText('Platform fee')).toBeTruthy()   // fee disclosure card
  })
})
```

- [ ] **Step 2: Run — expect FAIL**: `npx vitest run src/ui/screens/Help/HelpPage.test.tsx`

- [ ] **Step 3: Content** — `helpContent.ts` (data-driven, from the Help mockup + a fee card):

```ts
import { COLORS } from '../../theme'

export interface HelpMode { id: string; name: string; tag: string; accent: string; desc: string; steps: string[]; iconPaths: string }
export interface HelpFeature { title: string; body: string; accent: string; iconPaths: string }

export const HELP_MODES: HelpMode[] = [
  { id: 'pack', name: 'Pack Battle', tag: '1V1 · WINNER TAKES ALL', accent: COLORS.green,
    desc: 'Two players put up the same buy-in and each open a pack. The higher total insured value takes both cards.',
    steps: ['Pick a buy-in ($10–$250) and create or join a battle.', 'Both players open their pack at the same time.', 'Higher insured value wins both cards.'],
    iconPaths: '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" x2="9" y1="14" y2="18"/><line x1="7" x2="4" y1="17" y2="20"/><line x1="3" x2="5" y1="19" y2="21"/>' },
  { id: 'royale', name: 'Battle Royale', tag: '2–10 PLAYERS · LAST ONE STANDING', accent: '#ff6bb5',
    desc: 'A lobby of up to 10 players opens packs in synchronized rounds. After each round the lowest total value is eliminated. The last player standing takes the entire pot.',
    steps: ['Join a lobby and wait for the seats to fill.', 'Open your pack each round; the lowest value is eliminated.', 'Outlast everyone to take the whole pot.'],
    iconPaths: '<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.52l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/>' },
  { id: 'gacha', name: 'Gacha', tag: 'SOLO · PULL → PLAY', accent: '#a98bff',
    desc: 'Open Collector Crypt packs on your own to build your collection. Every card you pull is a real graded NFT you own — and you can take it straight into a battle.',
    steps: ['Choose a machine by set and price tier.', 'Pull your card — a provably-fair reveal.', 'Keep it, or jump straight into a battle.'],
    iconPaths: '<rect x="3" y="3" width="12" height="17" rx="1.2"/><path d="M3 9h12M3 15h12M7 9v6M11 9v6"/><path d="M5.5 5.5h7M5.5 7h7"/><path d="M15 11h2v3h-2"/><circle cx="19.5" cy="6" r="2"/><path d="M19.5 8v3"/>' },
]

export const HELP_FEATURES: HelpFeature[] = [
  { title: 'Wallet & deposits', accent: COLORS.green, body: 'Deposit USDC from any chain — no seed phrase. Your balance shows what is free vs. reserved in open lobbies.', iconPaths: '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>' },
  { title: 'Gimmighouls', accent: '#f5c542', body: 'The in-app points you earn by playing. Track them next to your balance and spend them on perks and events.', iconPaths: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9 12h6"/>' },
  { title: 'The radio', accent: '#a98bff', body: 'A live station plays while you are in the app. Play/pause, skip stations, or adjust volume from the top bar.', iconPaths: '<path d="M11 4.7 6.5 8.3H3v7.4h3.5L11 19.3z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M19 6.5a8 8 0 0 1 0 11"/>' },
  { title: 'Recent drops', accent: COLORS.green, body: 'A live feed of cards pulled across the arena. Your own drops are highlighted so you can spot them at a glance.', iconPaths: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>' },
  { title: 'Provably fair', accent: COLORS.green, body: "Every pull is verifiable and the card edge comes from insured value — not prices anyone can move.", iconPaths: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>' },
  { title: 'Platform fee', accent: '#4ea8ff', body: 'Battles charge a small platform fee (0.5% per player, capped) on the winner’s buyback value, collected in USDC after payout. Solo gacha pulls have no fee.', iconPaths: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5a3 3 0 0 0-3-1.5c-1.7 0-3 1-3 2.2 0 2.8 6 1.4 6 4.1 0 1.3-1.3 2.2-3 2.2a3 3 0 0 1-3-1.5"/><path d="M12 6v12"/>' },
  { title: 'Trustless settlement', accent: '#4ea8ff', body: 'Stakes sit in on-chain escrow and pay out automatically on Solana. You sign, the program pays — we never custody your funds.', iconPaths: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>' },
]
```

- [ ] **Step 4: Implement** — `HelpPage.tsx` (renders inside AppShell; TOC + article + fee card). Uses `helpContent.ts`, our palette/fonts, in-page anchors, and a `:target { scroll-margin-top: 90px }` rule already fine via inline `scrollMarginTop` on each `<section id>`:

```tsx
import { Link } from 'react-router-dom'
import { COLORS, FONTS, GRADIENT } from '../../theme'
import { HELP_MODES, HELP_FEATURES } from './helpContent'

const Icon = ({ d, size = 22 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: d }} />
)

export function HelpPage() {
  return (
    <div style={{ padding: '20px clamp(16px,3vw,44px) 60px', maxWidth: 1120, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 26 }}>
        <Link to="/app" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 15px', borderRadius: 12, border: `1px solid ${COLORS.border}`, background: 'rgba(255,255,255,.04)', color: '#cdd4dd', fontSize: 14, fontWeight: 600 }}>‹ Back to Lobby</Link>
        <span style={{ fontFamily: FONTS.display, fontSize: 17, fontWeight: 700 }}>Help & Guides</span>
      </div>

      <div style={{ display: 'flex', gap: 34, alignItems: 'flex-start' }}>
        <aside style={{ position: 'sticky', top: 12, flex: 'none', width: 210, display: 'flex', flexDirection: 'column', gap: 2 }} className="hp-toc">
          <div style={{ fontFamily: FONTS.mono, fontSize: 10.5, letterSpacing: '.2em', color: '#5c6675', padding: '0 12px 10px' }}>ON THIS PAGE</div>
          <a href="#modes" style={tocLink}>Game modes</a>
          {HELP_MODES.map((m) => <a key={m.id} href={`#${m.id}`} style={{ ...tocLink, paddingLeft: 24, fontSize: 13 }}>{m.name}</a>)}
          <a href="#features" style={{ ...tocLink, marginTop: 6 }}>Features & fairness</a>
        </aside>

        <article style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 11.5, letterSpacing: '.26em', color: COLORS.green, marginBottom: 14 }}>HELP CENTER</div>
          <h1 style={{ margin: '0 0 14px', fontFamily: FONTS.display, fontSize: 'clamp(30px,4.4vw,46px)', fontWeight: 700, lineHeight: 1.02, letterSpacing: '-.03em' }}>How Collector Arena works</h1>
          <p style={{ margin: '0 0 34px', maxWidth: 620, fontSize: 16.5, lineHeight: 1.62, color: '#9aa4b2' }}>Every game uses your graded Collector Crypt NFTs as the playing piece. Card value can give an edge, but skill and luck decide the winner — and settlement is trustless on Solana.</p>

          <h2 id="modes" style={{ ...h2, scrollMarginTop: 90 }}>Game modes</h2>
          <div style={hr} />
          {HELP_MODES.map((m) => (
            <section key={m.id} id={m.id} style={{ scrollMarginTop: 90, marginBottom: 34, padding: 26, borderRadius: 20, background: `linear-gradient(180deg,${m.accent}0d,rgba(255,255,255,.008))`, border: `1px solid ${COLORS.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                <span style={{ flex: 'none', width: 50, height: 50, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${m.accent}22`, border: `1px solid ${m.accent}59`, color: m.accent }}><Icon d={m.iconPaths} size={24} /></span>
                <div>
                  <h3 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 21, fontWeight: 700 }}>{m.name}</h3>
                  <div style={{ fontFamily: FONTS.mono, fontSize: 10.5, letterSpacing: '.08em', color: m.accent, marginTop: 4 }}>{m.tag}</div>
                </div>
              </div>
              <p style={{ margin: '0 0 20px', maxWidth: 640, fontSize: 15, lineHeight: 1.62, color: '#b8c0cb' }}>{m.desc}</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
                {m.steps.map((s, i) => (
                  <div key={i} style={{ padding: '14px 16px', borderRadius: 13, background: 'rgba(255,255,255,.03)', border: `1px solid ${COLORS.border}` }}>
                    <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: m.accent, marginBottom: 6 }}>STEP {i + 1}</div>
                    <div style={{ fontSize: 13.5, color: '#d4dae2' }}>{s}</div>
                  </div>
                ))}
              </div>
            </section>
          ))}

          <h2 id="features" style={{ ...h2, scrollMarginTop: 90 }}>Features & fairness</h2>
          <div style={hr} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14 }}>
            {HELP_FEATURES.map((f) => (
              <div key={f.title} style={{ padding: 22, borderRadius: 18, background: 'rgba(255,255,255,.022)', border: `1px solid ${COLORS.border}` }}>
                <span style={{ display: 'flex', width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', background: `${f.accent}1a`, border: `1px solid ${f.accent}4d`, color: f.accent, marginBottom: 14 }}><Icon d={f.iconPaths} size={20} /></span>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{f.title}</div>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: '#8b95a3' }}>{f.body}</p>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 44, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '24px 26px', borderRadius: 20, background: 'linear-gradient(135deg,rgba(255,46,151,.14),rgba(13,17,22,.5) 48%,rgba(0,255,196,.1))', border: `1px solid ${COLORS.border}` }}>
            <div style={{ flex: '1 1 300px' }}>
              <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 4 }}>Ready to play?</div>
              <div style={{ fontSize: 14, color: '#9aa4b2' }}>Pick a mode and jump into a live lobby.</div>
            </div>
            <Link to="/app" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '14px 26px', borderRadius: 13, fontFamily: FONTS.display, fontSize: 15, fontWeight: 700, color: '#06170f', background: GRADIENT }}>Back to Lobby →</Link>
          </div>
        </article>
      </div>
    </div>
  )
}

const h2: React.CSSProperties = { margin: '0 0 8px', fontFamily: FONTS.display, fontSize: 26, fontWeight: 700, letterSpacing: '-.02em' }
const hr: React.CSSProperties = { height: 1, background: COLORS.border, marginBottom: 30 }
const tocLink: React.CSSProperties = { padding: '9px 12px', borderRadius: 9, fontSize: 13.5, color: '#9aa4b2', textDecoration: 'none' }
```
> The `.hp-toc` responsive hide on mobile is optional; if wanted, add a media rule in `index.css` (`@media (max-width:900px){ .hp-toc{ display:none } }`).

- [ ] **Step 5: Add the route** — in `src/App.tsx`, under the `<Route element={<AppShell />}>` block, add:
```tsx
          <Route path="/help" element={<HelpPage />} />
```
and `import { HelpPage } from './ui/screens/Help/HelpPage'` at the top.

- [ ] **Step 6: Run — expect PASS** + full suite + typecheck: `npx vitest run && npm run build`

- [ ] **Step 7: Commit**
```bash
git add src/ui/screens/Help/helpContent.ts src/ui/screens/Help/HelpPage.tsx src/ui/screens/Help/HelpPage.test.tsx src/App.tsx
git commit -m "feat(help): /help page with mode guides + platform-fee disclosure"
```

---

## Self-Review

**1. Spec coverage:** palette/fonts constraint → Global Constraints + every task uses `theme.ts` (no Space Grotesk / mockup green). No-hardcoded-data → ticker/best-hit (T3/T4 `useDrops`), live games (T8 existing data), News is our config with real copy (T5), mode/help copy is UI text (T6/T11). Compact profile → T2. Rail (drop Settings+avatar, add Help) → T1. Ticker → T3; hero+best-hit → T4/T7/T10; What's New → T5; mode guide → T6; live games → T8; drops+chat → T9. Help page inside app shell + fee disclosure → T11. Reduced-motion handled in T3/T5/T9/T7. ✅
**2. Placeholder scan:** New components have complete code. The three **restyle** tasks (T7 QuickMatch, T8 LiveBattles, T9 ChatDock) intentionally give a precise restyle SPEC + behavior-guard tests rather than re-transcribing the mockup's pixels — a conscious choice for a visual restyle where the mockup HTML in the conversation is the pixel reference and the existing files carry the structure/handlers to preserve. Reviewers should verify (a) props/handlers unchanged, (b) palette/fonts used (no `#2fe28a`/Space Grotesk), (c) guard tests green. No TBD/TODO. The `rgba` helper in T5 is flagged for removal (YAGNI). ✅
**3. Type consistency:** `HubNav` gains `'help'` (T1) and is used by `NAV_ROUTES`/`activeNavFromPath`/`NAV_ICONS`/`NAV_ITEMS`. `BigPullTicker`/`BestHitCard` take `{ meWallet: string | null }` (T3/T4) and are called with `meWallet` in T10. `NewsItem`/`HELP_MODES`/`HELP_FEATURES` shapes are defined once and consumed in the same task. `LiveBattle` fields used in T8 match `hubMockData.ts`. `rarityColor` imported from `../battle/RevealCard` (exists); verify `rarityGlow` export name in T3 before use. ✅
