# Mobile responsiveness pass — global guard + audited offenders (#mobile-1) — design

Date: 2026-06-23
Status: approved-pending-review
Parent: Mobile UI pass (`2026-06-19-mobile-ui-design.md`), and the #4b–#4e frontend screens.
A targeted responsiveness pass: a global horizontal-overflow safety net plus fixes for the concrete mobile offenders found in a code audit — chiefly the lobby row added in #4b-2. Not a full app redesign.

## Goal
The app should fit and scroll cleanly on a phone (≥360px wide): no horizontal page scroll, content that wraps/stacks rather than overflowing. Fix the specific offenders the audit found; add a global backstop; leave the (audited-as-healthy) older screens alone.

## Background (audit results)
- The June mobile-ui pass made the app mostly responsive: `AppShell` is responsive (`useIsWide` rail/dock/balance + a bottom nav on mobile), most `minWidth` usages are `minWidth: 0` (which *prevents* flex overflow), and most `nowrap` is paired with `overflow:hidden;textOverflow:ellipsis` (truncation, not overflow). `index.html` has a correct `<meta viewport>`.
- The **new #4b–#4e screens do not use `useIsWide`** and have desktop-first layouts. The audit found these concrete offenders:
  1. **`src/ui/screens/Hub/LiveBattles.tsx`** — `BattleRow` is a single horizontal flex row (`display:flex; align-items:center; gap:20`) whose title block has `minWidth: 140` (line ~229); with avatars + a cards row + a cost/button block (`marginLeft:auto`), it **overflows** on a phone. The filters header (`All games ▾ / Newest ▾` + segmented control) is also a non-wrapping horizontal row.
  2. **`src/ui/layouts/AppShell.tsx`** — the chat drawer is `width: 340` fixed (line ~237); on phones <340px it overflows.
  3. **`src/index.css`** — `body` does not constrain `overflow-x`, so any stray over-wide element produces horizontal page scroll (the "sliding feels off" symptom).
  4. A few **raw `nowrap`** spots without truncation (`RoyaleBoard.tsx:265,342`, `GachaVault.tsx:419,1118`, `BattleBoard.tsx:206,1167`) that *can* overflow when the content is long.
- `useIsWide(query)` (`src/ui/useIsWide.ts`) is the existing responsive primitive (`useIsWide('(min-width: 640px)')` → boolean). `COLORS`/`FONTS` theme tokens are in `src/ui/theme.ts`.

## Responsive standard (definition of done)
- No horizontal page scroll at viewport widths ≥ 360px.
- Flex children that hold text/variable content use `minWidth: 0`.
- No fixed pixel width wider than the smallest target viewport; wide fixed panels use `min(Npx, 100vw …)`.
- Modals: `maxWidth` + `width: 100%` + `maxHeight: ~85vh` + `overflowY: auto`.
- Touch targets ≈ ≥40px where practical.

## Changes

### 1. Global overflow backstop (`src/index.css`)
Add to the `body` rule (keep `min-height: 100dvh`): `overflow-x: clip;` (and `html { overflow-x: clip; }`). `clip` (not `hidden`) avoids creating a scroll container, so `position: sticky` keeps working. This is a backstop; the per-element fixes below remove the actual sources.

### 2. `LiveBattles` — responsive lobby row + header
- `BattleRow`: derive `const narrow = !useIsWide('(min-width: 640px)')` (hook at the `LiveBattles` level, threaded down, or called in `BattleRow`). On narrow:
  - the outer row gets `flexWrap: 'wrap'` and a smaller `gap` (e.g. 10);
  - the title block's `minWidth: 140` → `minWidth: 0` with `flex: '1 1 auto'` so it takes the first line and truncates rather than forcing width;
  - the cost/button block keeps `marginLeft: auto` so it wraps to its own line, staying reachable.
  On wide it renders exactly as today.
- The filters header row (the one with `marginLeft:auto` holding `All games ▾` / `Newest ▾`) gets `flexWrap: 'wrap'` + `rowGap` so the dropdowns drop below the "Live battles" title on narrow instead of overflowing.

### 3. `AppShell` chat drawer width
- `width: 340` → `width: 'min(340px, 100vw)'` so the drawer never exceeds the screen on small phones. (Height/position unchanged.)

### 4. Raw-`nowrap` pass
For each raw `nowrap` without truncation (`RoyaleBoard.tsx:265,342`, `GachaVault.tsx:419,1118`, `BattleBoard.tsx:206,1167`): if the content can be long (wallet/card names, values), add `overflow:hidden; textOverflow:ellipsis` and ensure the parent allows shrinking (`minWidth:0`); if it is a short fixed label (e.g. a rarity tag), leave it and note why in the commit. This is a light, conservative pass — no layout restructuring of those older screens.

## Verification (honest limitation)
Layout/responsiveness is **not unit-testable** in vitest/jsdom (no layout engine). So each change is verified by:
- `npx tsc --noEmit` clean + `npm test` green (no regressions to the existing component tests — e.g. `LiveBattles` is exercised indirectly via Hub/`openBattleToLive` tests; `CreateBattleModal` tests stay green).
- A **manual mobile spot-check** by the user (open the app on a phone via the ngrok/preview setup): the Hub lobby list, the chat drawer, and a battle flow fit without horizontal scroll.
There are no red→green layout tests; tasks are edit → verify build/suite green → manual smoke.

## No-goals
- Rewriting the ~30 older screens the audit found healthy.
- Any visual redesign / new mobile layouts beyond making things fit.
- The screenshot-driven per-screen loop (a later, separate effort once the user flags specific screens).
- Backend / non-UI changes.
