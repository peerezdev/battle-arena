# BattleArena — Games on top of Collector Crypt graded NFTs

**Skill-based PvP where Collector Crypt graded cards are the stakes, and every
match drives pack sales and buybacks back to Collector Crypt.**

We're a small team building a games layer on top of CC's tokenized graded cards.
Players use their CC NFTs as the playing piece; a card's `insuredValue` (never
listing price — same anti-manipulation stance as CC) sets a capped advantage, so
better cards matter without pay-to-win. Settlement is trustless on Solana — an
on-chain escrow + commit-reveal program, with an ed25519 oracle attesting card
value, bound per-battle to prevent replay.

## What we've already built (devnet)

- **Anchor program** — USDC escrow + commit-reveal + deterministic resolution +
  settlement, validated with in-process tests; ed25519 oracle attestation
  (mint‖value‖grade‖ts‖battle, 81 bytes) bound to each battle.
- **Oracle service** — signs attestations using **only `insuredValue`** from CC
  (anti-manipulation), with HTTPS enforcement and rate limiting.
- **Backend + frontend** — wallet auth, open-challenge lobby, full on-chain flow
  on devnet (Reown/WalletConnect), plus a polished battle UI.
- **Gacha integration (done)** — a server-side proxy already targeting
  `dev-gacha.collectorcrypt.com` (`/api/machines`, `/api/generatePack`,
  `/api/submitTransaction`, `/api/openPack`). The API key lives only on our
  backend; players open packs in-app today. It's gated on a devnet key — that's
  our ask below.

## Three games, one funnel

1. **Blotto duel** — hidden-reserve mana allocation across three fronts,
   commit-reveal, best-of-3. Pure skill; card value gives a small capped edge.
2. **Pack opener (Gacha)** — open CC packs in-app, then jump straight into a
   battle with the pulled card.
3. **Pack Battle** *(the volume driver)* — two players each open a pack of the
   same tier; **winner takes both cards**. Resolution is the creator's choice:
   *Direct* (higher `insuredValue` wins) or *Mana Duel* (play a Blotto match with
   the freshly-pulled cards — card value only feeds the mana edge, skill decides).
   The pulled NFT is delivered **straight into the battle's escrow PDA** (via
   `altRecipient`), so it never sits in a player's wallet and can't be pulled out
   before settlement.

## Why this is good for Collector Crypt

Every **Pack Battle** is, as a direct effect of playing:

- **2 pack sales** to CC (the tier price ×2).
- A **buyback opportunity** — winners can sell won cards back to CC (more volume).
- A showcase for **CC's VRF** as the verifiable, tamper-proof arbiter of the game.

Three revenue hooks for CC in a single game mode, wrapped in a trustless,
skill-forward product that fits the platform's narrative — not a casino.

## The ask

A **devnet Gacha API key** so we can validate two assumptions that the
winner-takes-cards design rests on:

1. A pull can be **delivered to a program-owned PDA token account** via
   `altRecipient`/`altPlayerAddress` (so the prize is escrowed trustlessly).
2. CC gacha NFTs are **freely transferable** (not frozen / no transfer-hooks that
   block the escrow CPI).

We build on your reference stack (Privy embedded wallets, per the `gacha-starter`
demo) and keep the API key strictly server-side. With the devnet key we can
demo the full loop end-to-end; a production key follows once validated.

---

*Contact: mauropfdev@gmail.com · Built on Solana devnet · Happy to walk through
the code and a live demo.*
