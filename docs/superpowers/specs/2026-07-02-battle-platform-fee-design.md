# Battle Platform Fee — Design

**Date:** 2026-07-02
**Status:** Approved (design)
**Area:** Backend — settle path of Pack Battle & Battle Royale (`pack_engine.py` / `royale_engine.py` wiring, `config.py`, `models.py`). No frontend changes.

## Goal

Charge a platform fee on every settled Pack Battle and Battle Royale. The fee is a
percentage of the **buyback value of the winner's loot**, scales with the number of players,
and is collected in USDC from the winner's wallet after the pot is paid out.

## Non-goals

- No UI changes: the fee is silent for now; it will be disclosed in the site docs.
- No change to the existing settle flow (NFT transfers + full escrow USDC sweep to the
  winner — the escrow still ends empty).
- No change to Gimmighoul loyalty awards (they remain based on buy-in).
- Gacha (solo pulls) is out of scope — battles only.

## Decisions (locked)

- **Fee base:** theoretical buyback value of the winner's entire loot, per card and per pack
  (the user's example: $100 card from the $50 pack at 85% + $200 card from the $250 pack at
  90% → base $265).
- **Collection:** from the **winner's wallet** after the escrow sweep, via their Privy
  session signer (same mechanism as join/pull). If the winner's balance doesn't cover the
  full fee, charge whatever balance there is.
- **Destination:** a dedicated, configurable fee wallet; falls back to the operator wallet.
- **Scaling:** `rate × n_players`, capped by a configurable maximum.
- **Failure mode (accepted):** if the fee transfer cannot be signed/submitted after retries,
  the battle still settles normally, the fee goes uncollected for that battle, and an
  `ERROR` is logged. The settle is never blocked or voided by fee collection.

## Formula

```
per-card value:
  auto-sold card   → its real buyback_amount (already USDC base units)
  kept-as-NFT card → insured_value × instantBuyback% of the pack it was pulled from

base      = Σ per-card value over ALL pulls of the battle (winner takes all loot)
pct_total = min(battle_fee_pct_per_player × n_players, battle_fee_pct_cap)
fee       = round(base × pct_total)          # USDC base units
charged   = min(fee, winner_usdc_balance)    # never overdraft the winner
```

- `n_players` = the players in the battle (`max_players`; battles only run full).
- `instantBuyback` per machine comes from the CC machines API at settle time, mapped by each
  `BattlePack.machine_code` (legacy battles → the battle's single `machine_code`). Insured
  values are dollars → convert to base units (×1e6) before summing with `buyback_amount`.
- If a machine doesn't expose `instantBuyback`, its kept-as-NFT cards contribute 0 to the
  base (logged); auto-sold cards always contribute their real amount.
- Both modes use the same rule; a royale's larger `n` simply hits the cap sooner.
- Voided battles: no fee.

## Configuration (`config.py`, all overridable via env)

```python
battle_fee_pct_per_player: float = 0.005   # 0.5% per player; env BATTLE_FEE_PCT_PER_PLAYER
battle_fee_pct_cap: float = 0.03           # total-% ceiling (3%); env BATTLE_FEE_PCT_CAP
fee_wallet_address: str = ""               # env FEE_WALLET_ADDRESS; empty → privy_operator_address
```

Setting `battle_fee_pct_per_player = 0` (or an empty resolved fee wallet **and** empty
operator) disables collection cleanly — kill-switch semantics like `gacha_base_url`.

## Collection step (`collect_battle_fee`)

A new post-settle step, invoked from both wirings (pack and royale) right after
`settle_cards_to_winner` returns and before the battle is marked settled/committed:

1. Skip if `battle.fee_charged` is already true (idempotency — settle paths can be retried),
   or if the computed fee is 0.
2. Read the winner's USDC balance; `charged = min(fee, balance)`. If `charged == 0`, mark
   `fee_charged = True` with `fee_base_units = 0` and log the shortfall.
3. Build a USDC transfer winner → fee wallet for `charged`, sign with the **winner's**
   session signer (`resolve_wallet_id(winner)`), operator pays gas (`fee_payer`), submit via
   our RPC. Retry up to 3 attempts (same pattern as the sweep).
4. On success: persist `fee_base_units = charged`, `fee_pct = pct_total`,
   `fee_charged = True`. On exhausted retries: leave `fee_charged = False`, log `ERROR`
   (money-loss path — same convention as refund retries), and continue settling.
5. Never raises; the caller's settle result is unaffected.

Timing note: charging immediately after the sweep maximizes the chance the winner's balance
covers the fee (the pot has just landed) and minimizes the withdraw-before-fee window.

## Persistence (`models.py` + `_ENSURE_COLUMNS`)

New `PackBattle` columns (idempotent SQLite migration, like `gimmighouls_awarded`):

- `fee_base_units: int | None` — the amount actually charged, USDC base units.
- `fee_pct: float | None` — the total percentage applied (post-cap).
- `fee_charged: bool = False` — idempotency flag.

## Failure handling

- Machines API unavailable at settle → kept-as-NFT cards contribute 0 (logged warning);
  auto-sold amounts still counted. Fee still charged on the reduced base.
- Winner signer fails / transfer fails after retries → settled without fee + `ERROR` log.
- Partial charge (balance < fee) is recorded as what was actually charged, with a warning
  log including the shortfall.

## Testing (backend, pytest)

- **Formula:** multi-pack bundle reproducing the user's example (85%/90% → $265 base);
  cap kicks in (`min` branch); machine without `instantBuyback` (NFT cards drop out,
  auto-sold stay); mixed auto-sold + kept cards (real `buyback_amount` + insured×pct).
- **Collection:** full charge; insufficient balance charges only the balance and logs;
  zero balance marks charged with 0.
- **Idempotency:** second invocation with `fee_charged=True` is a no-op (no double
  transfer).
- **Resilience:** transfer raising on every attempt → battle still settles, `fee_charged`
  stays False, `ERROR` logged.
- **Wiring:** pack and royale settle paths both invoke collection with the right
  `n_players`; voided battles never do.
