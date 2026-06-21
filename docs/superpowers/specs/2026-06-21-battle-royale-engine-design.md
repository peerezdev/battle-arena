# Battle Royale · #3b — multi-round elimination engine (design)

Date: 2026-06-21
Status: approved-pending-review
Parent: Pack Battle (`2026-06-20-pack-battle-orchestration-engine-design.md`, `2026-06-21-pack-battle-lobby-design.md`)
Depends on: the engine + transfer layer + lobby + Provably-Fair (all merged).

## Goal
The multi-round Battle Royale mode: players pay a flat buy-in into a pool; each round every surviving
player pulls (paid from the pool but **on-chain with their own wallet**), accumulating `insuredValue`;
after each round the lowest-accumulated player is eliminated (ties broken by the Provably-Fair draw);
the last player standing wins all the cards.

## Funding model (decided in brainstorming)
- **Flat buy-in, collected at join.** Total pulls in an N-player royale is deterministic:
  `total_pulls(N) = N(N+1)/2 − 1` (round k has `N−k+1` pullers, k=1..N−1). Buy-in per player =
  `ceil(total_pulls(N) × price / N)` (round up so the pool always covers the pulls; remainder → winner).
- The **escrow doubles as the USDC pool**: created at battle **creation**; each player's buy-in is
  collected into it at join (a USDC transfer player→escrow, signed server-side via the player's session signer).
- **Each round, per surviving player:** the escrow distributes exactly `price` USDC → the player's wallet,
  then the **player pays their own pull** (`generate_pack(player, alt_player_address=escrow)`) → card → escrow.
  Both signed server-side (escrow distribution via the key quorum; pull via the player's session signer).
  → Every pull is **on-chain attributable to the player's wallet** (the requirement), funded transparently
  from the pool.
- Winner takes all escrow cards. The pool is spent exactly on the pulls (→ 0 USDC left, modulo the rounding remainder).
- This mode does NOT use the reserved-balance (#3c) — the buy-in is actually collected at join.

## Models (`backend/app/models.py`)
- `BattlePlayer`: add `eliminated_round` (Integer, nullable; null = still in / the winner) +
  `accumulated_value` (Float, default 0).
- `BattlePull`: add `round_number` (Integer, default 1) — a player has one BattlePull per round survived.
- New `BattleRound`: `id` (PK), `battle_id` (indexed), `round_number`, `client_seed`, `eliminated_wallet`,
  `tie_break_index` (nullable) — the per-round Provably-Fair audit trail.

## Provably-Fair per round
- One `server_seed` committed at creation (reuses #3's commit-reveal; `server_seed_hash` public).
- Each round's elimination tie-break uses a **per-round client_seed**:
  `client_seed_round = sha256(f"{round_number}:" + ":".join(sorted(this_round's nft_addresses)))`.
- `idx = pick_index(server_seed, client_seed_round, len(tied_losers))` → eliminate `sorted(tied_losers)[idx]`.
- Stored on `BattleRound`. Verifiable post-settle (server_seed revealed) from the public per-round pulls.

## Engine — `backend/app/services/royale_engine.py :: run_royale(...)`
Injected I/O (all async; unit-tested with mocks): `gacha`, `signer`, `resolve_wallet_id`,
`distribute_usdc(escrow_address, player_address, lamports) -> str`, `confirm_usdc(player_address, min_base_units) -> bool`,
`confirm_in_escrow`, `build_transfer_tx`, `submit_tx`, `prepare_escrow`, `now_fn`, `sleep_fn`,
plus `price_base_units` and the battle's `server_seed`.

Flow:
1. Pre-flight: read players (the buy-ins were collected at join). `prepare_escrow` already seeded SOL.
2. `remaining = players`, `accumulated = {p: 0.0}`, `round_number = 0`.
3. While `len(remaining) > 1`:
   - `round_number += 1`; `round_pulls = []`.
   - For each `p` in `remaining` (sequential):
     - `await distribute_usdc(escrow, p, price_base_units)`; poll `await confirm_usdc(p, price_base_units)` until true (bounded; timeout → void).
     - `pack = await gacha.generate_pack(p, machine_code, alt_player_address=escrow)`; persist `BattlePull(round_number, p, memo)`;
       `signed = await signer.sign_solana(resolve_wallet_id(p), pack.tx)`; `await gacha.submit_tx(signed)`; poll `open_pack`.
     - record `nft_address/insured_value` on the BattlePull; `accumulated[p] += insured_value`; `round_pulls.append((p, nft, value))`.
   - Eliminate: `minv = min(accumulated[p] for p in remaining)`; `losers = sorted([p for p in remaining if accumulated[p]==minv])`.
     - 1 loser → `elim = losers[0]`, `tie_idx = None`. Else → `cs = client_seed_round(round_number, round_nfts)`;
       `tie_idx = pick_index(server_seed, cs, len(losers))`; `elim = losers[tie_idx]`.
     - `remaining.remove(elim)`; set `BattlePlayer(elim).eliminated_round = round_number`; persist `BattleRound(...)`.
4. `winner = remaining[0]`; `BattlePlayer(winner).eliminated_round` stays null.
5. **Settle:** for each escrow card (all `BattlePull.nft_address`): `await _wait_in_escrow(...)` → `build_transfer_tx(escrow, winner, nft)` → `sign_solana(escrow)` → `submit_tx`. Mark `winner` + `status="settled"` + `settled_at`.

A failure at any pull/distribution/settle → **void** (see below).

## New helpers (`pack_orchestration.py` / `nft_transfer.py`)
- `distribute_usdc(rpc_url, signer, escrow_wallet_id, escrow_address, player_address, usdc_mint, lamports, blockhash) -> str`
  — SPL `transfer_checked` (escrow USDC ATA → player USDC ATA, create dest ATA idempotent), fee-payer = escrow, sign via the escrow's quorum, submit via our RPC.
- `usdc_in_wallet(rpc_url, owner, usdc_mint) -> int` — reuse/parallel `usdc_balance_base_units`; `confirm_usdc` = balance ≥ min.

## Lobby integration (extend `pack_lobby.py` + endpoints)
- Allow `mode="royale"` in `create_battle` (no longer rejected). For royale: create the escrow **at creation**
  (Privy server wallet) so buy-ins can be collected; compute + store the buy-in.
- `join_battle` (royale): collect the buy-in (player→escrow USDC transfer, server-side) as part of joining;
  the atomic fill still triggers the run, dispatching to `run_royale` (vs `run_battle` for pack).
- `GET /pack-battles/{id}` exposes mode, round state, eliminated players, per-round PF audit (post-settle).

## Error handling / void (v1)
- A distribution/pull/settle failure → **void**: best-effort **refund** each player their buy-in from the
  escrow's remaining USDC (`escrow → player`), mark `voided`, log. Cards already pulled remain in the escrow
  (ops reclaims/buybacks them) — a perfect partial-tournament unwind is **out of v1 scope** (flagged).
- `confirm_usdc`/`confirm_in_escrow` timeouts → void. Seed/escrow-create failure → void before any buy-in is spent.

## Testing
- `royale_buyin(n, price)` pure (golden values: n=4,$50→$112.50; n=10,$50→$270).
- `run_royale` with mocked I/O: a 3- and 4-player tournament settles to the correct winner (highest cumulative);
  per-round elimination of the min; a forced tie → PF draw eliminates the drawn loser; distribution-before-pull
  ordering (confirm_usdc gates the pull); void on a pull/distribution failure. `client_seed_round` deterministic.
- `distribute_usdc` builds the right SPL transfer (decode + assert). Lobby: royale create makes the escrow +
  computes buy-in; join collects it. All mocked (no live calls).

## No-goals
- Perfect partial-tournament refund/unwind (v1 = best-effort pool refund); UI (#4); the reserved-balance
  layer (#3c, Pack Battle); cNFT/MPL Core; on-chain VRF; live devnet run (separate, gated on USDC/SOL).
