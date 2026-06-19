# Mobile UI pass (main flows) — design spec

Date: 2026-06-19
Status: approved-pending-review

## Goal

Make the main user-facing flows usable on a phone (~360–430px wide). The app styles inline and
adapts via the `useIsWide(query)` hook (no CSS media queries). Several layouts use fixed
multi-column grids that overflow or cram on mobile — adapt them to stack/flow on narrow screens
while leaving the existing wide layouts unchanged.

## Scope (decided)
- IN: Gacha (`GachaVault`), the pool `CardDetailsModal`, `InventoryCardModal`, lobby `LiveBattles`,
  the `AppShell` topbar, and a padding/overflow pass on Hub + Profile.
- OUT: the battle boards (`BattleBoard`, mana/royale/pack play screens) and the legacy on-chain
  screens (`LobbyScreen`, `CollectionScreen`) — prototypes, deferred.

## Tooling
- Use the existing `useIsWide(query: string): boolean` hook (`src/ui/useIsWide.ts`) for layout
  switches; or `repeat(auto-fill, minmax(...))` where a hook isn't needed. No new CSS files, no
  new deps. Reuse `COLORS`/`FONTS` tokens.

## Breakpoints
- Gacha two-column ↔ stacked: **`(min-width: 880px)`**.
- Detail modals two-column ↔ single column: **`(min-width: 620px)`**.
- Inventory grading grid 2-col ↔ 1-col: **`(min-width: 380px)`**.
- AppShell already uses 760px (rail→bottom-nav) / 1100px (dock) — unchanged.

## Per-screen behavior

### 1. Gacha — `src/ui/screens/gacha/GachaVault.tsx`
- `const wideGacha = useIsWide('(min-width: 880px)')`.
- Container padding: wide `24px 28px 48px` (current) / narrow `16px 14px 40px`.
- Body grid: wide `'1fr minmax(320px, 400px)'` (current) / narrow `'1fr'`.
- Order on narrow: **machine panel first**, then the card pool. (Wide keeps pool-left / panel-right.)
  Implement by rendering panel-then-pool when narrow, pool-then-panel when wide — or by setting
  grid `order` — pick whichever is cleanest; the visual result is panel-first on mobile.
- The sticky wrapper around `MachineDetailPanel` applies only when `wideGacha` (no sticky in the
  single-column stack).

### 2. Card pool grid — `src/ui/screens/gacha/CardPoolGrid.tsx`
- Tile min track responsive via `useIsWide('(min-width: 560px)')`: true → `minmax(190px, 1fr)`
  (current) / false → `minmax(150px, 1fr)` so a phone (<560px) shows ~2 columns instead of 1.
  Gap drops to `12` when narrow.

### 3. Pool detail modal — `src/ui/screens/gacha/CardDetailsModal.tsx`
- `const wideModal = useIsWide('(min-width: 620px)')`.
- Outer grid: wide `'1fr 1fr'` (current) / narrow `'1fr'` (gallery on top, info below).
- On narrow, cap the large image height (e.g. `maxHeight: '48vh'`) so it doesn't fill the screen;
  keep `objectFit: 'contain'`. Thumbnails remain the small column beside the image (fits at ~56px).

### 4. Inventory modal — `src/ui/screens/Profile/InventoryCardModal.tsx`
- The grading rows grid (`'1fr 1fr'`) → `useIsWide('(min-width: 380px)') ? '1fr 1fr' : '1fr'`.
- Verify the modal (`width: min(440px, 100%)`) and its content fit a 360px screen (it should; this
  is the one residual 2-col grid).

### 5. Lobby live battles — `src/ui/screens/Hub/LiveBattles.tsx`
- Replace `gridTemplateColumns: 'repeat(4, 1fr)'` with `'repeat(auto-fill, minmax(160px, 1fr))'`
  so it flows from 4 columns (desktop) down to 2/1 on a phone with no hook.

### 6. AppShell topbar — `src/ui/layouts/AppShell.tsx`
- Verify the topbar row (brand + balance + AuthButtons + Deposit) fits ~360px. If it overflows,
  allow `flexWrap`/shrink, and hide the balance box on very narrow widths
  (`useIsWide('(min-width: 480px)')`) — the Deposit + AuthButtons stay. Keep the existing
  auth-gating (`authenticated`).

### 7. Hub + Profile padding pass
- Skim `src/ui/screens/Hub/Hub.tsx` (header + QuickMatch) and `src/ui/screens/Profile/*` for fixed
  paddings/widths that overflow at 360px; reduce horizontal padding / let content wrap. No layout
  redesign — just prevent horizontal overflow. (`InventoryTab` is already a `flex-wrap` of 150px
  tiles → fine.)

## Error handling / edge cases
- `useIsWide` is SSR-safe (defaults false) and updates on viewport change — orientation/resize
  flips layouts live. No persisted state.
- Wide (desktop) layouts must be byte-for-byte unchanged — every change is gated behind a
  narrow branch.

## Testing
- Presentational: `npx tsc --noEmit` + `npm run build` clean; existing vitest suite stays green
  (`useIsWide` is already covered). No new unit tests (pure layout switches).
- Manual: user verifies on a phone via the tunnel — Gacha stacks, pool/inventory modals are
  single-column, LiveBattles flows, topbar fits, nothing overflows horizontally.

## No-goals (YAGNI)
- Battle boards + legacy on-chain screens (deferred).
- A global CSS/media-query system or responsive framework — keep the inline + `useIsWide` pattern.
- Redesigning any screen's content/IA — this is layout adaptation only.
