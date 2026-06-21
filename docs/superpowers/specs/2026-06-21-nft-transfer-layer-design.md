# NFT transfer layer — multi-standard escrow→winner (design)

Date: 2026-06-21
Status: approved-pending-review
Parent: Pack Battle (`2026-06-20-pack-battle-orchestration-engine-design.md`)
Validated live: pNFT transfer escrow→winner works on devnet (`backend/scripts/verify_pnft_transfer.py`).

## Goal
Transfer a won NFT from the per-battle escrow to the winner, choosing the correct on-chain
mechanism by the NFT's standard. Replaces the SPL-only `build_nft_transfer` (which fails on the
frozen pNFTs that CC's graded cards actually are). **v1 scope: pNFT + Standard NFT.** cNFT and
MPL Core are out of v1 → the engine voids the battle (nobody robbed) if one is pulled.

## Decisions (from brainstorming)
- **Build the pNFT Transfer ourselves** (self-contained): derive the PDAs and read the auth ruleset
  from the on-chain metadata. No dependency on CC's buyback tx as a template.
- **Broadcast = Privy `signTransaction` (sign-only) + submit via OUR RPC** (`sendTransaction`), NOT
  Privy `signAndSendTransaction` (fails: Privy broadcasts on a different RPC → "Blockhash not found").
- **Unsupported standard (cNFT/MPL Core) → raise → engine voids** + returns already-pulled NFTs.
- Value source for battles remains ONLY `insured_value`; this layer only moves NFTs.

## Module — `backend/app/services/nft_transfer.py`
Split into PURE builders (unit-testable, no I/O) + ASYNC resolvers (RPC reads, mockable).

### Constants
```
TOKEN_PROGRAM   = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
ATA_PROGRAM     = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
META_PROGRAM    = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
AUTH_RULES_PROG = "auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg"
SYS_PROGRAM     = "11111111111111111111111111111111"
SYSVAR_INSTRUCTIONS = "Sysvar1nstructions1111111111111111111111111"
```

### PDA helpers (pure)
- `metadata_pda(mint)` = `["metadata", META, mint]`
- `master_edition_pda(mint)` = `["metadata", META, mint, "edition"]`
- `token_record_pda(mint, ata)` = `["metadata", META, mint, "token_record", ata]`
- ATA via `solders.token.associated.get_associated_token_address(owner, mint, token_program)`

### Standard detection — `async detect_standard(rpc_url, mint) -> str` ("pnft"|"standard"|"cnft"|"core"|"unknown")
- `getAccountInfo(mint)` → if owner is the **MPL Core** program → `"core"`. If the account does not
  exist (no mint account) → `"cnft"` (compressed; lives in a tree, not a mint). Else it is a token mint.
- For a token mint: `getAccountInfo(token_record_pda(mint, <escrow ATA>))` → if it exists → `"pnft"`;
  else → `"standard"`. (A token record is the definitive pNFT marker.)
- v1 only acts on `"pnft"` and `"standard"`; `"cnft"`/`"core"`/`"unknown"` → caller voids.

### Ruleset parse (pure) — `read_pnft_ruleset(metadata_account_bytes) -> Optional[Pubkey]`
Sequential Borsh walk of the Token Metadata account to reach `programmable_config.ruleSet`:
key(1) + update_authority(32) + mint(32); then 3 borsh Strings (name/symbol/uri, each u32-len + bytes);
seller_fee(u16); `creators: Option<Vec<Creator>>` (Option u8; if 1: vec_len u32 + vec_len × 34 [pubkey32+bool1+u8 share1]);
primary_sale_happened(1); is_mutable(1); `edition_nonce: Option<u8>`; `token_standard: Option<u8>`;
`collection: Option` (1; if Some +33); `uses: Option` (1; if Some +17); `collection_details: Option` (1; if Some, V1 +8);
`programmable_config: Option<ProgrammableConfig>` (1; if Some: variant u8 (V1=0) + `rule_set: Option<Pubkey>` (1; if Some 32)).
Return the rule_set pubkey or None. **Golden test**: the live metadata `6oLXjYugRV1z…` must yield ruleset `eBJLFYPx…`.

### pNFT Transfer (pure) — `build_pnft_transfer(escrow, winner, mint, blockhash, *, ruleset) -> base64`
Single Metaplex `Transfer` (+ a ComputeBudget `setComputeUnitLimit(400000)` ix first). Instruction:
- program = `META_PROGRAM`; data = `bytes([49, 0]) + (1).to_bytes(8,"little") + bytes([0])` (Transfer, V1, amount=1, auth_data=None).
- **17 accounts** in this exact order with these flags (validated against the live tx):

| # | account | signer | writable |
|---|---|---|---|
|0| escrow ATA (source) | – | ✓ |
|1| escrow (token_owner) | – | – |
|2| winner ATA (destination) | – | ✓ |
|3| winner (destination_owner) | – | – |
|4| mint | – | – |
|5| metadata_pda | – | ✓ |
|6| master_edition_pda | – | – |
|7| escrow-ATA token_record | – | ✓ |
|8| winner-ATA token_record | – | ✓ |
|9| escrow (authority) | ✓ | – |
|10| escrow (payer / fee-payer) | ✓ | ✓ |
|11| system | – | – |
|12| sysvar instructions | – | – |
|13| SPL Token | – | – |
|14| ATA program | – | – |
|15| auth-rules program | – | – |
|16| ruleset | – | – |

fee-payer = escrow. (If `ruleset is None`, accounts 15–16 are still passed as the program id + a
None-marker per Metaplex; v1 targets CC cards which DO have a ruleset.) The destination ATA + token
record are created by the Transfer itself (ATA program is in the accounts) — no separate create ix.

### Standard NFT transfer (pure) — `build_standard_transfer(...)`
Reuse the existing `solana_tx.build_nft_transfer` (CreateIdempotent ATA + `transfer_checked`). Standard
NFTs are not frozen, so SPL transfer works.

### Async resolver + dispatcher
- `async resolve_pnft_accounts(rpc_url, mint, escrow, winner) -> dict` — getAccountInfo(metadata) →
  `read_pnft_ruleset`; derive the PDAs/ATAs. Returns the inputs `build_pnft_transfer` needs.
- `async build_transfer(rpc_url, escrow, winner, mint, blockhash) -> base64` — `detect_standard` →
  `"pnft"`: resolve + `build_pnft_transfer`; `"standard"`: `build_standard_transfer`; else raise
  `UnsupportedNftStandard`.

## Broadcast — `async submit_signed_tx(rpc_url, signed_tx_b64) -> str`
`sendTransaction(signed, {encoding:"base64"})` on our RPC → returns the signature, raises on error.

## Engine integration (`pack_engine.run_battle`)
The settle (and `_void_return`) steps change from `build_transfer_tx`(sync)+`sign_and_send_solana` to:
```
tx     = await build_transfer_tx(esc["address"], dest, o.nft_address)   # async dispatcher; raises UnsupportedNftStandard
signed = await signer.sign_solana(esc["id"], tx)
await submit_tx(signed)                                                  # our-RPC submit
```
- `build_transfer_tx` becomes **async** (injected). A `submit_tx` async callable is injected too.
- An `UnsupportedNftStandard` raised mid-settle → treat like any settle failure → void + return already-
  transferred NFTs to their pullers (best-effort). Pre-flight cannot know the standard (NFTs unknown
  until pulled), so the void happens at settle.
- `sponsor` no longer applies to transfers (we submit via our RPC, escrow pays its own fee) — drop the
  `sponsor` path from the transfer step. (`sponsor` becomes unused in the engine for now; keep the param
  for future App-pays but mark it no-op in settle.)

## Wiring (`pack_orchestration.run_pack_battle_live`)
- Replace the sync `build_transfer_tx` closure with `lambda esc, dest, mint: build_transfer(rpc_url, esc, dest, mint, blockhash)`.
- Inject `submit_tx = lambda signed: submit_signed_tx(rpc_url, signed)`.
- Blockhash is still pre-fetched once (a single battle's transfers fit one blockhash window).

## Error handling
- `UnsupportedNftStandard` (cNFT/Core) → settle raises → engine voids + returns. Logged with the mint.
- Metadata/RPC read fails → raise → void (don't transfer with a half-resolved tx).
- A pNFT with `ruleset is None` → build without the rules accounts (Metaplex allows it).

## Testing
- **Unit (pure, no I/O):** `read_pnft_ruleset` against a committed golden metadata-bytes vector →
  asserts `eBJLFYPx…`; `build_pnft_transfer` → decode the tx and assert the exact 17 accounts (order +
  flags) + the data bytes `[49,0,1,0,0,0,0,0,0,0,0]` + fee-payer = escrow, using the live values as the
  golden vector; `build_standard_transfer` keeps its existing tests; PDA helpers against known values
  (metadata `6oLXjYug…`, edition `6NacVi5…`, escrow token_record `CcPSaXEb…`).
- **Unit (async, mocked RPC via respx):** `detect_standard` returns pnft/standard/cnft/core for crafted
  getAccountInfo responses; `build_transfer` dispatches correctly + raises `UnsupportedNftStandard`.
- **Engine:** mocks updated for async `build_transfer_tx` + injected `submit_tx`; void-on-unsupported path.
- **Devnet:** the existing `verify_pnft_transfer.py` already passes; add the engine-driven run once integrated.

## No-goals (this sub-project)
- cNFT transfer (Bubblegum + DAS proof; needs a DAS RPC — separate decision) and MPL Core transfer.
- The lobby/#3 and UI/#4. Privy App-pays sponsorship for transfers.
- Reading the standard via DAS (we use on-chain heuristics in v1).
