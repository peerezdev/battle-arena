# Reserved balance + cancel + void refunds — design

Date: 2026-06-22
Status: approved-pending-review
Parent: Pack Battle / Battle Royale engines + lobby + turbo settle (all merged).
Implemented as TWO plans: **#3c** (reserved balance + gate + cancel) then **#3d** (void refunds). One shared model addition (`BattlePull.buyback_amount`) lands in #3d.

## Goal
Close the over-commit hole and complete the money lifecycle around battles:
- A player's funds committed to a pending Pack Battle are **reserved** so they cannot be spent/withdrawn elsewhere until the battle resolves (Privy is the sole spending gate → the backend refusing to sign over-committed spends is an effective lock).
- The **creator** can **cancel** an unfilled lobby (manual), refunding correctly.
- A mid-run **void** unwinds fairly: everyone gets their own realised pulls back (cards or auto-buyback USDC); in Royale, survivors also split the liquidated leftover.

## Background (current code)
- Pack Battle `_require_funds` (`main.py:364`) is a **point-in-time** on-chain check that reserves nothing; the pull is paid just-in-time by the player at run → a player can over-commit across pending Pack Battles. This is the hole #3c closes.
- Royale collects the buy-in **upfront** at join (`collect_buyin`, `main.py:435/472`) → no deferral; it only needs to **check** reserved-aware availability before collecting.
- No cancel and no withdrawal endpoint exist today. Withdrawal is out of scope (the gate helper will be ready for it).
- Engines today: pack `_void_return` returns NFTs to pullers on void; royale `_void` just marks voided (refund was deferred here).

---

# Plan #3c — reserved balance + gate + cancel

## Reservation ledger (`backend/app/services/reservations.py`, new)
- New model `Reservation`: `id` (PK), `wallet` (indexed), `battle_id` (indexed), `amount` (Integer, USDC base units), `status` (String, default `"active"` → `"released"`), `created_at`, `released_at` (nullable).
- Pure-DB helpers (unit-testable without RPC):
  - `reserve(session, wallet, battle_id, amount) -> Reservation` — insert an active reservation.
  - `reserved_total(session, wallet) -> int` — `Σ amount WHERE wallet=? AND status='active'`.
  - `release_reservations(session, battle_id) -> int` — set every active reservation for `battle_id` to `released` (+ `released_at`); returns count. Idempotent.
- **Available balance** is computed where the RPC read lives (endpoint/wiring), not inside the pure helpers:
  `available = await usdc_balance_base_units(rpc_url, wallet, usdc_mint) − reserved_total(session, wallet)`.

Reservations are created **only by Pack Battle** (the only deferred-payment path). Royale creates none.

## Spend gate (`main.py`)
- Add `async def _require_available(wallet, amount)`: `avail = (await usdc_balance_base_units(...)) − reserved_total(s, wallet)`; if `avail < amount` → `HTTPException(402, "USDC disponible insuficiente")`. This **replaces** `_require_funds` at every spend point:
  - **Pack create**: check `available >= price`, create battle, `reserve(s, creator, battle.id, price)`.
  - **Pack join**: check `available >= price`, join, `reserve(s, joiner, battle.id, price)`.
  - **Royale create/join**: check `available >= buyin`, then `collect_buyin` (no reservation).
  - **Solo gacha pull** (`/gacha/generate-pack`): check `available >= price` before returning the pull tx.
- The check + reservation insert run in one DB transaction. Concurrency note: under the current single-process SQLite, writes serialize, so a per-wallet double-spend race cannot occur; a multi-worker Postgres deployment would need `SELECT … FOR UPDATE` on the wallet's reservations (flagged, out of scope now).

## Reservation release (wiring)
- In `_run_bg` / `_run_royale_bg` (`main.py`), after `run_*` returns (any terminal result, settled **or** voided), call `release_reservations(s2, battle_id)`. (Royale: no-op; it has none.)
- This keeps the engines reservation-agnostic. The release-at-run-end window means a player's availability is briefly understated while their own battle runs (seconds–minute) — acceptable (they're mid-battle).

## Creator-cancel (`pack_lobby.py` + endpoint)
- Add `PackBattle.creator_wallet` (String), set in `create_battle`. Add status value `"cancelled"`.
- `cancel_battle(session, battle_id, wallet) -> PackBattle` (pure DB): raise `LobbyError` unless `wallet == b.creator_wallet` and `b.status == "lobby"`; set `status="cancelled"`; commit. (Money I/O is done by the endpoint.)
- Endpoint `POST /pack-battles/{id}/cancel` (creator only):
  - **Pack**: `cancel_battle(...)` → `release_reservations(s, battle_id)`. No money moved.
  - **Royale**: `cancel_battle(...)` → for each player, refund their buy-in `escrow → player` (reuse `distribute_usdc` / `build_token_transfer`, escrow sole signer), with bounded retries; then cancelled. The escrow holds exactly `Σ buy-ins`.

## Models (#3c)
- New `Reservation` (above).
- `PackBattle.creator_wallet` (String) + status enum gains `cancelled`.

## Testing (#3c)
- `reserved_total` / `reserve` / `release_reservations`: pure DB — create, sum actives only, release flips status + sets released_at, idempotent.
- Gate rejects over-commit: a wallet with on-chain funds for ONE price that joins one Pack Battle then attempts a second join / a solo pull / a royale buy-in is rejected (402) because `available` already excludes the reservation. (Mock `usdc_balance_base_units`.)
- Release on terminal: after a (mocked) run returns settled/voided, the battle's reservations are released.
- `cancel_battle`: only creator + only `lobby`; non-creator → error; running → error. Pack cancel releases reservations; royale cancel refunds each buy-in (assert the escrow→player transfers built).

---

# Plan #3d — void refunds

## Persist buyback amount
- Add `BattlePull.buyback_amount` (Integer, nullable, USDC base units). Persist it in BOTH engines' pull loops when `res["auto_sold"]` (from `open_pack`'s `buyback_amount`). Needed to refund the exact USDC of each auto-sold common.

## Refund module (`backend/app/services/refund.py`, new) — resilient, injected I/O
Mirror `settle_cards_to_winner`: bounded retries, never raise, log no secrets. Called by the wiring when a run returns `"voided"`. The engines stop doing inline `_void_return` (pack) — refund is centralised here.

- `refund_pack_void(session, battle, *, escrow_wallet_id, escrow_address, build_transfer_tx, submit_tx, signer, build_usdc_transfer_tx, confirm_in_escrow, sleep_fn, max_attempts, wait_*) -> None`
  For each `BattlePull` of the battle:
  - non-common (`auto_sold == False`, `nft_address` set): transfer the card `escrow → pull.player_wallet`.
  - auto-sold common (`auto_sold == True`): refund `buyback_amount` USDC `escrow → pull.player_wallet`.
  - a player with no pull row → nothing to return (their reservation is released by the wiring).
  No pool, no elimination — every puller gets their own pull back.

- `refund_royale_void(session, battle, *, escrow_wallet_id, escrow_address, gacha, build_transfer_tx, submit_tx, signer, build_usdc_transfer_tx, confirm_in_escrow, sleep_fn, max_attempts, wait_*) -> None`
  1. `alive = [p.player_wallet for BattlePlayer p where eliminated_round IS NULL]`.
  2. For each alive player, for each of THEIR `BattlePull`s: non-common → transfer card to them; auto-sold → refund `buyback_amount` USDC to them.
  3. For each ELIMINATED player's non-common `BattlePull`: **buyback** the card (escrow → CC) → USDC lands in the escrow. (Bounded retries; a card that fails buyback is flagged + left, not fatal.)
  4. `leftover = ` escrow USDC balance now (= eliminated commons' buyback USDC + eliminated cards' buyback USDC + undistributed pool).
  5. Split `leftover` **equally among the alive players**: `share = leftover // len(alive)`; transfer `share` to each (escrow sole signer). The integer remainder (`leftover % len(alive)`, a few base units) stays in the escrow (negligible; flagged in logs).
  6. Eliminated players receive nothing; the operator nets zero.

## Wiring (`main.py`)
- `_run_bg`: `result = await run_pack_battle_live(...)`; **if `result == "voided"`** → `await refund_pack_void(...)` with the live I/O closures (incl. a new `build_usdc_transfer_tx(src, dest, amount)` closure and the buyback hooks for royale). Then `release_reservations` (already from #3c, runs on any terminal).
- `_run_royale_bg`: same, calling `refund_royale_void(...)` on `"voided"`.
- Pack engine: remove the inline `_void_return` call from `run_battle` (its job moves to `refund_pack_void`); `run_battle` still marks `voided` + returns `"voided"`. Royale `_void` is unchanged (already just marks voided).

## Models (#3d)
- `BattlePull.buyback_amount` (above). No other schema change.

## Testing (#3d)
- `refund_pack_void` (mocked I/O + in-memory DB): returns each non-common card to its puller; refunds each auto-sold common's `buyback_amount` to its puller; a not-yet-pulled player gets nothing transferred; never raises.
- `refund_royale_void`: a 3-player tournament with one eliminated and a forced auto-sold common — alive players receive their own cards + their own commons' USDC; eliminated player's card is bought back; `leftover` is split equally among the alive (assert per-alive share = `leftover // n_alive`); eliminated receives nothing; the operator/escrow nets ~zero (only the integer remainder stays). Never raises.
- Wiring: a `"voided"` result triggers the matching refund; a `"settled"` result does not.

## No-goals (both plans)
- Withdrawal endpoint (gate helper is ready, but no endpoint now).
- Multi-worker concurrency hardening of the reservation gate (SQLite serialises; flagged).
- Perfect partial-tournament accounting beyond the agreed policy.
- Reservation TTL / stuck-battle auto-release (every run terminates settled/voided → released; a crashed background task leaving a battle `running` forever is a flagged ops edge, not handled here).
