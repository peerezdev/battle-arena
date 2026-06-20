# Pack Battle (operator-orchestrated) — architecture & decomposition

Date: 2026-06-20
Status: approved-pending-review · TOP-LEVEL design (decomposes into sub-projects)

## Goal

A multiplayer PvP gacha tournament: one player creates a battle for **up to 10 players** on a chosen
gacha machine. Each joiner pays the machine's USDC price (their pull). When the lobby fills, **every
player pulls once**; the pull with the **highest `insuredValue` wins**, and the winner receives **all
the cards** — choosing per card whether to **keep** it or **sell it back (buyback) for USDC** — plus
the buyback USDC of every auto-sold / unwanted card. **Losers never receive or interact with their
pulled NFT** at any point.

## Architecture decision (from brainstorming)

**Operator-orchestrated, via Privy delegated signing** — NOT on-chain trustless. The backend
orchestrates the whole battle server-side. Reasons CC's API forces this (vs trustless on-chain):
- CC's turbo auto-sell buyback USDC goes to the payer and is **not redirectable** (no param on
  `openPack`) → "buyback to the winner" is impossible to do at the CC layer.
- CC's NFT-delivery redirect (`altPlayerAddress`) targeting a program **PDA** is undocumented/unverified.
- This is how the comparable product (CollectorRoll) works: operator-controlled wallets, the user
  never signs anything, the operator routes assets to the winner.

**Verified capability** (the linchpin): Privy supports **server-side delegated signing for Solana
embedded wallets** — the user delegates once (`delegateWallet` / `useDelegatedActions`), then the
backend signs & sends Solana transactions on their behalf via Privy's **REST API**, even while the
user is offline. (Privy: server-sessions / user-and-server signers.)

**Trust model:** trusted-operator during a battle. Players trust the backend to run the pulls,
determine the winner (highest `insuredValue`), and settle to the winner. CC controls the RNG and the
`insuredValue` (the operator cannot rig the *outcome*); the custody/payout during the battle is the
trusted part. On-chain trustless settlement is an explicit **future evolution** (the existing 2-player
Anchor `PackBattle` program is left in place, unused by this model, as the seed for that later path).

## Verified / assumed CC + Privy facts
- `altPlayerAddress` on `generatePack`/`generateYoloPacks`: the won NFT is delivered to that address
  **instead of** the payer's wallet (payer still pays). Documented for a **wallet** destination.
- Devnet is **keyless** in practice (confirmed empirically all session), despite docs implying a key.
- `open_pack` already returns `insured_value`, `grade`, `auto_sold`, `buyback_amount`.
- `/gacha/buyback` sells a won NFT back for USDC (owner signs); the escrow is a backend wallet → the
  backend signs the buyback.

## Asset & money flows
1. **Create**: creator picks a machine + `max_players` (2–10). Battle starts in a `lobby` state.
2. **Join**: each joiner must (a) have delegated signing to the app, and (b) hold ≥ machine price in
   their embedded USDC. Joining reserves their slot. (USDC isn't moved yet — it's spent at pull time.)
3. **Fill → run** (backend orchestration, server-side, no user signing):
   - The battle has a dedicated **escrow wallet** the backend controls.
   - For each player: backend signs (delegated) a **pull** funded by the player, with
     `altPlayerAddress = escrow` → the NFT lands in the escrow, never in the player's wallet.
   - Backend `open_pack`s each → records each pull's `insured_value`/`grade`/mint.
4. **Winner** = max `insured_value` (tiebreak `grade`, then earliest join). All pulled NFTs sit in escrow.
5. **Settle** (backend, controlling escrow): present the winner a per-card **keep / sell** choice.
   - **Keep** → transfer NFT escrow → winner.
   - **Sell** (and every card the winner doesn't keep) → CC **buyback** from escrow → USDC to winner.
   - Losers receive nothing; their NFTs were never theirs.

## Sub-project decomposition (each gets its own spec → plan → build; built in order)
1. **Delegated-signing infra** (foundational): client one-time delegation consent
   (`useDelegatedActions`/`delegateWallet`) + backend Privy REST integration to sign & send Solana
   transactions for a delegated wallet. Includes a thin Python Privy "server-signer" client.
   Interface produced: `privy_sign_and_send(wallet, tx) -> signature` (backend) + a client hook that
   ensures the user is delegated.
2. **Escrow + orchestration engine** (backend): per-battle escrow wallet lifecycle; the round engine
   (delegated pull with `altPlayerAddress=escrow` → openPack → determine winner → settle: transfer or
   buyback to winner). Consumes #1. Interface: `run_battle(battle) -> results`.
3. **Lobby / state / anti-cheat** (backend): create/list/join endpoints; `PackBattle` + per-player
   entry models; fill detection; state machine (`lobby → running → settling → settled`); one-pull-per-
   player registry (anti pull-shopping, reusing the `GachaPack` memo registry per (battle, player));
   USDC gating. Drives #2.
4. **Frontend**: lobby (create/join/list), the delegation-consent prompt, the live battle view
   (waiting → pulling → reveal of all pulls → winner + the winner's keep/sell choices), result screens
   for winner and losers. Consumes #3.

## Trust / security
- `PRIVY_APP_SECRET` + the Privy **authorization/quorum key** live ONLY in the backend; never shipped.
- The escrow wallet's key is backend-controlled (a dedicated server wallet per battle, or a managed
  Privy server wallet). Never exposed.
- Delegation is **user-granted and revocable**; scope it to the minimum needed; the consent screen
  makes the trust explicit. The backend uses it only for the battle's pull + escrow settlement.
- Anti-cheat: exactly **one pull per (battle, player)**, executed by the backend (the player can't
  pull on their own for the battle, so no pull-shopping); winner is deterministic from CC's
  `insured_value`; all pulls/settlements logged with CC memos + tx signatures.
- The operator cannot influence the pull outcome (CC RNG) or the `insured_value` (CC) — only custody
  during the battle is trusted.

## Error handling / edge cases
- A joiner lacks USDC or hasn't delegated → can't join (gated at join).
- A pull fails mid-round → the backend retries; if a slot can't pull, the battle voids and refunds
  (nobody paid except via the pull tx itself, which only charges on success).
- Player revokes delegation before the run → treated as a no-show; battle voids/refills per policy
  (decided in sub-project #3).
- Abandonment is structurally impossible: the backend (not the player) executes the pulls, and NFTs
  go straight to escrow — a loser never holds a card to abandon.

## Open verifications (gating sub-projects #1–#2; user-approved)
- **CC delivery test (devnet, costs USDC):** a real pull with `altPlayerAddress` = a backend wallet,
  confirming the NFT arrives there and not in the payer's wallet.
- **Privy delegation e2e:** delegate an embedded Solana wallet → backend signs & sends a trivial
  Solana tx for it via the REST API.
These run at the start of sub-project #1; a negative result reopens the architecture decision.

## Testing approach (per sub-project)
- #1: unit-test the Privy REST client (mocked HTTP); a manual devnet e2e for real delegation.
- #2: unit-test the round engine with a mock gacha/escrow; a devnet integration once #1 is verified.
- #3: pytest the lobby/state/registry endpoints (FastAPI TestClient), incl. anti-cheat + gating.
- #4: vitest pure helpers + tsc/build; manual eyeball on the tunnel.

## No-goals (for this model)
- On-chain trustless N-player settlement (future evolution; the 2-player Anchor program stays as the seed).
- Using CC's turbo for the battle (the backend does the buyback from escrow instead).
- ELO/ranking for Pack Battle (later).
- Spectators, chat-in-battle, rematch (later).

## Next step
Brainstorm **sub-project #1 (delegated-signing infra)** in detail → its own spec → plan → build,
starting with the two open verifications above.
