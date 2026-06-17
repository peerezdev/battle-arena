# Pack Battle — Implementation Design

**Date:** 2026-06-17
**Status:** approved-pending-review
**Supersedes:** the "spec + mockups only, no product code until the CC API key" gate in
`2026-06-10-pack-battle-design.md`. That document remains the conceptual/pitch design and
the anti-cheat rationale; this one is the buildable implementation spec.

## Purpose

Third game of BattleArena. Two players each open **one Collector Crypt gacha pull**; the
**pulled cards themselves are the stake** (no separate USDC stake), winner takes both. The
creator picks the resolution **mode** when creating the duel:

- **Directo** — higher `insured_value` wins both cards. Pure chance, instant.
- **Duelo de maña** — after both packs open, players play a **Blotto** match (existing
  commit/reveal/resolve engine) with their pulled cards; `insured_value` only feeds the
  **edge** (extra mana, capped), it does not decide the winner. Skill + chance hybrid.

Both modes ship in this cycle.

## Build strategy — real integration + swappable mock

We do **not** wait for the Collector Crypt API key. We build the **real** CC integration
*and* a mock provider behind one interface, so the whole game is playable/testable on devnet
now and flips to real CC by setting an env var.

- **`GachaProvider`** interface (backend) with two implementations:
  - **`CollectorCryptGacha`** — the real API (extends the existing `GachaService`:
    `/api/generatePack`, `/api/submitTransaction`, `/api/openPack`) with the `altRecipient`
    parameter and the battle↔memo↔mint registry. Active when `GACHA_API_KEY` is set.
  - **`MockGacha`** — mints a test NFT (SPL token, supply 1) on devnet with a simulated
    `insured_value` (and rarity/grade) in a deterministic-but-random-per-pull way, delivered
    to the requested `altRecipient` (so it can mint **directly to the escrow PDA**). Active
    when `GACHA_API_KEY` is empty.
  - Selection mirrors the existing `gacha.enabled` check: key present → real; absent → mock.
- Everything else (Anchor escrow, oracle, lobby, frontend, both modes) is provider-agnostic
  and built once.
- When the key arrives: set `GACHA_API_KEY`, run the **validation checklist** (below). No
  other code change to switch providers.

## Architecture (reuses existing infra; adds an NFT-escrow mode)

### On-chain — `onchain/programs/battle_arena/`
A new **Pack Battle** flow whose escrowed asset is an **NFT (SPL token, supply 1)** held in
a token account owned by the battle PDA — not USDC. It mirrors the existing `Battle` account
and instruction set (`initialize`/`join`/`commit`/`reveal`/`resolve_round`/`settle`/
`claim_timeout` in `src/instructions/`).

- **Account**: a `PackBattle` account (or a `mode: Direct | Mana` flag + NFT-vault fields on
  a shared structure). Holds `player_a/b`, `nft_mint_a/b`, the PDA-owned **NFT vault token
  accounts** for each card, `value_usd_a/b`, `grade_a/b`, `oracle`, `mode`, the Blotto state
  (`cfg`, `commit_a/b`, `reveal_a/b`, `banked_a/b`, `wins_a/b`, `round`, `phase`, deadlines),
  `winner`, `bump`s. No `stake`/`stake_mint`/`treasury` USDC fields (the pot is the NFTs).
  *(No rake in v1 — the prize is physical cards; revenue for CC is the pack sales + buyback.)*
- **Deposit**: the pulled NFT arrives in the battle's NFT vault (ATA owned by the PDA) via
  the gacha's `altRecipient` (primary) or the embedded-wallet transfer fallback. The program
  verifies the vault holds exactly 1 token of the expected mint before allowing reveal.
- **Settle — Directo**: the oracle attests each card's `insured_value` (existing 81-byte
  message `mint‖value‖grade‖ts‖battle`, ed25519, reused unchanged). The program compares and
  **transfers both NFTs** (CPI from the PDA-owned vaults using PDA seeds) to the higher value.
  Tiebreak: roll rarity tier → grade → true tie = each reclaims their own card.
- **Settle — Duelo de maña**: reuses `commit`/`reveal`/`resolve_round`/`edge.rs` **unchanged**;
  the attested `insured_value` sets each player's edge (`computeEdge`, +1…+4 capped); the
  Blotto winner gets both NFTs transferred from the vaults.
- **Timeout**: if a player never completes their pull (or abandons the Blotto in maña mode)
  within the window, the other claims and takes the escrowed cards; the duel closes
  (mirrors existing `claim_timeout`).

### Oracle — `oracle/`
Reuses `/attest` (insured_value bound to the battle, 81-byte canonical message). No change
for the mock path. When the real key lands, it gains an optional check that the attested
`mint` came from that battle/wallet's gacha `memo` (via `openPack`).

### Backend — `backend/`
- `GachaProvider` interface + `CollectorCryptGacha` (real) + `MockGacha`, selected by
  `GACHA_API_KEY` presence. `generate_pack` gains an `alt_recipient` param.
- **Battle↔memo↔mint registry** (new table, e.g. `PackBattleEntry`): exactly **one memo per
  (battle, player)**; the recorded `memo` is the only one the oracle/settle will accept for
  that player → no pull-shopping. Reuses the existing `GachaPack` memo-ownership pattern.
- **Pack Battle lobby** endpoints (no ELO; filter by pack tier): create duel (tier + mode),
  list open duels, join. Authenticated via the existing `current_user` (Privy identity token
  → embedded Solana wallet), consistent with the rest of the API.

### Frontend — `src/`
- New Pack Battle screens under a `/play/pack` route in the `GameLayout` shell: **create**
  (tier + mode), **lobby** (open duels with pack image, tier, cost, mode badge), **blind
  commit / waiting**, **face-to-face reveal** (rarity + insured_value, winner highlighted),
  and in maña mode a **bridge** into the existing `BattleBoard` (Blotto) with prize = the
  escrowed cards. Reuses `gachaClient.ts` and the existing reveal/clash visual language.
- Pulls are signed from the **Privy embedded wallet** (already the app's wallet).

## Custody model (load-bearing)

The NFT **never touches the player's wallet**: the pull is delivered straight to the battle's
**escrow PDA** via the gacha `altRecipient`. With **MockGacha** this is trivial (we mint
directly to the PDA), so the trustless flow is fully demonstrable now. For real CC this is the
assumption to validate with the key. Fallback if `altRecipient`→PDA is unsupported: open the
pack to the embedded wallet, then transfer the NFT to the escrow in the **same Privy
session-signer flow** (delegated signing, no per-action user prompt), documented as plan B.

## Anti-cheat (carried from the 2026-06-10 design)
- **Can't keep the NFT**: you never hold it; it goes to the escrow PDA.
- **No adverse selection**: you pay/sign the pull *before* the VRF result — randomness is the
  commitment lock.
- **No pull-shopping**: exactly one `memo` per (battle, player); only that memo's card counts.
- **No value manipulation**: `insured_value` is set by CC (mock: by the provider), never the
  player — same anti-manipulation principle as today's oracle.
- **No info leak**: reveal is locked until **both** cards are in escrow.

## Game loop
1. **Create** — A picks pack tier + mode → duel posted to the Pack Battle lobby.
2. **Join** — B accepts that tier+mode. (If nobody joins, A hasn't pulled yet — nothing to
   refund.)
3. **Blind commit** — each player signs+pays their pull from the embedded wallet; the NFT is
   delivered to the escrow PDA (`altRecipient` = PDA). The VRF decides the card after signing.
4. **Reveal** — once both cards are in escrow, reveal face-to-face (rarity + insured_value).
5. **Resolve** — Directo: oracle attests, program transfers both cards to the higher value.
   Maña: edges set from attested values, Blotto best-of-N decides, winner gets both cards.
6. **Settlement** — NFT transfers are CPIs from the escrow PDA with its seeds. Trustless.
7. **Timeout** — incomplete pull / Blotto abandonment → the other claims the escrowed cards.

## Error handling
- Pull/sign failure before escrow → no state change; player retries (still pre-commit).
- One side never deposits → `claim_timeout` after the window; the present player reclaims.
- Oracle stale/invalid attestation → settle rejected (existing `STALE_SECS` + ed25519 checks).
- Mock NFT mint failure → surfaced as a provider error; battle stays pre-reveal.
- Real-provider upstream errors → the existing `GachaUpstreamError` → 502 mapping, never
  leaking the upstream body.

## Testing strategy
- **MockGacha enables full end-to-end on devnet now**: create → both pulls (mock NFTs minted
  to the escrow PDA) → reveal → settle, for both modes.
- **On-chain**: Anchor tests for NFT-vault deposit, Directo settle (value compare + tiebreaks),
  maña settle (reuse existing Blotto test harness with NFT payout), and timeout. Mirror the
  existing `tests/` (`integration.rs`, `settlement.rs`, `rejections.rs`).
- **Backend**: `GachaProvider` selection (key→real, no-key→mock); `MockGacha` mint shape;
  registry enforces one-memo-per-(battle,player); lobby create/join/list; auth required.
- **Frontend**: pure helpers (lobby/duel mapping, mode badge, reveal winner calc) tested with
  vitest; the Blotto bridge reuses the already-tested engine.
- **Real CC**: gated behind the key; covered by the validation checklist, not CI.

## Implementation decomposition (for the plan)
Sequenced so each phase is independently testable; Directo ships before maña:
1. **On-chain NFT escrow + Directo settle** (+ timeout) with Anchor tests.
2. **Backend `GachaProvider` (real + mock) + lobby + battle↔memo↔mint registry** with tests.
3. **Frontend Directo flow** (create/lobby/commit/reveal) against the mock, end-to-end devnet.
4. **Duelo de maña**: on-chain maña settle (reuse Blotto engine) + frontend bridge into
   `BattleBoard`.
5. **Real `CollectorCryptGacha` wiring + validation checklist** (run when the key arrives).

## Validation checklist (run when the CC key is set)
1. `altRecipient`/`altPlayerAddress` can deliver the pull to a PDA-owned token account.
2. Gacha NFTs are freely transferable (no freeze / no Token-2022 transfer-hook blocking the
   escrow CPI).
3. If (1) fails → enable the embedded-wallet session-signer transfer fallback.

## No-goals (YAGNI)
- USDC side-stake (the stake is the cards).
- Mixed tiers within a duel (pay-to-win).
- Negotiating the mode after opening (creator fixes it at creation).
- Matchmaking / ELO in Pack Battle.
- In-app VRF verification, multi-pack (yolo), gifts, rake.

## Risks
- **`altRecipient`→PDA unsupported by real CC** → session-signer fallback; if that also fails,
  the winner-takes-cards model isn't trustless and needs rethinking (e.g. frozen-value +
  automatic buyback instead of transferring the physical card).
- **Non-transferable NFTs** → same rethink.
- **Regulatory**: Directo (pure chance) is gambling-adjacent; maña (skill-based) mitigates it.
  Consider defaulting to maña before mainnet.
- **Mock ≠ real**: the mock can't surface CC-specific quirks (freeze authority, hook,
  altRecipient semantics) — hence the validation checklist before trusting the real path.
```
