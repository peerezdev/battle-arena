# Lobby v2 + Help page — Design

**Date:** 2026-07-02
**Status:** Approved (design)
**Area:** Frontend — `src/ui/layouts/AppShell.tsx`, `src/ui/screens/Hub/*`, `src/ui/layouts/navRoutes.ts`, new `src/ui/screens/Help/*`, new lobby sections.

## Goal

Apply the "Collector Arena Lobby v2" mockup to the existing Hub, and add a Help page from the
provided Help mockup — within the **existing Neón Cyber palette** and using **only data/hooks
that already exist** (or our own editable config), no placeholders.

## Constraints (locked)

- **Palette unchanged.** Map the mockup's colors to our `theme.ts`: mockup `--g1 #2fe28a` →
  `COLORS.green` (`#00ffc4`); mockup violet `--v1/--v1l` → `COLORS.violet` (`#ff2e97`); royale
  pink `--pnk` → the existing royale accent `#ff6bb5`; amber `#f5c542`, blue `#4ea8ff`, and the
  epic purple `#a98bff` stay as the semantic accents already in the theme. Fonts stay ours
  (Sora display / Inter body / JetBrains Mono) — **not** Space Grotesk.
- **No hardcoded data.** Ticker, best-hit and the live-games grid read existing hooks/stores.
  News is our own editable config (`LOBBY_NEWS`) with real, non-misleading copy (describe real
  features, not invented events/dates). Mode-guide/Help copy is UI text, not data.
- **Profile stays in the header** next to Deposit, but **compact/icon-only** (avatar + caret,
  no name). Its dropdown (Withdraw / My Profile / Inventory / Log out) is unchanged.
- **Left rail:** remove the Settings gear and the standalone Profile avatar; add a **Help** nav
  item. Keep Lobby / Gacha / Leaderboard.

## Structural note

The mockup's shell (nav rail + main + right rail with Recent Drops + Chat) already matches the
current app (`LeftRail` + `Hub` + `ChatDock`). This is a **restyle + a few new sections + the
Help page**, not a structural rebuild.

## Data sources (existing)

- Open lobbies: `useOpenBattles` → `openBattleToLive` → `LiveBattles` (the "Live games" grid).
- Recent Drops + big-pull ticker + best-hit: `useDrops()` / `dropsStore` (local: this client's
  drops + battle drops seen live). `LiveDrop` = `{ name, valueUsd, rarity, image, wallet,
  username, source, ts }`.
- Chat: `useChat`. Radio: `useRadio` (already in the header). Balance/Gimmighouls: existing
  header hooks (`useUsdcBalance`, `useReservedBalance`, `useProfile`).

## Components / changes

### 1. Left rail (`LeftRail.tsx`)
- Remove the Settings `<button>` and the standalone Profile avatar `<button>` at the bottom.
- Add a **Help** nav item (icon = the mockup's `?`-in-circle) linking to `/help`.
- Items become: Lobby, Gacha, Leaderboard, Help. The rail's bottom is just the flex spacer.
- Visuals unchanged (already matches the mockup).

### 2. Nav wiring (`hubMockData.ts` `HubNav`/`NAV_ITEMS`, `navRoutes.ts`, `LeftRail` `NAV_ICONS`)
- Add `'help'` to `HubNav`, `NAV_ITEMS`, `NAV_ROUTES['help'] = '/help'`, `activeNavFromPath`
  (`/help` → `'help'`), and a `help` entry in `NAV_ICONS`. Help also appears in the mobile
  `BottomNav` (it maps `NAV_ITEMS`).

### 3. Header profile compact (`AppShell.tsx` + `AuthButtons.tsx`)
- `AuthButtons variant="compact"` must render **icon-only** on the Hub header: never show the
  display name (avatar + caret only). Add a prop (e.g. `hideName`) or make `compact` always
  hide the name. Dropdown behavior unchanged; logged-out shows the compact "Log in" button in
  the header (unchanged position). Header order stays: brand · radio · chips · Deposit · profile.

### 4. Big-pull ticker (`Hub/BigPullTicker.tsx`, new)
- Marquee of recent drops from `useDrops()`, formatted `"{user} pulled {name} · ${value}"`,
  colored by rarity accent; own drops highlighted (username === me). Hidden when no drops.
- CSS keyframe `ba-ticker` (translateX 0 → -50%, duplicated list for a seamless loop) added to
  `index.css`; respects reduced motion (no animation → static, scrollable row or hidden).

### 5. Hero Quick Match + Best-hit (`Hub/QuickMatch.tsx` restyle + `Hub/BestHitCard.tsx`, new)
- Restyle `QuickMatch` to the mockup hero: eyebrow "QUICK MATCH", big headline, blurb, tier
  buttons (existing `STAKE_OPTIONS`), "Create battle" (with sweep), "or try a free demo".
- `BestHitCard` = the single highest-`valueUsd` drop from `useDrops()`: image (`d.image` with a
  🃏 fallback), name, rarity, value, "pulled by {username/short wallet}". No "watch the reveal"
  link (the drop record carries no battleId). Hidden when no drops.

### 6. What's New carousel (`Hub/NewsCarousel.tsx` + `Hub/lobbyNews.ts`, new)
- `LOBBY_NEWS` = our own array `{ id, tag, accent, title, sub, cta, href }` — real features only
  (e.g. "Battle Royale is live", "Provably-fair pulls", "Deposit USDC from any chain",
  "Track your Gimmighouls"). No invented tournaments/dates.
- Split layout (big auto-advancing banner + side list), prev/next, progress bar, pause on hover.
  Auto-advance interval configurable in code; respects reduced motion (no auto-advance).

### 7. Mode guide (`Hub/ModeGuide.tsx`, new)
- Collapsible section explaining Pack Battle / Battle Royale / Gacha (copy from the Help mockup).
  Collapsed/expanded state persisted in `localStorage` (`ba.lobbyGuideOpen`). "Explain more" →
  `/help#pack|#royale|#gacha`; "Open Help guide" → `/help`. Collapsed pill mirrors the mockup.

### 8. Live games grid (`Hub/LiveBattles.tsx` restyle)
- Restyle cards to the mockup: mode chip, status dot + label, EST POT, entry/buy-in, stacked
  player avatars, pulsing empty-slot rings for filling lobbies, join/watch/cancel button, and a
  "N seats left · starts when full" note. Header "Live games" + live count. All from the
  existing `LiveBattle` shape (`openBattleToLive`); keep existing tests/behavior (join/watch/
  cancel handlers unchanged).

### 9. Right rail (`ChatDock.tsx` restyle)
- Recent Drops: restyle rows; a celebration flash on a newly-arrived drop (CSS `ba-dropin` /
  gold flash for big pulls), own drops highlighted. Chat: keep `useChat`; style system-style
  event rows. Reduced motion disables the flash.

### 10. Help page (`Help/HelpPage.tsx`, new; route `/help` inside `AppShell`)
- Built from the provided Help HTML, adapted to our palette + fonts, rendered **inside the app
  shell** (so it uses our real `LeftRail` + header — the mockup's own rail/topbar are dropped;
  keep an in-page "Help & Guides" heading + a "Back to Lobby" link).
- Sections: intro, quick cards (Pack/Royale/Gacha anchors), **Game modes** (Pack Battle /
  Battle Royale / Gacha, each with 3 steps), **Features & fairness** cards: Wallet & deposits,
  Gimmighouls, The radio, Recent drops, Provably fair, Trustless settlement, **plus a new
  "Platform fee" card** documenting the battle fee (0.5%/player, capped, on the winner's
  buyback) — this is the fee disclosure we committed to. TOC sidebar with in-page anchors
  (`:target { scroll-margin-top }`). Bottom "Ready to play?" CTA → `/` (lobby).
- Route added in the app router next to the other AppShell children; `activeNavFromPath('/help')`
  → `'help'` so the rail highlights Help.

## Testing (Vitest + RTL)

- `LeftRail`: renders Help item; no Settings button; no standalone profile avatar.
- `AuthButtons` compact: does not render the display name (icon-only), dropdown still opens.
- `BigPullTicker`: renders rows from mocked `useDrops`; renders nothing when empty.
- `BestHitCard`: shows the max-value drop; nothing when empty.
- `NewsCarousel`: renders first item; next/prev advances; (fake timers) auto-advance.
- `ModeGuide`: toggles + persists collapsed state; links point to `/help#...`.
- `LiveBattles`: keep existing tests green after restyle (join/watch/cancel wiring intact).
- `HelpPage`: renders the mode sections + the Platform-fee feature card; TOC anchors present.
- `navRoutes`: `/help` ↔ `'help'` mapping.

## Non-goals

- No global drops feed / backend changes (ticker/best-hit use the local store; a true global
  feed remains a future phase).
- No new backend endpoints. No change to battle/gacha logic.
