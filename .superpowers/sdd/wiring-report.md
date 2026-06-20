# Pack Battle Live Wiring — Implementation Report

## Module Shape

### `app/models.py` (modified)
Added `wallet_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)` to `BattlePlayer`.
Captured at join time; read by `run_pack_battle_live` to build the `resolve_wallet_id` closure.

### `app/services/pack_orchestration.py` (new)
Three public symbols:

```
fetch_latest_blockhash(rpc_url: str) -> str
    POST getLatestBlockhash(finalized) → result.value.blockhash

usdc_balance_base_units(rpc_url, owner_address, usdc_mint, token_program=TOKEN_PROGRAM) -> int
    Derives ATA with solders.token.associated.get_associated_token_address,
    POST getTokenAccountBalance(ata, {commitment:confirmed}).
    Returns int(result.value.amount). Returns 0 on error/missing account/null value.

run_pack_battle_live(session, battle, *, gacha, signer, rpc_url, usdc_mint,
                     min_usdc_base_units, token_program, sponsor) -> str
    1. Query BattlePlayer rows ordered by joined_at; build wallet->wallet_id dict.
    2. await fetch_latest_blockhash() once.
    3. await usdc_balance_base_units() for each player.
    4. Build sync closures (resolve_wallet_id, build_transfer_tx, can_play, now_fn).
    5. return await run_battle(...) with those closures.
```

All I/O (httpx.AsyncClient) is done before the engine runs so the engine's
sync call-sites never block the event loop.

## How the Dual-Method RPC Mock Works

`respx.post(RPC_URL).mock(side_effect=handler)` registers a single route for
all POST calls to the URL. The `handler(request)` callback parses the JSON body
and branches on `body["method"]`:

- `"getLatestBlockhash"` → returns `{"result":{"value":{"blockhash": ...}}}`
- `"getTokenAccountBalance"` → looks up the ATA (`body["params"][0]`) in a
  `balances` dict; returns the amount or an RPC error if the ATA is in
  `missing_atas`

Per-owner balances are keyed by pre-computed ATA addresses (using the same
`solders.token.associated.get_associated_token_address` the production code
uses) so the mock naturally mirrors real RPC behaviour without any mocking of
solders internals.

## Model Change

`BattlePlayer` gained one nullable column `wallet_id String`. Backward
compatible — existing rows get NULL (SQLAlchemy/SQLite adds it with ALTER TABLE
on first migration; in tests the in-memory DB recreates from metadata each run).

## Test Coverage (`tests/test_pack_orchestration.py` — 7 tests)

| # | Test | Covers |
|---|------|--------|
| 1 | `test_fetch_latest_blockhash_returns_blockhash` | RPC call shape, response parse |
| 2 | `test_usdc_balance_base_units_returns_amount` | Happy-path int conversion |
| 3 | `test_usdc_balance_base_units_returns_zero_on_rpc_error` | `"error"` key in response → 0 |
| 4 | `test_usdc_balance_base_units_returns_zero_on_null_value` | `result.value = null` → 0 |
| 5 | `test_run_pack_battle_live_happy_path` | settled, winner, escrow wallet, privy IDs, settle txs are valid 2-instruction Solana txs with fee_payer == ESCROW_ADDRESS, sponsor=False |
| 6 | `test_run_pack_battle_live_void_when_player_underfunded` | balance < min → voided, no escrow, no sign calls |

Plus 1 model test in `tests/test_models.py`:
- `test_battle_player_wallet_id_persists` — round-trips wallet_id (set / None)

## Test Results

```
144 passed, 51 warnings in 1.24s
```
(was 137 before; 7 new tests added)

## Concerns / Deviations

- **Python 3.9 compatibility**: The venv uses Python 3.9, which does not support
  `X | Y` union syntax in runtime annotations. Used `dict` / plain `Optional`
  instead of `dict[str, str | None]` in the service module.

- **No Alembic migration included**: The `wallet_id` column is added to the
  SQLAlchemy model but there is no Alembic migration file. A migration will need
  to be created before deploying against the live DB (`ALTER TABLE battle_players
  ADD COLUMN wallet_id VARCHAR`).

- **Sequential balance fetches**: The `usdc_balance_base_units` calls are awaited
  sequentially per player. For a 2-player battle this is fine; for royale-mode
  (N players) a `asyncio.gather` pattern would be faster. Left as sequential for
  now (YAGNI).

- **solders `get_associated_token_address` signature**: Requires 3 positional args
  `(owner, mint, token_program_pk)` — the third arg is the token program Pubkey,
  not optional. This matches the solders 0.27.1 API confirmed in the venv.
