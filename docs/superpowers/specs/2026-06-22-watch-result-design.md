# Watch + result, live round-by-round reveal (#4b-3) — design

Date: 2026-06-22
Status: approved-pending-review
Parent: Lobby online (`2026-06-22-lobby-online-design.md`, #4b-2), Royale state + PF verify (`2026-06-22-royale-state-verify-design.md`, #4a), Pack Battle data layer (`2026-06-22-pack-battle-client-design.md`, #4b-1).
Part of #4 (UI). This is the **watch + result** experience: a routed full-screen flow that polls a battle and reveals each player's pulls **live, round by round** (gacha-style) as the server resolves them, culminating in the winner + pot recap.

## Goal
After a user creates or joins a battle (#4b-2), take them to a live spectacle:
- **Royale**: as each round's pulls resolve on the server, reveal every player's card (face-down "opening" → flip on resolve), then mark who is eliminated that round and the accumulated values; advance round by round to the winner.
- **Pack** (2–10 players, single pull each): reveal all players' cards at once (face-down → flip), highest `insured_value` wins (winner takes both).
- A **result** screen at settle: winner + pot recap.

To show cards **during** the battle (not only at settle), one scoped backend change exposes the pull recap during `running` while keeping the provably-fair seed hidden until settle.

Also folds in a small #4b-2 correction: the create modal currently forces pack to 2 players; the backend already supports pack 2–10, so the modal is opened up to match.

## Background (current code)
- **Backend** (`backend/app/`):
  - `pack_lobby.get_battle(session, id)` returns `{id, mode, machine_code, price, max_players, status, winner, creator_wallet, players, rounds, server_seed_hash}` and, **only when `status == "settled"`**, adds `server_seed, client_seed, tie_break_index, pulls` (the recap). `players` = `_player_states` (`{wallet, eliminated_round, accumulated_value}`); `rounds` = `_rounds` (`{round_number, eliminated_wallet, tie_break_index}`, royale audit; `[]` for pack); `pulls` = `_pull_recap` (`{round_number, player_wallet, nft_address, rarity, insured_value, auto_sold}`, ordered by `round_number, id`).
  - **Royale engine** (`services/royale_engine.py`) persists each `BattlePull` incrementally: a "pending" row (`round_number`, no `nft_address`) is committed when the pull starts, then `nft_address/insured_value/rarity/auto_sold` are filled and committed when the pack opens. `BattleRound` (the elimination) is committed at the end of each round. So during `running`, completed pulls and rounds appear in the DB progressively.
  - **Pack engine** (`services/pack_engine.py`) does one pull per player (`for w in players`), `determine_winner` = highest `insured_value` (PF tie-break). `BattlePull` rows here are created without an explicit `round_number`, so it **defaults to `1`** (the model column default). No `BattleRound` rows (pack `rounds == []`). Supports 2–10 players (`create_battle` validates `2 <= max_players <= 10`).
  - `BattlePull` has **no `image` column**; the card image is NOT persisted. `gacha.open_pack`'s result does carry `image`, but the pull recap does not — so the image is sourced client-side (below).
  - Existing secrecy tests: `test_get_battle_royale_live_state_no_cards` (`tests/test_pack_lobby.py`) asserts running → `"pulls" not in v and "server_seed" not in v`; `test_get_battle_hides_server_seed_until_settled`; `test_get_battle_postsettle_pull_recap`.
- **Frontend data layer (#4b-1)**: `src/onchain/packBattleClient.ts` — `Battle` type with `players: BattlePlayerState[]` (`{wallet, eliminated_round, accumulated_value}`), `rounds: BattleRoundInfo[]`, `pulls?: BattlePullInfo[]` (`{round_number, player_wallet, nft_address, rarity, insured_value, auto_sold}`), `winner`, `status`. `src/onchain/useBattle.ts` — polls `getBattle(id)` every `intervalMs` (default 2000), stops at terminal status, leak-free.
- **Hub (#4b-2)**: after create/join, the Hub opens a `BattleWaiting` **modal** (`src/ui/screens/Hub/BattleWaiting.tsx`) and polls with `useBattle`, showing a placeholder once status leaves `lobby`. `CreateBattleModal` + `buildCreateBody` (`src/ui/screens/Hub/`) force pack to `max_players = 2`.
- **Helpers to reuse**: `theme.RARITY` (rarity color tokens, keys `common|uncommon|rare|epic`), `theme.COLORS/FONTS/formatUsd`, `useEmbeddedSolanaAddress(): string | null` (`src/wallet/embedded.ts`, the user's embedded Solana address — used to mark "me"), `useReducedMotion`, `framer-motion` (already used by the local royale). `gachaClient.ccAssetUrl(mint): string` returns a CollectorCrypt **page** URL (used as an `<a href>` "View ↗" link, NOT an `<img src>`).
- **Card image source (CollectorCrypt direct, by mint)**: CC serves card images by mint with no auth (https://docs.collectorcrypt.com/metadata). `GET {base}/front/{mint}` **302-redirects to the front image** and falls back to a CC placeholder server-side if the card has no image — so it works **directly as an `<img src>`** with no fetch, no DAS, no metadata parsing. Devnet base: `https://nft-dev.collectorcrypt.com` (prod: `https://nft.collectorcrypt.com`); this app is on devnet. This design adds a tiny helper `ccCardImageUrl(mint): string` to `src/onchain/gachaClient.ts` (mirrors the existing `ccAssetUrl`) returning `https://nft-dev.collectorcrypt.com/front/${mint}`. No backend image persistence, no DAS dependency.
- **Local royale sim** (`src/ui/flows/RoyaleFlow.tsx`, `RoyaleBoard`, `RoyaleResultScreen`): kept as-is (local practice vs bots). The online watch is **new** components (decision: "todo nuevo") — the local components are coupled to "human = seat 0" and to per-round local card pulls.

## Backend change (scoped, secrecy-safe)
`get_battle` splits the settle-only block so that **`pulls` is always included** (it naturally contains only the pulls persisted so far), while the **PF seed reveal stays settle-only**:

```python
out = {... existing keys ..., "pulls": _pull_recap(session, battle_id)}   # always
if b.status == "settled":
    out.update(server_seed=b.server_seed, client_seed=b.client_seed,
               tie_break_index=b.tie_break_index)
```

- **Why this is safe:** the live reveal needs card identities (`nft_address/rarity/insured_value/auto_sold`), which cannot be used to predict anything — future rounds depend on `server_seed`, which **remains hidden until settle**. Revealing `server_seed` early would let a player compute `pick_index(server_seed, client_seed_round, n)` and predict tie-break eliminations; that must not change. `client_seed`/`tie_break_index` stay settle-only too (they are the per-round PF proof; `eliminated_wallet` is already public via `rounds`).
- **Pre-settle a pull row may be "pending"** (`nft_address is None`): `_pull_recap` returns it with `nft_address: null`. The frontend renders these face-down. No change to `_pull_recap`.
- This deliberately relaxes the #4a invariant "no NFT/card data pre-settle". The insecure part (the seed) is untouched.

**Test updates** (`tests/test_pack_lobby.py`):
- `test_get_battle_royale_live_state_no_cards` → renamed/repurposed (e.g. `test_get_battle_running_reveals_pulls_but_not_seed`): add a `BattlePull` (one resolved, optionally one pending `nft_address=None`) to the `running` battle; assert `v["pulls"]` is present with the card data **and** `"server_seed" not in v` and `"client_seed" not in v`. Keep the `players`/`rounds`/`creator_wallet` assertions.
- `test_get_battle_hides_server_seed_until_settled` stays green (seed still hidden pre-settle).
- `test_get_battle_postsettle_pull_recap` stays green (settle still reveals seed + pulls).

No engine, schema, or PF changes.

## Frontend

### Routed flow `/play/battle/:battleId`
New `src/ui/flows/BattleFlow.tsx`. Reads `:battleId` (react-router `useParams`), calls `useBattle(battleId, 1500)` (poll a bit faster than the default for a livelier reveal), and `useEmbeddedSolanaAddress()` for "me". Renders by `battle.status`:
- `lobby` → a waiting sub-view ("Esperando jugadores X/Y").
- `running` / `settled` → the reveal (`RoyaleReveal` for `mode === 'royale'`, `PackReveal` for `mode === 'pack'`), with `BattleResult` shown once `settled`.
- `voided` → "Batalla anulada — reembolsado". `cancelled` → "Lobby cancelado".
- An "Volver" control routes to `/app`. Route added in `src/App.tsx`; `src/ui/layouts/navRoutes.ts` `activeNavFromPath` maps `/play/battle` to the lobby nav.

### Adapter `battleToReveal(battle, meWallet)` (pure, tested)
New `src/ui/screens/battle/battleReveal.ts`. Converts the backend `Battle` into a view-model the reveal components render, so the components hold no parsing logic:
```
RevealVM = {
  mode, status, winner: string | null, meWallet: string | null,
  players: { wallet, isMe, accumulatedValue, eliminatedRound }[],   // from battle.players
  rounds: {                                                          // grouped from battle.pulls by round_number
    roundNumber: number,                                            // pack pulls default to round_number 1 → one group
    eliminatedWallet: string | null,                                // from battle.rounds (royale); null for pack/not-yet
    cards: { wallet, isMe, nftAddress: string | null, rarity, insuredValue, autoSold }[],
  }[],
  potValue: number,                                                 // sum of resolved insured_value across pulls
}
```
- Groups `battle.pulls` by `round_number` (ascending). For pack (all `round_number == 1`) → a single group `{ roundNumber: 1, ... }`. For royale → one group per round.
- Cross-references `battle.rounds` to set each group's `eliminatedWallet` (royale). A round still being pulled has no matching `rounds` entry yet → `eliminatedWallet: null` (cards shown, no elimination yet).
- `isMe` = `wallet === meWallet`. `nftAddress == null` → still opening (face-down). `potValue` ignores nulls.
- Pure function; no React. Unit-tested.

### `RevealCard` (`src/ui/screens/battle/RevealCard.tsx`)
Gacha-style card tile. Props: `{ nftAddress: string | null, rarity, insuredValue, autoSold, isMe, reducedMotion }`.
- `nftAddress == null` → face-down "opening…" state (shimmer; respect `reducedMotion`).
- resolved → flip to a rarity-colored card (`theme.RARITY`, keying on `rarity?.toLowerCase()` since the backend sends `"Epic"`/`"common"` etc.; unknown → `COLORS.muted`), showing the image directly as `<img src={ccCardImageUrl(nftAddress)} onError={…}>` (the CC `/front/{mint}` endpoint 302-redirects to the image and falls back to a placeholder server-side; an `onError` swaps to a 🃏 fallback, matching `InventoryCardModal`), the `formatUsd(insuredValue)`, an "auto-sold" badge when `autoSold`, and an optional `<a href={ccAssetUrl(nftAddress)}>` "View ↗".

### `RoyaleReveal` (`src/ui/screens/battle/RoyaleReveal.tsx`)
Props: `{ vm: RevealVM, reducedMotion }`. Renders the rounds from `vm.rounds` in order; per round a row/grid of `RevealCard` (one per player who pulled that round), labeled by player (truncated wallet, "tú" if `isMe`). When the round has an `eliminatedWallet`, mark that player eliminated and show the per-player `accumulatedValue`. The latest round (cards still resolving) is the focus; earlier rounds collapse to a compact summary. Driven entirely by the polled `vm` (new rounds/cards appear as `useBattle` re-polls) — no client timers needed for correctness; framer-motion only for the flip/eliminate flourish.

### `PackReveal` (`src/ui/screens/battle/PackReveal.tsx`)
Props: `{ vm: RevealVM, reducedMotion }`. One group (all players' single pull). Renders all `RevealCard`s at once; on settle, highlights the winner (`vm.winner`) — winner takes both. Truncated wallets, "tú" for me.

### `BattleResult` (`src/ui/screens/battle/BattleResult.tsx`)
Props: `{ vm: RevealVM, onExit }`. Shown when `status === 'settled'`: winner (with "¡Ganaste!" when `winner === meWallet`), pot recap (`formatUsd(vm.potValue)` / card count). A PF-verify entry point is **out of scope** (#4d).

### Lobby / running sub-views
Small inline components (or one `BattleStatusBanner`) for `lobby` (waiting X/Y) and the running header. The #4b-2 `BattleWaiting` **modal is removed** from the Hub flow (its waiting copy moves here).

### Pack 2–10 in create (folds in the #4b-2 correction)
`src/ui/screens/Hub/createBattleBody.ts` — `buildCreateBody` stops forcing pack to 2: pack uses the chosen player count like royale (`max_players: players` for both). `CreateBattleModal.tsx` shows the player-count selector for pack too (2–10). Update `createBattleBody.test.ts`: pack with a chosen count → `max_players` = that count (drop the "pack forces 2" assertion; replace with "pack uses chosen count").

### Hub wiring
`src/ui/screens/Hub/Hub.tsx`: after `joinBattle` / `onCreated`, `navigate('/play/battle/' + id)` instead of opening the `BattleWaiting` modal. `onBattleAction` Watch → also navigates there. Remove the `BattleWaiting` modal usage and its state. `BattleWaiting.tsx`/`BattleWaiting.test.tsx` are deleted (superseded by the flow).

## Data flow
1. Hub create/join → navigate to `/play/battle/:id`.
2. `BattleFlow` polls `getBattle(id)` every 1.5s → `battle`.
3. `battleToReveal(battle, meWallet)` → `vm`.
4. `RoyaleReveal`/`PackReveal` render `vm`; as polls bring new resolved pulls and rounds, cards flip and eliminations mark — live.
5. `status === 'settled'` → `BattleResult` (winner + pot). Polling stops (terminal) via `useBattle`.

## Error handling
- `useBattle` transient errors → keep polling (existing posture); the flow shows a subtle "reconectando…" if `error` is set and there is no `battle` yet.
- Missing/unknown `:battleId` or a 404 → the flow shows "Batalla no encontrada" + Volver.
- `voided`/`cancelled` terminal states render their message (refund/cancel handled server-side; the money UI is #4c).
- Spectator with no embedded wallet (`meWallet == null`) → reveal still renders; nothing is marked "tú".

## Testing
- **Backend** (`tests/test_pack_lobby.py`): running battle with a resolved + a pending `BattlePull` → `get_battle` includes `pulls` (card data + the pending `nft_address: null`) and excludes `server_seed`/`client_seed`; settle still reveals the seed (existing test green).
- **Frontend** (`npm test`):
  - `battleToReveal`: royale pulls across 2 rounds → grouped by round with correct `eliminatedWallet` from `rounds`, a pending card (`nftAddress null`), `isMe` marking, `potValue` excluding nulls; pack pulls (`round_number null`) → single group, winner set; empty pulls → empty rounds.
  - `BattleFlow`: mock `useBattle` → `lobby` shows waiting; `running` royale shows `RoyaleReveal`; `settled` shows `BattleResult`; `voided` shows the anulada message. (Mock `useParams`/`useEmbeddedSolanaAddress`.)
  - `ccCardImageUrl`: returns `https://nft-dev.collectorcrypt.com/front/${mint}` for a mint.
  - `RevealCard`: pending (`nftAddress null`) → face-down (no `<img>`); resolved → an `<img>` whose `src` is `ccCardImageUrl(mint)`, rarity color keyed case-insensitively (`"Epic"` → epic token), auto-sold badge when `autoSold`.
  - `RoyaleReveal`: a round with one pending + one resolved card renders a face-down and a flipped card; an eliminated wallet is marked.
  - `PackReveal`: all cards render; on settle the winner is highlighted.
  - `buildCreateBody`: pack with chosen count N → `max_players === N` (both modes use the count).

## No-goals
- Provably-Fair verification panel (#4d) — `BattleResult` does not link to it yet.
- Reserved/available balance, cancel-lobby, refund/void money UI (#4c).
- **Multi-pack pack battles** (selecting several packs from different machines → multi-round pack) — a separate future sub-project (#4e) that will reuse this reveal's per-round machinery.
- Any change to the engines, the PF algorithm, the round pacing, or the on-chain program.
- Online mana lobbies.
