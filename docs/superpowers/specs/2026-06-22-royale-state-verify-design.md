# Royale state in get_battle + Provably-Fair /verify (#4a) — design

Date: 2026-06-22
Status: approved-pending-review
Parent: Pack Battle lobby (`2026-06-21-pack-battle-lobby-design.md`), Battle Royale engine, Provably-Fair.
Part of #4 (UI). This is the **backend** piece the frontend (#4b/#4c/#4d) consumes; it ships independently.

## Goal
Expose the data the frontend needs to render a live Battle Royale and a Provably-Fair verification panel, **without breaking the secrecy rule** (losers never see the NFTs until the winner is decided):
- `get_battle` gains the royale live state (per-player elimination + accumulated value, per-round audit, creator) and a **post-settle-only** pull recap.
- A new `GET /pack-battles/{id}/verify` returns the commit-reveal proof — per-round for royale.

## Background (current code)
- `pack_lobby.get_battle(session, battle_id)` returns `{id, mode, machine_code, price, max_players, status, winner, players, server_seed_hash}` and, post-settle, reveals `server_seed/client_seed/tie_break_index`. `players` is a list of wallet strings (`_players`).
- `pack_lobby.verification(b)` returns the battle-level commit-reveal (`server_seed_hash`, `server_seed` if settled, `client_seed`, `tie_break_index`, `commit_ok = verify_commit(server_seed, server_seed_hash)`).
- Models: `PackBattle.creator_wallet` (from #3c); `BattlePlayer.eliminated_round`/`accumulated_value`; `BattleRound{round_number, client_seed, eliminated_wallet, tie_break_index}`; `BattlePull{round_number, player_wallet, nft_address, rarity, insured_value, auto_sold}`.
- `provably_fair.verify_commit(server_seed, hash)`; the per-round draw is `pick_index(server_seed, round.client_seed, n_tied)`.

## `get_battle` — enriched shape (`pack_lobby.py`)
Returns:
```
id, mode, machine_code, price, max_players, status, winner, creator_wallet, server_seed_hash,
players: [ { wallet, eliminated_round, accumulated_value } ],   # enriched (was a list of wallet strings)
rounds:  [ { round_number, eliminated_wallet, tie_break_index } ],   # royale audit; [] for pack / pre-elimination
# post-settle (status == "settled") ONLY:
server_seed, client_seed, tie_break_index,
pulls: [ { round_number, player_wallet, nft_address, rarity, insured_value, auto_sold } ]
```
- `players` becomes a list of objects (was wallet strings). `eliminated_round`/`accumulated_value` come from `BattlePlayer`; for Pack Battle they are `null`/`0.0` (no elimination). The existing `get_battle` tests that assert the old `players` shape are updated.
- `rounds` is read from `BattleRound` (ordered by `round_number`); `client_seed` is NOT included here (it belongs to `/verify`).
- **Secrecy:** `pulls` (the NFT recap) is included **only when `status == "settled"`**. Pre-settle the response carries no NFT/card data — only the round/elimination/accumulated-value structure (the royale's public spectacle). `accumulated_value` is a number (a score), not a card identity.

## `GET /pack-battles/{id}/verify` (`main.py` + `pack_lobby.verification`)
`verification(session, battle)` (gains `session` to read rounds) returns:
```
mode,
server_seed_hash,                 # always
server_seed,                      # post-settle only (else null)
commit_ok,                        # post-settle: verify_commit(server_seed, server_seed_hash); else null
# pack:
client_seed, tie_break_index,     # the single winner tie-break draw (null if no tie)
# royale:
rounds: [ { round_number, client_seed, eliminated_wallet, tie_break_index } ]
```
- Endpoint `GET /pack-battles/{id}/verify` → `404` if the battle does not exist, else the `verification(...)` payload. No auth needed (it is public audit data; the seed is only revealed post-settle).
- Lets anyone replay each royale elimination: `pick_index(server_seed, round.client_seed, n_tied) == round.tie_break_index` (when a tie occurred), and confirm `commit_ok`.

## Error handling
- `get_battle` / `/verify` on a missing battle → `LobbyError` → HTTP 404 (existing pattern).
- No on-chain or Privy I/O — pure DB reads; no new failure modes.

## Testing
- `get_battle` (unit, in-memory DB): a royale with rounds + an eliminated player → `players` carries `eliminated_round`/`accumulated_value`, `rounds` carries the audit, `creator_wallet` present; pre-settle → no `pulls` key (or empty) and no NFT data; post-settle → `pulls` recap present + seeds revealed. Pack battle → `players` with null elimination, `rounds == []`.
- `verification(session, battle)` (unit): pre-settle → `server_seed`/`commit_ok` null, `server_seed_hash` present; post-settle pack → `client_seed`/`tie_break_index` + `commit_ok` true for a valid commit; post-settle royale → `rounds` with per-round `client_seed`/`tie_break_index`.
- `GET /pack-battles/{id}/verify` (API, TestClient): 404 on missing; 200 with the proof; seed hidden pre-settle, revealed post-settle.

## No-goals
- Any frontend (that is #4b/#4c/#4d). Exposing individual NFTs pre-settle (secrecy). Auth on `/verify` (public audit data). Changing the engines or the PF algorithm.
