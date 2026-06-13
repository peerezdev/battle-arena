# BattleArena — Games on top of Collector Crypt graded NFTs

**Skill-based PvP where Collector Crypt graded cards are the stakes, and every
match drives pack sales and buybacks back to Collector Crypt.**

We're building a games layer on top of CC's tokenized graded cards. Players use
their CC NFTs as the playing piece; a card's `insuredValue` (never listing price
— the value can't be manipulated by the player) sets a *capped* advantage, so
better cards matter without turning it into pay-to-win. Everything settles
trustlessly on Solana, with CC's own data and randomness as the source of truth.

## Three games, one funnel

1. **Blotto duel** — hidden-reserve mana allocation across three fronts, played
   commit-reveal, best-of-3. Pure skill; a card's value only grants a small
   capped edge.
2. **Pack opener** — open CC packs, then jump straight into a battle with the
   pulled card.
3. **Pack Battle** *(the volume driver)* — two players each open a pack of the
   same tier; **the winner takes both cards**. The creator picks how the winner
   is decided:
   - *Direct* — higher `insuredValue` wins. Instant, chance-based.
   - *Mana Duel* — the two freshly-pulled cards are played out in a Blotto match;
     card value only feeds the mana edge, **skill decides the winner**.

   The pulled card is delivered **straight into the battle's on-chain escrow**, so
   it never sits in a player's wallet and can't be pulled out before the result.

## Why this is good for Collector Crypt

Every **Pack Battle** is, as a direct effect of playing:

- **2 pack sales** to CC (the tier price ×2).
- A **buyback opportunity** — winners can sell won cards back to CC (more volume).
- A showcase for **CC's VRF** as the verifiable, tamper-proof arbiter of the game.

Three revenue hooks for CC in a single game mode — wrapped in a trustless,
skill-forward product that fits the platform's narrative, not a casino.

## What we need from you

A **devnet Gacha API key**, so we can validate the two assumptions the
winner-takes-cards design rests on:

1. A pull can be **delivered to a program-owned escrow account** (via
   `altRecipient`/`altPlayerAddress`), so the prize is held trustlessly.
2. CC gacha NFTs are **freely transferable** (not frozen / no transfer-hooks that
   would block the escrow).

We'd build on your reference stack (Privy embedded wallets, per the
`gacha-starter` demo) and keep the API key strictly server-side. A production key
would follow once the loop is validated on devnet.
