# Pack Battle reveal redesign — Design

**Date:** 2026-06-23
**Status:** approved
**Scope:** frontend only (uses the existing `GET /users/{wallet}` endpoint; no backend change)

## Problem

The current Pack Battle reveal (`PackReveal` + `RevealCard`, driven by `BattleFlow` polling `get_battle` every 1.5s) shows cards **small** (92px) and **staggered** — each card pops in as the backend resolves that pull, with a face-down "abriendo…" tile in between. It shows the wallet (abbreviated) and the per-card `insuredValue`, but there is no sense of a head-to-head reveal or a running value tally.

## Goals

1. **Big cards** — the pulled card images are large and central, not 92px thumbnails.
2. **Simultaneous reveal** — both players' cards flip in **at the same time**, not one-by-one as they resolve. The reveal happens when the battle is **settled** (winner decided). This also satisfies the project rule *"losers never see NFTs until the winner is decided."*
3. **Player identity** — each side shows the player's **username** (`User.alias`), falling back to the **abbreviated wallet** when there is no alias.
4. **insuredValue counter** — each player has an animated **count-up** to their total `insuredValue` (sum across their pulls). The higher total wins (existing logic).

Non-goals (YAGNI): Royale reveal redesign (separate component), sound, confetti.

## Approach

### Timing — reveal gated on `settled`
While `battle.status === 'running'`, `BattleFlow` shows a **suspense** state ("Abriendo los packs…", face-down placeholders) instead of the partial card stream. When `status === 'settled'`, render the full reveal: all cards flip in simultaneously, the value counters count up, and the winner is highlighted. Gating on `settled` is both the cleanest "all at once" signal and the only way to honor the no-early-NFT rule. `reduced-motion` skips the flip/count-up and renders final state directly.

### Per-player view model
Extend the reveal adapter so the VS layout consumes a per-player structure rather than `rounds[0].cards`:

```ts
interface RevealPlayerVM {
  wallet: string
  isMe: boolean
  cards: RevealCardVM[]   // all of this player's pulls across rounds (bundle-aware)
  total: number           // sum of insuredValue (== backend accumulated_value)
  eliminatedRound: number | null
}
```

`battleToReveal` groups every pull by `player_wallet` (not just round 0) and sums `insuredValue` for `total`. This makes the reveal correct for multi-box bundles (#4e), where each player has several cards.

### Usernames — resolved client-side
A `useAliases(wallets: string[])` hook fetches `GET /users/{wallet}` per player (cached per wallet) and returns `{ [wallet]: alias | null }`. The display name is `alias ?? abbreviate(wallet)`. No backend change — the endpoint already returns `alias` via `read_user_view`.

### insuredValue counter
A `useCountUp(target, { enabled })` hook animates 0 → target over a short duration (rAF). When `reduced-motion` (or `enabled=false`), it returns `target` immediately. `PackReveal` shows the count-up per player, formatted with `formatUsd`.

### Layout — VS
1v1 head-to-head: Player A (left) — VS — Player B (right). Each side: display name, big card image(s), animated value counter. Winner side gets the green highlight + "🏆 Gana {name}". Pot total shown in the header. Cards stack/wrap in a row per side for bundles.

## Components / files

- `src/ui/screens/battle/battleReveal.ts` — add per-player aggregation (`players[].cards`, `players[].total`); keep `rounds` for Royale.
- `src/ui/screens/battle/RevealCard.tsx` — add a `size` prop (`'sm' | 'lg'`); `lg` ≈ 180px wide for the new reveal. Default keeps current size so Royale is unaffected.
- `src/ui/screens/battle/PackReveal.tsx` — rebuilt VS layout: big cards, display name, count-up counter, winner highlight; reads the per-player VM.
- `src/ui/hooks/useAliases.ts` — new; resolves wallet→alias (batched, cached) via `GET /users/{wallet}`.
- `src/ui/hooks/useCountUp.ts` — new; rAF count-up respecting reduced-motion.
- `src/ui/flows/BattleFlow.tsx` — show suspense while `running`; render `PackReveal` only when `settled`.

## Error handling
- Alias fetch failure / missing user → fall back to `abbreviate(wallet)` (never blocks the reveal).
- Card image `onError` → 🃏 placeholder (existing behavior).
- A player with no resolved cards at `settled` (edge) → counter shows their `accumulated_value` (or 0) and a 🃏 placeholder.

## Testing
- `battleReveal`: per-player aggregation sums insuredValue across rounds; groups bundle cards by player.
- `useCountUp`: returns target immediately when reduced-motion / disabled.
- `useAliases`: returns alias when present, wallet-abbreviation fallback on null/error.
- `PackReveal`: renders both players, the winner highlight on settled, display name = alias else short wallet.
- `RevealCard`: `lg` size renders larger; `sm` unchanged.
- Layout itself is not unit-testable in jsdom — verified via `tsc -b` + suite green + manual smoke-check.
