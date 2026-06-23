# Mobile responsiveness pass (#mobile-1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The app fits and scrolls cleanly on a phone (≥360px): no horizontal page scroll; the audited offenders wrap/stack instead of overflowing.

**Architecture:** A global `overflow-x: clip` backstop in `index.css` + per-element fixes for the concrete offenders the audit found (lobby row/header, chat drawer width, a few raw `nowrap` spots). No redesign; leave the audited-healthy older screens alone.

**Tech Stack:** TypeScript, React 19, Vite, Tailwind, Vitest. Repo ROOT.

> **Verification reality (from the spec):** layout/responsiveness is NOT unit-testable in vitest/jsdom (no layout engine). So there are NO red→green tests. Each task is: make the edit → `npx tsc -b` (no type errors) → `npm test` (existing suite stays green, no regressions) → commit. After all tasks: `npm run build` clean + a **manual mobile spot-check by the user** (Hub lobby list, chat drawer, a battle flow — must fit with no horizontal scroll on a ≥360px phone).

## Global Constraints
- No horizontal page scroll at viewport widths ≥ 360px.
- Flex children holding text/variable content use `minWidth: 0`.
- No fixed pixel width wider than the smallest target viewport; wide fixed panels use `min(Npx, 100vw)`.
- Conservative: do NOT restructure the older audited-healthy screens; the `nowrap` pass only adds truncation where content can be long, else leaves the short fixed label (and the commit notes why).
- `useIsWide('(min-width: 640px)')` (`src/ui/useIsWide.ts`) is the responsive primitive.

---

### Task 1: Global overflow backstop (`src/index.css`)

**Files:** Modify `src/index.css` (the `body` rule + add an `html` rule).

- [ ] **Step 1: Edit.** Change the `body` block and add `html`:

```css
html { overflow-x: clip; }

body {
  background-color: #0b0e14;
  color: #e9edf5;
  font-family: 'Inter', system-ui, sans-serif;
  min-height: 100dvh;
  overflow-x: clip;   /* backstop: no horizontal page scroll; `clip` (not `hidden`) keeps position:sticky working */
}
```

- [ ] **Step 2: Verify.** `npm test` → green (no component depends on body overflow; pure CSS change). (`tsc` N/A for CSS.)
- [ ] **Step 3: Commit.**

```bash
git add src/index.css
git commit -m "fix(mobile): global overflow-x: clip backstop (html+body)"
```

---

### Task 2: Responsive lobby row + header (`src/ui/screens/Hub/LiveBattles.tsx`)

**Files:** Modify `src/ui/screens/Hub/LiveBattles.tsx`.

- [ ] **Step 1: Edit.**
(a) Add the import at the top:
```ts
import { useIsWide } from '../../useIsWide'
```
(b) The "Live battles" header row (the `<div>` at ~line 104 with `display:'flex', alignItems:'center', gap:12, marginBottom:14`) — add wrapping so the `All games ▾ / Newest ▾` block drops below on narrow instead of overflowing:
```ts
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 14,
          flexWrap: 'wrap',
          rowGap: 8,
        }}
```
(c) In `BattleRow`, derive `narrow` at the top of the component and apply it:
```ts
function BattleRow({ battle: b, onAction, onCancel }: { ... }) {
  const narrow = !useIsWide('(min-width: 640px)')
  return (
    <div
      style={{
        background: b.live ? `linear-gradient(90deg,#14F1950c,${COLORS.panel} 40%)` : COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 16,
        padding: '16px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: narrow ? 10 : 20,
        flexWrap: narrow ? 'wrap' : 'nowrap',
        marginBottom: 12,
        transition: 'border-color 0.12s',
      }}
      ...
```
and the "Mode + title" block (~line 229) takes the first line + truncates instead of forcing 140px:
```ts
      <div style={{ minWidth: narrow ? 0 : 140, flex: narrow ? '1 1 auto' : undefined, display: 'flex', flexDirection: 'column', gap: 5 }}>
```
The cost/action block keeps its `marginLeft: 'auto'` (unchanged) so on narrow it wraps to its own line and stays reachable. On wide, every value matches today (`gap:20`, `flexWrap:'nowrap'`, `minWidth:140`, no `flex`).

- [ ] **Step 2: Verify.** `npx tsc -b` (no type errors) + `npm test` (Hub/`openBattleToLive`/`LiveBattles` tests stay green).
- [ ] **Step 3: Commit.**

```bash
git add src/ui/screens/Hub/LiveBattles.tsx
git commit -m "fix(mobile): LiveBattles row + header wrap on narrow (no overflow)"
```

---

### Task 3: Chat drawer width (`src/ui/layouts/AppShell.tsx`)

**Files:** Modify `src/ui/layouts/AppShell.tsx` (the drawer `<div>` at ~line 237).

- [ ] **Step 1: Edit.** Change the fixed `width: 340` so it never exceeds the screen:

```ts
              width: 'min(340px, 100vw)',
```
(height/position/transform unchanged.)

- [ ] **Step 2: Verify.** `npx tsc -b` + `npm test` green.
- [ ] **Step 3: Commit.**

```bash
git add src/ui/layouts/AppShell.tsx
git commit -m "fix(mobile): chat drawer width min(340px, 100vw)"
```

---

### Task 4: Raw-`nowrap` conservative pass

**Files:** Modify (only where content can be long): `src/ui/screens/royale/RoyaleBoard.tsx` (lines ~265, ~342), `src/ui/screens/gacha/GachaVault.tsx` (lines ~419, ~1118), `src/ui/components/BattleBoard.tsx` (lines ~206, ~1167).

- [ ] **Step 1: Edit — apply the rule per spot.** For each of the 6 `whiteSpace:'nowrap'` spots: read its surrounding element. If it holds **long/variable** content (wallet, card name, value), add `overflow: 'hidden', textOverflow: 'ellipsis'` to that element and ensure its flex parent allows shrinking (`minWidth: 0`); if it is a **short fixed label** (e.g. a rarity tag, a `VS`, a count), LEAVE it as-is. Do NOT restructure these older screens.

- [ ] **Step 2: Verify.** `npx tsc -b` + `npm test` green.
- [ ] **Step 3: Commit** — name which spots got truncation and which were left (and why) in the body.

```bash
git add src/ui/screens/royale/RoyaleBoard.tsx src/ui/screens/gacha/GachaVault.tsx src/ui/components/BattleBoard.tsx
git commit -m "fix(mobile): truncate long nowrap text; leave short fixed labels"
```

---

### Final: full build + hand off the manual smoke-check

- [ ] `npm run build` → clean (tsc -b + vite build). `npm test` → green.
- [ ] **Manual mobile spot-check (user):** open the app on a phone (ngrok/preview) at ≥360px and confirm NO horizontal page scroll on: the **Hub lobby list** (rows + filters header), the **chat drawer**, and a **battle flow** (`/play/battle/:id`). Report any screen that still overflows → that becomes a follow-up (the screenshot-driven per-screen loop is a separate effort, per the spec).

## Self-Review
- Spec coverage: global backstop → T1; LiveBattles row+header → T2; drawer width → T3; nowrap pass → T4; build+manual smoke → Final. ✓
- No placeholders: T1–T3 carry the exact edits; T4 carries the precise per-spot RULE applied to the 6 named lines (the micro-decision "truncate vs leave" is fully specified, not hand-waved).
- Honest verification: no red→green layout tests (impossible in jsdom); the gate is `tsc -b` + `npm test` green + the user's manual smoke. Stated up front.

## No-goals
Redesign of the audited-healthy screens; new mobile layouts beyond fitting; the screenshot-driven per-screen loop; backend changes.
