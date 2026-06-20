# Pack Battle · Sub-project #2 — Escrow + orchestration engine (design)

Date: 2026-06-20
Status: approved-pending-review
Parent: `2026-06-20-pack-battle-orchestrated-design.md`
Depends on: #1 delegated-signing infra (PrivySigner + key quorum + session signers — **verified**)

## Goal

The backend engine that runs a **filled** battle server-side: each player pulls once (paid by them,
NFT delivered to a per-battle escrow they never see), the highest `insured_value` wins, and **all the
escrow's NFTs are transferred to the winner**. Same engine serves **Pack Battle and Battle Royale**
(parameterized by `max_players`). No user signing — everything via the verified delegated-signing path.

## Decisions (from brainstorming)
- **One escrow Privy server wallet per battle** (owned by our key quorum, backend-controlled). Created
  when the battle starts running. Everything in escrow X belongs to battle X → no cross-battle ambiguity.
- Pulls use **`altPlayerAddress = escrow`** → the NFT goes straight to the escrow; the player never
  holds it (so it never shows in their Profile). Losers never receive anything.
- **Non-turbo** → escrow holds only NFTs (no auto-sold USDC). Winner gets all NFTs; selling unwanted
  ones is a post-settlement winner action (UI in #4).
- Winner = max `insured_value` (tiebreak `grade`, then earliest join).
- **Gas sponsorship via Privy** (`sponsor: true`) on the txs we broadcast → players need only USDC, no SOL.
  Dependency: a Privy **gas tank** configured in the dashboard (user sets it up, like the auth key).
- **Abandonment = void, no charge:** if at run time a player can't pull (revoked the session signer,
  or insufficient USDC), the battle voids without charging anyone (pulls never executed) and players
  return to the lobby.
- This sub-project is **backend only** (engine + escrow + settlement). Lobby/endpoints = #3; UI = #4.

## New models (`backend/app/models.py`) — separate from the on-chain `Match`
- `PackBattle`: `id` (PK), `mode` ("pack"|"royale"), `machine_code`, `price` (int USDC base units),
  `max_players` (int), `status` ("lobby"|"running"|"settled"|"voided"), `winner` (wallet, nullable),
  `escrow_wallet_id` (Privy wallet id, nullable), `escrow_address` (nullable), `created_at`, `settled_at`.
- `BattlePlayer`: `battle_id` (FK), `player_wallet`, `joined_at` (order = tiebreak).
- `BattlePull`: `battle_id` (FK), `player_wallet`, `memo`, `nft_address` (nullable until opened),
  `insured_value` (nullable), `grade` (nullable), `rarity` (nullable). One row per (battle, player) —
  the anti-pull-shopping registry (exactly one pull per player, executed by the backend).

## Escrow lifecycle (Privy server wallet)
- **Create** at run start: `POST https://api.privy.io/v1/wallets` (Basic + `privy-authorization-signature`)
  with `chain_type: "solana"` and the owner set to our **key quorum** → returns `{ id, address }`. Store
  on the `PackBattle`. (Exact owner/body fields pinned at impl from the Privy wallets API.)
- **Receives** all N pulled NFTs (via `altPlayerAddress = escrow_address`).
- **Settle**: the backend (key-quorum signer) transfers every escrow-held NFT → the winner's wallet.
- After settle the escrow is empty and abandoned (one per battle; not reused).

## Engine — `backend/app/services/pack_engine.py` :: `run_battle(battle, players) -> result`
Runs when a battle fills (driven by #3). All on-chain actions via `PrivySigner` with `sponsor=True`.
1. `status = running`; create the escrow server wallet → store `escrow_wallet_id/address`.
2. **Pull, per player (sequential)** — re-check the player is still a session-signer + has ≥ price USDC;
   if any fails → **void** (set `voided`, nothing charged) and return.
   - `generate_pack(player_wallet, machine_code, altPlayerAddress=escrow_address)` (extend the gacha
     service to pass `altPlayerAddress`) → `{memo, transaction}`; store the `BattlePull(memo)`.
   - `PrivySigner.sign_and_send_solana(player_wallet_id, transaction, sponsor=True)` → the player pays
     USDC, Privy sponsors the SOL fee, the NFT is delivered to the escrow.
3. **Open, per memo:** `open_pack(memo)` (poll) → record `nft_address/insured_value/grade/rarity` on the
   `BattlePull`.
4. **Winner** = max `insured_value` (tiebreak `grade`, then earliest `joined_at`). Store `winner`.
5. **Settle:** for each opened `nft_address`, build an SPL-token transfer (escrow ATA → winner ATA,
   amount 1, creating the winner ATA if needed), fee payer = escrow, and
   `PrivySigner.sign_and_send_solana(escrow_wallet_id, transfer_tx, sponsor=True)`. Mark `settled`.
   (Built with `solders`; one transfer per NFT, or batched into one tx.)

## Backend changes to existing code
- `GachaService.generate_pack` (+ `generate_yolo_packs`): accept an optional `alt_player_address` and
  forward it to CC as `altPlayerAddress`. (Single-pack default stays `None` → unchanged behavior.)
- `PrivySigner.sign_and_send_solana(..., sponsor: bool = False)`: add the `sponsor` field to the RPC body.
- `PrivySigner`: add `create_solana_wallet() -> {id, address}` (the escrow server wallet) + a helper to
  resolve a player's wallet id (reuse `PrivyVerifier.embedded_solana_wallet_id`, or the Privy users API).

## Anti-cheat / integrity
- Exactly **one pull per (battle, player)**, executed by the backend (the player can't pull on their own
  for the battle) — the `BattlePull` row enforces it. No pull-shopping.
- The winner is deterministic from CC's `insured_value`; the operator can't bias the RNG (CC) or the value.
- All pulls/settlements logged with CC memos + tx signatures.

## Error handling / edge cases
- A pull's sign/submit fails mid-run → **void** the battle (mark `voided`); already-submitted pulls (if
  any) are a rare partial — the escrow keeps those NFTs; a `void` settlement returns each pulled NFT to
  its original puller (so nobody is robbed) and refunds nothing (USDC only moved on a successful pull).
- A pull stays pending after polling → retry; if it can't open, `void` with return-to-puller.
- escrow-wallet create fails → `void` before any pull (nothing charged).
- Gas-tank empty / sponsorship fails → surface a clear error; battle `voided`; (ops: refill the tank).

## Dependencies / open verifications (carried)
- **Privy gas tank** configured in the dashboard (user; like the auth key).
- **CC delivery test** (#1 Task 4 Step 2): a real pull with `altPlayerAddress = escrow` confirms the NFT
  lands in the escrow, AND that a **Privy-sponsored broadcast** of CC's pull tx still lets `openPack(memo)`
  resolve. Run before/at the start of #2.

## Testing
- pytest with a **mock gacha** + a **mock PrivySigner** (no live calls): the engine state machine
  (running→settled / →voided), winner determination (value, grade, join-order tiebreaks), one-pull-per-
  player, void-and-return-to-puller on failure. A devnet integration once the CC delivery test passes.

## No-goals (this sub-project)
- Lobby/create/join endpoints + matchmaking (#3); the battle UI + winner keep/sell (#4); on-chain
  trustless settlement (future); turbo/auto-sell (we transfer NFTs, winner sells later); ELO for battles.
