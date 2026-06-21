# Turbo settle + MPL Core transfer — design

Date: 2026-06-22
Status: approved-pending-review
Parent: Pack Battle engine (`2026-06-20-pack-battle-orchestration-engine-design.md`), Battle Royale (`2026-06-21-battle-royale-engine-design.md`), NFT transfer layer.
Depends on: engines + transfer dispatcher + lobby + Provably-Fair (all merged).

## Goal
Make the two battle modes settle correctly for **every card the gacha actually delivers**:
- Pull in **turbo** so CC auto-sells commons to USDC (no manual buyback by us).
- Transfer the **non-common** cards (including **MPL Core**, previously unsupported) to the winner.
- Hand the winner the escrow's accumulated USDC (the auto-sold commons + any pool remainder).
- Settle **resiliently**: retry transient failures, flag a genuinely-unsupported card, never void after the winner is decided.

This removes the last hard blocker (MPL Core ≈16% of the mainnet pool) and realises the "turbo" product vision (commons liquidated, good cards kept) using CC's native mechanism.

## Confirmed live on devnet (this is not speculative)
- `POST /api/generatePack` **accepts a `turbo` flag** (not only the YOLO endpoint) alongside `altPlayerAddress`.
- In turbo, a **common** → CC auto-sells it (`openPack` returns `code=TURBO_MODE_BUYBACK`, `auto_sold=True`, `buyback_amount` ≈ 85% of insured) and **pays the USDC to the `altPlayerAddress` (the escrow)** — verified: escrow `+42.5` USDC on a $50 common.
- A **non-common** → the NFT is delivered to the escrow (verified: an Epic $500 landed in the escrow).
- `openPack` returns `insured_value` in **both** cases (50.0 / 500.0) → winner + royale elimination math is unaffected by the auto-sell.
- **MPL Core transfer** is a `TransferV1`, validated by simulating against a real CC Core card (`err:None`, "Instruction: Transfer success").

## Critical prerequisite — escrow USDC ATA must exist before turbo pulls
CC's auto-buyback payout tx does `CreateIdempotent(escrow USDC ATA)` + transfer + a **Memo**. If the escrow's USDC ATA does **not** exist, the CreateIdempotent consumes ~19.5k CU of CC's fixed compute budget and the **Memo runs out of CU → the whole payout reverts** (`ProgramFailedToComplete`) → the USDC is **not** delivered. Verified failure, then verified fixed by pre-creating the ATA (payout then landed).

- **Battle Royale**: the escrow's USDC ATA already exists (buy-ins are collected into it) → no change needed.
- **Pack Battle**: `prepare_escrow` must **pre-create the escrow's USDC ATA** (CreateIdempotent, escrow is payer/signer, escrow has SOL) before any pull.

## Pull flow change (both engines)

### `GachaService.generate_pack`
Add an optional `turbo: bool = False` parameter; when true, include `"turbo": True` in the `/api/generatePack` body. The solo-gacha flow keeps `turbo=False` (the user chooses keep/buyback) — **turbo is only for battles**.

### In `run_battle` (pack_engine) and `run_royale` (royale_engine)
Call `gacha.generate_pack(..., turbo=True)`. After `open_pack` resolves a pull:
- Always persist `insured_value`, `grade`, `rarity` (Royale currently does **not** persist `rarity` — fix), and record `insured_value` into the winner/elimination accumulation **exactly as today** (the value is returned even for auto-sold commons).
- If `res["auto_sold"]` is true (a common CC liquidated): set `BattlePull.auto_sold = True`, store `BattlePull.nft_address = res["nft_address"]` for audit, and **do not** add it to the set of cards to transfer at settle. The USDC is already in the escrow.
- Else (non-common): store `nft_address`; it will be transferred to the winner at settle.

`insured_value` (not `buyback_amount`) remains the ranking metric for both the Pack Battle winner and the Royale elimination.

## MPL Core transfer (`nft_transfer.py`)
Add `build_core_transfer(escrow, winner, mint, blockhash, *, collection: str | None)`:
- Program `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d`, instruction `TransferV1`, data `bytes([14, 0])` (discriminator 14 + `compression_proof` None).
- 7 accounts, in order, with the mpl-core convention "optional None account → pass the CoRE program id":
  0. `asset` (mint) — writable
  1. `collection` — writable if the asset is in a collection, else CoRE program id (not writable)
  2. `payer` = escrow — signer, writable
  3. `authority` = escrow (the owner) — signer
  4. `new_owner` = winner
  5. `system_program`
  6. `log_wrapper` = CoRE program id (None)
- Prepend a ComputeBudget SetComputeUnitLimit ix (mirror `build_pnft_transfer`).

Add `read_core_collection(data: bytes) -> str | None`: parse the MPL Core `AssetV1` account — `key (1)`, `owner (32)`, then `update_authority` enum: variant byte `2 == Collection` → next 32 bytes are the collection pubkey; variants `0/1` → no collection. Guard with try/except → None (no collection).

Extend the `build_transfer` dispatcher: for `std == "core"`, read the asset account, `collection = read_core_collection(...)`, return `build_core_transfer(..., collection=collection)`. `detect_standard` already returns `"core"`. cNFT/unknown still raise `UnsupportedNftStandard`.

## Settle (both engines) — resilient, non-commons + USDC → winner

Replace the current "transfer every NFT, void on any exception" settle with:

1. Determine the winner (unchanged: Provably-Fair on `insured_value`).
2. **Transfer non-common cards:** for each `BattlePull` with `auto_sold == False` and a non-null `nft_address`:
   - `_wait_in_escrow(...)` (the NFT lands asynchronously), then build → sign(escrow) → submit, **with bounded retries** (3 attempts, `sleep_fn(delay)` between) on transient failure.
   - On success: set `BattlePull.transferred = True`.
   - If `build_transfer` raises `UnsupportedNftStandard` (only cNFT/unknown — not in the pool) or all retries are exhausted: leave `transferred = False`, `logger.warning(...)` (no secrets: battle id + mint + error), and **continue** — do not void. A `settled` battle with any `transferred == False, auto_sold == False` pull is the ops-queryable "stuck card" flag.
3. **Transfer accumulated USDC:** call the injected `pay_usdc_to_winner(escrow_address, winner)` hook, which reads the escrow's USDC balance and, if `> 0`, transfers the full balance escrow→winner (escrow = sole signer/fee-payer) and returns the signature (or `None` if the balance is 0). Failure here is retried (3 attempts) then logged; it does **not** void a decided battle.
4. Mark `winner`, `status="settled"`, `settled_at`. The battle is settled even if a card was flagged (the winner got everything transferable + all the USDC).

**Never void after the winner is determined.** Voids remain only for pre-winner failures (pull/distribution/seed), where `_void_return` still applies.

## Void (this sub-project: best-effort; full refund → #3c)
`_void_return` must **skip auto-sold pulls** (no NFT to return) and return only the non-common NFTs still in the escrow. The USDC from auto-sold commons stays in the escrow; **refunding it to the affected players (and who absorbs CC's ~15% cut) is deferred to #3c/refunds** and is explicitly out of scope here. Voids are rare (most failures are caught pre-charge in the pre-flight).

## Models (`models.py`)
- `BattlePull`: add `auto_sold` (Boolean, default `False`) and `transferred` (Boolean, default `False`).
- No other schema change. (`rarity` already exists on `BattlePull`; the fix is that `run_royale` must *populate* it.)

## Engine I/O (injected, mockable)
Both `run_battle` and `run_royale` gain one injected hook:
- `pay_usdc_to_winner(escrow_address, winner_address) -> str | None` — reads the escrow USDC balance and sweeps the full amount to the winner (escrow sole signer/fee-payer); returns the signature or `None` if the balance is 0.

The wiring (`pack_orchestration.py`) implements it with a fresh-blockhash closure over `build_token_transfer` (escrow→winner, decimals=6) + a balance read + `submit_signed_tx`. `prepare_escrow` for Pack Battle additionally issues the **CreateIdempotent** for the escrow USDC ATA (escrow payer/signer) before returning.

## Testing
Unit (mocked I/O, no live calls):
- `generate_pack(turbo=True)` includes `"turbo": True` in the body; `turbo=False` (default) does not.
- Pull loop: an `auto_sold` result sets `BattlePull.auto_sold=True`, is excluded from the settle-transfer set, but **still** contributes its `insured_value` to winner/elimination.
- `build_core_transfer`: decode the tx → assert program, data `[14,0]`, the 7 accounts in order, collection-present vs collection-None (CoRE id) cases, signer/writable flags. `read_core_collection`: variant 2 → pubkey; variant 0/1 → None; truncated → None.
- `build_transfer` dispatcher routes `"core"` → `build_core_transfer` with the on-chain collection (mock `_get_account`).
- Settle: transfers only non-auto-sold NFTs (sets `transferred=True`) and calls `pay_usdc_to_winner`; a transient transfer failure retries (3×) then leaves `transferred=False` and continues (does not void); a settled battle with a `transferred=False` non-auto-sold pull is still `settled` (stuck-card flag). `pay_usdc_to_winner` returning `None` (0 balance) is fine.
- `prepare_escrow` (pack) issues the CreateIdempotent for the escrow USDC ATA.
- Royale: `run_royale` persists `rarity`; settle transfers non-commons + USDC.

Live (already proven; scripts kept for regression): `scripts/verify_turbo_pull.py` (turbo auto-sell → escrow), `scripts/verify_pnft_transfer.py` (pNFT transfer). A combined live battle run is gated separately (needs devnet USDC + SOL).

## No-goals
- Manual buyback by us (CC's turbo does it).
- cNFT transfer (0% of the pool; `UnsupportedNftStandard` + flag if one ever appears).
- #3c reserved balance; void USDC refund policy; UI (#4); Helius RPC adoption (Core needs no DAS).
- Perfect partial-tournament unwind.
