# Battle Royale — Cinematic Reveal Design

**Date:** 2026-07-01
**Status:** Approved (design)
**Area:** Frontend — `src/ui/screens/battle/RoyaleReveal.tsx` + `src/ui/flows/BattleFlow.tsx`

## Goal

Replace the current Battle Royale "grid updates as data lands" reveal with a paced,
cinematic replay: each player's card is revealed one at a time (seating order), a live
leaderboard ordered by accumulated insured value is always visible, and between rounds the
board blurs behind an overlay — *"La ronda X empezará en 5"* counting 5→0 — with the current
leaderboard below it. When the countdown hits 0 the next round begins.

## Non-goals

- No backend changes. The royale engine already produces pulls progressively over real time;
  clients already poll (`useBattle(id, 1500)`). We drive the animation entirely client-side.
- No frame-perfect cross-client sync (see Synchronization). No "skip to live" for latecomers (v1).
- The `RoyaleResult` (champion + final standings) screen is unchanged.
- The local demo flow (`RoyaleFlow` / `RoyaleBoard`) is out of scope; this is the real staked
  royale rendered by `BattleFlow`.

## Decisions (locked)

- **Synchronization:** client-side replay, no backend. Every browser plays the same paced
  animation from the shared battle data — same sequence, same order, same countdown. Because
  all clients start from identical data and use the same deterministic cadence, they stay
  close in time (~1–2s), not frame-locked.
- **Reveal order within a round:** seating / join order (matches how the backend processes the
  round), so each card can be revealed as soon as its data arrives.
- **Layout:** keep the existing per-player grid, reveal cards into it one by one, with a live
  leaderboard alongside. During the countdown the grid blurs and the overlay appears on top.

## Core concept: the "revealed-so-far" projection

The whole animation rests on a single idea: an animation cursor
`(currentRound, currentCardIndex, phase)` **projects** the full `RevealVM` down to a
"revealed-so-far" view. Everything visible — grid card values, card chips, the live
leaderboard, elimination markers — derives from that projection, never from the full `vm`.
As the cursor advances, values count up and cards appear.

The cursor advances on its own clock (timers) **but never outruns the data**: it will not
reveal a card until that card's pull exists in `vm`. If the backend has not produced it yet,
the slot shows an "abriendo…" state and reveals as soon as it lands (with a minimum dwell so
it is never a flash). Since all clients share the same data and the same deterministic
cadence, they see the same sequence.

## Components (files)

### `useRoyaleReveal(vm, { reducedMotion, onComplete })` — new hook

The animation state machine. Owns the cursor and all timers; reads from the latest `vm` on
each render but advances on its own schedule.

**Returns:**
- `phase: 'revealing' | 'roundBreak' | 'done'`
- `projection: RevealVM` — the revealed-so-far VM: for each player, only the cards revealed up
  to the cursor, their accumulated **revealed** insured value (`total` recomputed over the
  revealed subset), and `eliminatedRound` set only for rounds already fully revealed.
- `activeWallet: string | null` — the player whose card is being revealed right now.
- `revealedRound: number` — the round currently being revealed (1-based).
- `countdown: number` — during `roundBreak`, the seconds remaining (5→0); otherwise unused.
- `upcomingRound: number` — during `roundBreak`, the round number about to start.

**Behavior:**
- Advances card-by-card in seating order (the player order from `vm.players`), gated by data
  availability: reveal player *i*'s card for `revealedRound` once that pull exists; else wait
  in an "opening" state on that slot.
- Minimum dwell per card ≈ **900ms** (flip ~400ms + hold) even if data arrives faster.
- After the last player's card of a round: an ≈**800ms** beat highlighting that round's
  eliminated player (from `vm.rounds[r].eliminatedWallet`).
- If more rounds remain: enter `roundBreak`, `countdown` = **5**, ticking down 1/s; at 0,
  return to `revealing` for the next round.
- Round 1 starts immediately (no leading countdown). The final round has no trailing
  countdown: when it finishes revealing **and** `vm.status === 'settled'`, set `phase = 'done'`
  and call `onComplete()` once.
- **Reduced motion:** no flips, no countdown; the projection is the full current `vm`
  immediately, and `onComplete()` fires as soon as `vm.status === 'settled'`.
- Timers are cleared on unmount and re-derived safely across `vm` updates (index-based cursor;
  refs to avoid re-render churn). `onComplete` is guarded so it fires at most once.

### `LiveLeaderboard` — new component

Rows ordered by accumulated insured value (descending). Highlights the current user ("YOU"),
marks the leader (👑) and the lowest still-alive player ("at risk"), and strikes through
eliminated players. Reused in two places: the board sidebar and the countdown overlay. Reads
from the projection so it reorders live as values count up.

### `RoundBreakOverlay` — new component

A blurred/dimmed backdrop over the board plus a centered message
*"La ronda {upcomingRound} empezará en {countdown}"* with `<LiveLeaderboard>` rendered below
it. Shown only while `phase === 'roundBreak'`.

### `RoyaleReveal` — rewrite of the running view

Composes: the existing top battle bar (alive count, pot, progress) + the per-player grid with
per-card reveal state driven by the projection + `<LiveLeaderboard>` alongside +
`<RoundBreakOverlay>`. New prop `onComplete?: () => void`, passed through to `useRoyaleReveal`.
The grid card shows a card-back / "abriendo…" state until that player's card for the current
round is revealed, then flips to the face (value, rarity chip, year). Existing per-player
styling (leader/at-risk/eliminated) is preserved but now driven by the projection.

**Grid order is stable (seating order) during the reveal** — cards do not reorder as values
change, so a revealing card never jumps position. Live ranking is the leaderboard's job. Only
the standalone `RoyaleResult` screen keeps the ranked (`useRanked`) ordering.

### `BattleFlow` — wire the completion gate

Add a `royaleRevealDone` state (mirrors the pack reveal's `revealDone`). For royale:
`battle.status === 'settled' && royaleRevealDone ? <RoyaleResult…> : <RoyaleReveal … onComplete={() => setRoyaleRevealDone(true)} />`.
This fixes the current behavior where `settled` immediately swaps to the result screen and cuts
off the final round's animation.

### `index.css`

Reuse the existing `flipIn` / `.animate-flip-in` keyframes for the card reveal. Add a blur
transition for the round-break backdrop and a small "pop" animation for the countdown number.

## Timeline of a round

1. Reveal each player's card in seating order, one at a time: flip card-back→face (~400ms) +
   the player's accumulated value counts up + the leaderboard reorders live. Minimum ~900ms
   dwell per card; if the pull hasn't landed, wait showing "abriendo…".
2. After the last card: ~800ms beat highlighting the eliminated player (✕).
3. If more rounds remain: blur the board + overlay "La ronda {X+1} empezará en 5" counting
   5→0 (1s/tick) with the leaderboard below. At 0, unblur and start the next round.
4. Round 1 starts directly (no leading countdown). The final round has no trailing countdown:
   on finish → `onComplete` → `RoyaleResult`.

## Edge cases

- **Reduced motion:** skip flips/countdown; show the full current state (today's behavior) and
  fire `onComplete` when settled.
- **Battle already `settled` when opened:** `BattleFlow` goes straight to `RoyaleResult` (no
  forced replay).
- **Latecomer to a running battle (v1):** the replay plays from round 1 at normal cadence.
  Accepted trade-off; a "skip to live" control is out of scope.
- **Partial round data:** the projection reveals only cards that exist; the next slot shows
  "abriendo…" until its pull lands.

## Testing

`RoyaleReveal.test.tsx` with fake timers:
- (a) reveals cards progressively in seating order (advancing timers reveals the next card);
- (b) the live leaderboard is ordered by accumulated insured value;
- (c) shows the round-break countdown between rounds with the correct upcoming round number;
- (d) `onComplete` is called after the final round once `status === 'settled'`;
- (e) reduced-motion renders the full state immediately and fires `onComplete` when settled.

## Defaults

- Per-card dwell: **~900ms**. Round-break countdown: **5s** (1s/tick).
