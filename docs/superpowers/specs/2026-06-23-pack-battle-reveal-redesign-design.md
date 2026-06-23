# Pack Battle reveal redesign — Design

**Date:** 2026-06-23
**Status:** superseded by v2 (below) — v1 shipped on branch `pack-reveal-redesign` (commit be23fed)
**Scope:** v1 frontend only; v2 adds a small backend change (expose `grade` + `year` in battle pulls)

> **v2 (approved 2026-06-23):** replaces v1's "all cards at once" with a **round-by-round staged reveal** that mirrors the gacha animation. See the "## v2 — Round-by-round staged reveal" section at the end.

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

---

## v2 — Round-by-round staged reveal (approved)

v1 flipped all cards at once. v2 sequences the reveal **round by round**, each round playing the **gacha staged animation** for both players simultaneously.

### Flow
For each round `r` (a bundle box; single-box battles have exactly one round), gated on `status === 'settled'`:
1. Both players' round-`r` cards reveal **at the same time** with the gacha staged animation: **YEAR → GRADE → RARITY → CARD** (~1.7s/step; reduced-motion jumps straight to CARD).
2. When the card stage lands, each player's **value counter counts up** by that card's `insuredValue` (running accumulated total).
3. Advance to round `r+1`, same process. After the last round: winner highlight + pot.

Before `settled`: a face-down / "abriendo los packs…" waiting state (no NFTs shown early).

### Data — expose `grade` + `year` in battle pulls (backend)
The staged animation needs `year` and `grade` per card. Today `BattlePullInfo` exposes neither.
- **`grade`** — already stored on `BattlePull.grade`; just add to the `get_battle` pull serializer + frontend type/VM.
- **`year`** — `open_pack` returns it but it is not persisted. Add a nullable `year` column to `BattlePull`, store `pull.year = res.get("year")` in `run_battle`'s pull loop, and serialize it. Dev SQLite: add the column via `ALTER TABLE battle_pulls ADD COLUMN year VARCHAR` (additive, safe).

`RevealCardVM` gains `grade: number | null` and `year: string | null`.

### Shared staged-reveal component
Extract the gacha staged reveal (`RevealResult` in `GachaVault.tsx`, "year → grade → rarity → card") into a shared `StagedCardReveal` so gacha and battle play the **identical** animation. It steps year→grade→rarity (only the present ones) then renders a card slot; takes a normalized card `{ year, grade, rarity, insuredValue, nftAddress, isMe }`, `reduced`, and an `onCardShown` callback (fires when the card stage lands → drives the counter bump + round advance). GachaVault is refactored to consume it; its existing tests stay green.

### PackReveal orchestration
`PackReveal` tracks `currentRound`. Per round it renders both players' `StagedCardReveal` for that round; when **both** report `onCardShown`, it bumps the per-player running counters and advances `currentRound`. Reduced-motion / already-settled-on-mount → reveal all rounds' final state immediately (counters at totals). Winner highlight after the final round.

### Components / files (v2 delta)
- `backend/app/models.py` — `BattlePull.year` column.
- `backend/app/services/pack_engine.py` — store `pull.year`.
- `backend/app/main.py` — serialize `grade` + `year` in the `get_battle` pull payload.
- `src/onchain/packBattleClient.ts` — `BattlePullInfo.grade`, `.year`.
- `src/ui/screens/battle/battleReveal.ts` — `RevealCardVM.grade`, `.year`.
- `src/ui/screens/battle/StagedCardReveal.tsx` — new shared staged reveal (extracted from gacha).
- `src/ui/screens/gacha/GachaVault.tsx` — consume `StagedCardReveal` (behavior preserved).
- `src/ui/screens/battle/PackReveal.tsx` — round-by-round orchestration over `StagedCardReveal`.

### Testing (v2 delta)
- `battleReveal`: VM carries `grade`/`year` per card.
- Backend: `get_battle` pull payload includes `grade` + `year`.
- `StagedCardReveal`: reduced-motion shows the card immediately + fires `onCardShown`; full sequence steps through present stages.
- `PackReveal`: round advances when both players' cards land; counters reach per-player totals; winner highlight after last round.
- Layout/animation timing not unit-testable in jsdom — verified via build + suite green + manual smoke-check.

---

## v3 — polish (approved)

Builds on v2. Adds card name, machine thumbnail, round indicator, and a card-back→front 3D flip.

- **Card name** — add a `name` column to `BattlePull` (store from `open_pack`, serialize in `get_battle`), `BattlePullInfo.name` / `RevealCardVM.name`; shown under each revealed card (truncated).
- **Machine thumbnail** — `useMachines()` hook (fetch `/gacha/machines` once, cached) → `code → { name, thumb }`. `RevealVM.machines` carries the per-round `machine_code` (from `battle.packs` by sequence; fallback `[machine_code]`). Current round's machine thumbnail + name shown in the round header.
- **Round indicator** — "RONDA r/N" in the header (driven by current `round` + `maxRounds`).
- **Card back + flip** — `StagedCardReveal` becomes a 3D flip card: during YEAR/GRADE/RARITY it shows the **card back** (`CardBack`, rarity-glow) with the stage text overlaid; on the card stage it flips (rotateY, framer-motion) to the front (`RevealCard`). Reduced-motion shows the front immediately.
- **General polish** — round header (thumb + name + round), per-card name, winner glow at the end, spacing/hierarchy. Royale unchanged.

New files: `src/ui/useMachines.ts`, `src/ui/screens/battle/CardBack.tsx`.
