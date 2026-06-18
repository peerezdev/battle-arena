# Shared App Shell — design spec

Date: 2026-06-18
Status: approved-pending-review

## Goal

Give every authenticated app page a **single shared layout** so the **sidebar** (Lobby/Pack/
Royale/Gacha/Mana/Ranks) and the **Live Drops + Chat dock** persist across navigation, plus a
**collapse/expand toggle** for the dock. Today only the Hub (`/app`) has the sidebar + dock;
`/play/*` and `/profile` use a different shell (`GameLayout`) with neither.

## Decisions (from brainstorming)
- The shell (sidebar + dock) shows on **every** app page, **including the active battle**.
- The collapse button toggles the **whole dock** (Live Drops + Chat) as one unit.

## Approach

Extract a single **`AppShell`** React-Router **route-layout** (`<Route element={<AppShell/>}>`
+ `<Outlet/>`). All app pages render inside it, so the sidebar and dock are mounted **once**
and survive route changes — notably the chat WebSocket + its message/online state are no
longer torn down on navigation. (Rejected: a context/provider wrapper or duplicating the
rail/dock per page — both re-mount the chat and duplicate state.)

## Structure

```
AppShell (grid):  [ Sidebar 92px | (Topbar + <Outlet/>) | Dock (collapsible) ]
```
Replaces both the Hub's outer grid/topbar and `GameLayout`. Reuses the existing
`COLORS/FONTS` design tokens and the current responsive breakpoints.

### Sidebar (`LeftRail`, made route-driven)
- Same visual rail. Each item **navigates** instead of toggling Hub state:
  `lobby → /app`, `pack → /play/arena`, `royale → /play/royale`, `gacha → /play/gacha`,
  `mana → /play/mana`; bottom Profile button → `/profile`.
- Active highlight derives from the current path via `useLocation` (pure helper
  `activeNavFromPath(pathname)` → the nav id, unit-testable).
- **Ranks**: stays a Hub-internal sub-view. The sidebar's `ranks` item routes to `/app`; the
  Hub keeps its lobby/ranks sub-tabs (default lobby). Deep-linking ranks (e.g. `?view=ranks`)
  is a later nicety, out of scope here.
- Mobile keeps the existing `BottomNav` (same items, same route mapping).

### Topbar (in AppShell, above the Outlet)
- Brand mark + spacer + **balance box** + `AuthButtons` + **+Deposit** + `MuteButton`.
- Balance + Deposit remain **gated by `authenticated`** (already implemented — moved here).
- Per-page titles ("Lobby · N online", "GACHA VAULT", "Profile", battle headers) stay inside
  each page's content. The per-page "← Lobby" back button is removed (sidebar replaces it).

### Dock (`ChatDock`, + collapse)
- Unchanged content: LIVE DROPS (top) + CHAT (bottom) with the existing **resizable divider**.
- New **collapse/expand toggle** (one button): expanded → full dock; collapsed → a thin
  ~36px strip with an expand chevron (and a small "LIVE/CHAT" vertical affordance). State
  persisted in `localStorage` (`ba.dockCollapsed`) so it stays across navigation/reloads.
- Responsive: the dock still auto-hides on narrow viewports (existing `wideDock` query); the
  manual collapse is an additional control layered on top (only meaningful when `wideDock`).

## What changes (files)
- **Create** `src/ui/layouts/AppShell.tsx` — the grid, topbar, sidebar+bottom-nav switch,
  collapsible dock, `<Outlet/>`, and the responsive `wideRail`/`wideDock` logic (moved out of
  Hub).
- **Create** `src/ui/layouts/navRoutes.ts` — the nav-id ↔ route map + `activeNavFromPath`
  pure helper (+ unit test).
- **Modify** `src/App.tsx` — `/` Landing stays standalone; wrap `/app`, `/play/mana`,
  `/play/royale`, `/play/arena`, `/play/gacha`, `/profile` in `<Route element={<AppShell/>}>`.
- **Modify** `src/ui/screens/Hub/Hub.tsx` — drop the outer grid/sidebar/topbar/dock; becomes
  the **lobby content** (its QuickMatch/LiveBattles + lobby/ranks sub-tabs) rendered in the
  Outlet.
- **Modify** `src/ui/screens/Hub/LeftRail.tsx` + `BottomNav` — route-driven nav (navigate +
  active-from-location) instead of `onSelect` Hub state. (Keep them in place or move under
  `layouts/`; keep where they are to minimize churn.)
- **Modify** `src/ui/screens/Hub/ChatDock.tsx` — add the collapse/expand toggle + collapsed
  strip; accept `collapsed`/`onToggle` props (state owned by AppShell).
- **Remove** `src/ui/layouts/GameLayout.tsx` — its balance/deposit/mute move to the AppShell
  topbar; the game flows now render in the Outlet. Update any imports.

## Data flow
- AppShell owns: `dockCollapsed` (localStorage-backed), the responsive `wideRail`/`wideDock`
  flags, and the balance/auth (via `useUsdcBalance`/`usePrivy`) for the topbar. It passes
  `collapsed`/`onToggle` to `ChatDock`.
- Sidebar uses `useNavigate` + `useLocation`; no shared state needed beyond the router.
- Pages in the Outlet are unchanged internally (Hub lobby content, GachaVault, ProfilePage,
  the three game flows).

## Error handling / edge cases
- Unknown path → `activeNavFromPath` returns no active item (nothing highlighted); the `*`
  route still redirects to `/`.
- `localStorage` unavailable → default to expanded; reads/writes wrapped in try/catch.
- Collapse control only rendered when `wideDock` (no toggle when the dock is responsively
  hidden).

## Testing
- Unit (vitest, pure): `activeNavFromPath(pathname)` mapping; the nav-id→route map.
- `tsc --noEmit` + `npm run build` clean; existing suite green.
- Manual eyeball: sidebar + dock persist across Lobby/Gacha/Profile/battle; collapse/expand
  works and persists; mobile bottom nav intact; chat state survives navigation.

## No-goals (YAGNI)
- Redesigning the sidebar items or the Hub's lobby/ranks content model.
- Deep-linking the Hub ranks sub-view (`?view=ranks`) — later.
- Collapsed-dock mini-summary (live ticker) — just the chevron/strip for now.
- Changing the game flows' internal screens.
