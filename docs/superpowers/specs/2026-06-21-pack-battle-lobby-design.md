# Pack Battle · #3 — Lobby / matchmaking + operator gas + Provably-Fair (design)

Date: 2026-06-21
Status: approved-pending-review
Parent: Pack Battle (`2026-06-20-pack-battle-orchestration-engine-design.md`)
Depends on: the engine + multi-standard transfer layer (merged; validated live end-to-end).

## Goal
The product layer that lets players **create and join Pack Battles**; when a battle fills it triggers
the (already-built, live-validated) engine to run it end-to-end. Includes the **operator-funded escrow
gas** so runs actually settle on devnet, and a **Provably-Fair commit-reveal** tie-break.

## Scope (v1 = #3)
- Lobby (create / join / list-open / get-state) — REST. State via poll (WS push = #4).
- **Pack Battle** runs end-to-end on fill. The `mode` field exists for forward-compat, but **#3 only
  accepts/creates `mode="pack"`**; `"royale"` is rejected ("coming soon") until #3b.
- Operator wallet seeds SOL into each fresh escrow at run start.
- Provably-Fair (commit-reveal) tie-break, replacing the deterministic grade/join-order tiebreak.

## Decisions (from brainstorming)
- **Stake = verify-at-join:** at create/join, verify the player has ≥ price USDC + an active session
  signer; the USDC is debited at the pull (run time), re-checked by the engine's `can_play`. No USDC
  escrow/lock. (Matches "USDC depositado → se le descontaría".)
- **Operator seeds escrow:** one funded Privy operator wallet transfers ~0.01 SOL to each fresh escrow
  at run start (before pulls). One wallet to top up; basis of the mainnet model.
- **Provably-Fair commit-reveal** for the random tie-break (rare exact-insuredValue ties).
- **Fill is atomic:** the `lobby→running` transition + run-trigger happen once (DB guard); no over-fill.

## Models (`backend/app/models.py`)
Extend `PackBattle`:
- `server_seed` (str, nullable) — secret, generated at creation, **revealed at settle**.
- `server_seed_hash` (str) — `sha256(server_seed)` hex, public from creation (the commitment).
- `client_seed` (str, nullable) — set at settle, `sha256(":".join(sorted(nft_addresses)))`.
- `tie_break_index` (int, nullable) — the drawn index when a tie-break occurred (audit; null otherwise).
(`BattlePlayer` already has `wallet_id`, `joined_at`. `BattlePull` already records nft/value/grade.)

## Provably-Fair tie-break (changes the engine)
Replace `determine_winner(pulls, join_order)` with:
`determine_winner(pulls, *, server_seed, client_seed) -> (winner_wallet, tie_break_index | None)`
- Candidates = players whose `insured_value` equals the max.
- One candidate → return `(that wallet, None)`.
- ≥2 candidates → sort candidate wallets lexicographically; `idx = int.from_bytes(hmac_sha256(server_seed,
  client_seed)[:8], "big") % len(candidates)`; return `(candidates[idx], idx)`.
- `client_seed` is derived by the engine from the pulls: `sha256(":".join(sorted(nft_addresses)))` — public,
  CC-determined, operator-independent. The engine stores `client_seed` + `tie_break_index` on the battle.
- **Verification:** anyone recomputes `sha256(server_seed) == server_seed_hash`, recomputes `client_seed`
  from the public pulls, recomputes the draw → confirms the winner. Operator committed `server_seed_hash`
  before any pull, so it cannot bias the draw.
- The engine's `run_battle` gains `server_seed` (passed from the battle) and computes/stores the rest at settle.

## Operator-funded escrow gas
- Config: `PRIVY_OPERATOR_WALLET_ID` + `PRIVY_OPERATOR_ADDRESS` (a Privy server wallet owned by our key
  quorum, funded with devnet SOL), `ESCROW_SEED_LAMPORTS` (default 10_000_000 = 0.01 SOL).
- `run_pack_battle_live` (or the engine), right after creating the fresh escrow and before pulls, builds a
  System transfer `operator → escrow` for `ESCROW_SEED_LAMPORTS`, signs it via Privy (operator wallet,
  sign-only), and submits via our RPC. If seeding fails → void (no charge). New helper
  `seed_escrow(rpc_url, signer, operator_wallet_id, operator_address, escrow_address, lamports, blockhash)`.

## Service `backend/app/services/pack_lobby.py`
- `create_battle(session, creator_wallet, creator_wallet_id, *, machine_code, price, max_players) -> PackBattle`
  — validate (`2 ≤ max_players ≤ 10`, machine open, creator USDC ≥ price, session signer present);
  generate `server_seed` (32 random bytes hex) + `server_seed_hash`; create `PackBattle(status="lobby",
  mode="pack")` + add creator as first `BattlePlayer`. (`mode="royale"` → raise `ModeNotSupported`.)
- `join_battle(session, battle_id, player_wallet, player_wallet_id) -> PackBattle` — validate (battle
  exists + `status=="lobby"`, not full, player not already joined, USDC ≥ price, session signer present);
  add `BattlePlayer`. If the join makes `count == max_players` → **atomic** `lobby→running` (a guarded
  UPDATE: `UPDATE pack_battles SET status='running' WHERE id=? AND status='lobby'`; only the row that
  flips it proceeds) → schedule the run (`asyncio.create_task`).
- `list_open(session) -> list[dict]` (status=="lobby"); `get_battle(session, id) -> dict` (status, mode,
  machine, players, max, winner, server_seed_hash, and after settle: server_seed/client_seed/tie_break_index).
- `verification(battle) -> dict` — the Provably-Fair payload (hashes/seeds) for a verify endpoint.

## Endpoints (`backend/app/main.py`, follow the `/matches` pattern; Privy-auth-gated)
- `POST /pack-battles` `{machine_code, max_players}` → create (creator from the token).
- `POST /pack-battles/{id}/join` → join (player from the token).
- `GET /pack-battles/open` → open lobbies.
- `GET /pack-battles/{id}` → battle state (+ Provably-Fair fields).
- Auth: resolve `wallet` + `wallet_id` from the Privy token (`embedded_solana_wallet_id`); the USDC +
  session-signer checks reuse `usdc_balance_base_units` + a Privy signer-presence check.

## Run trigger + concurrency
- On the winning atomic fill, `asyncio.create_task(run_pack_battle_live(session_factory(), battle_id, ...))`
  (a fresh session for the background task). The task: seed escrow → engine → settle/void. Errors are
  caught + logged; the battle ends `settled` or `voided`.
- Guard: the guarded UPDATE guarantees exactly one fill triggers exactly one run; late joiners get
  "battle full". A create/join is rejected if the player is mid-another-running-battle (optional v1: skip).

## Error handling
- Validation failures (USDC, signer, full, dup, closed machine, bad max_players, royale) → 4xx with a
  clear code; nothing charged.
- Run-time failures (seed/pull/settle) → engine voids + returns (already built); battle `voided`.
- Background-run crash → caught + logged; battle marked `voided` if not already settled.

## Testing
- Lobby service (pytest, mocked gacha/RPC/signer): create validation, join validation, the atomic-fill
  guard (two joins racing → one run), royale rejected.
- Provably-Fair: `determine_winner` deterministic given seeds; tie → correct index; single-max → no draw;
  a golden verification vector (recompute from public data → same winner).
- Operator seed: `seed_escrow` builds the right System transfer; void on seed failure.
- Endpoints: respx/auth-mocked happy paths + a 4xx each.
- Engine/wiring updated for the new `determine_winner` signature + `server_seed` threading.

## No-goals (this sub-project)
- **Battle Royale engine** (multi-round elimination) → #3b (reuses lobby + gas + the draw primitive).
- UI (#4); WS push (poll in v1); on-chain VRF (commit-reveal is sufficient for the rare tie-break);
  cNFT/MPL Core; cross-battle "one battle at a time" enforcement (optional later).
