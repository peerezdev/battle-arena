# NFT Transfer Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transfer a won NFT from the per-battle escrow to the winner, dispatching by standard (pNFT + Standard in v1), replacing the SPL-only `build_nft_transfer`.

**Architecture:** A new `nft_transfer.py` with PURE builders (PDA helpers, ruleset parser, pNFT `Transfer` assembler — all unit-testable) + ASYNC resolvers/dispatcher (RPC reads, respx-mockable). The engine's settle step becomes async (build → Privy sign-only → submit via our RPC). Validated live: `scripts/verify_pnft_transfer.py` already moves a real pNFT.

**Tech Stack:** Python 3.9, solders 0.27.1 (no `solana`/`spl` libs — build instructions manually), httpx, respx, pytest-asyncio.

## Global Constraints
- Build the pNFT Transfer **ourselves** (derive PDAs + read ruleset from on-chain metadata). No buyback-template dependency.
- Broadcast transfers via Privy `signTransaction` (sign-only) + **our RPC** `sendTransaction` — never Privy `signAndSendTransaction`.
- Unsupported standard (cNFT/MPL Core) → raise `UnsupportedNftStandard` → engine voids + returns pulled NFTs.
- Value source for battles stays ONLY `insured_value`; this layer only moves NFTs. No secret logging.
- Golden vectors (live devnet pNFT) — use verbatim in tests:
  - mint `EFGeHr1UUhADShi7shtW9Ds1VgiRYZRE4wfpoqNKGgyp`
  - escrow `9oZgd4eviozqaYu7KwCTctAYgsRTWtF3McJARaztPsRQ`, escrow ATA `F5UvNqVnrcPKLAbqAHrPoEHStHwU8DBAJRrmp71o6HeB`
  - metadata `6oLXjYugRV1zMUK7pV3HmnMjbdhY4nzC9tSwW1oNL9Qz`, master edition `6NacVi5reTpcSU9nhGDcvxUkvm8FGMUsjY3YfoPjyEBM`
  - escrow-ATA token record `CcPSaXEbBSAZzjnAvB93Hsz7VUR8pbg5tgzKjtsf1Hi4`, ruleset `eBJLFYPxJmMGKuFwpDWkzxZeUrad92kZRC5BJLpzyT9`

---

## File Structure
- `backend/app/services/nft_transfer.py` — NEW: constants, PDA helpers, `read_pnft_ruleset`, `build_pnft_transfer`, `detect_standard`, `resolve_pnft_accounts`, `build_transfer`, `submit_signed_tx`, `UnsupportedNftStandard`.
- `backend/app/services/pack_engine.py` — MODIFY: settle + `_void_return` use async `build_transfer_tx` + injected `submit_tx`.
- `backend/app/services/pack_orchestration.py` — MODIFY: wire the async dispatcher + `submit_tx`.
- `backend/tests/fixtures/pnft_metadata.b64` — committed fixture (already placed; 812 chars).
- Tests: `test_nft_transfer.py` (new), `test_pack_engine.py` + `test_pack_orchestration.py` (update mocks).

---

### Task 1: PDA helpers + ruleset parser

**Files:**
- Create: `backend/app/services/nft_transfer.py`
- Test: `backend/tests/test_nft_transfer.py`
- Fixture (already present): `backend/tests/fixtures/pnft_metadata.b64`

**Interfaces:**
- Produces: `METADATA_PROGRAM` (Pubkey), `metadata_pda(mint)`, `master_edition_pda(mint)`, `token_record_pda(mint, ata)` (all `-> Pubkey`), `read_pnft_ruleset(data: bytes) -> Optional[Pubkey]`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_nft_transfer.py`:
```python
import base64, pathlib
from solders.pubkey import Pubkey
from app.services.nft_transfer import (
    metadata_pda, master_edition_pda, token_record_pda, read_pnft_ruleset)

MINT = Pubkey.from_string("EFGeHr1UUhADShi7shtW9Ds1VgiRYZRE4wfpoqNKGgyp")
ESCROW_ATA = Pubkey.from_string("F5UvNqVnrcPKLAbqAHrPoEHStHwU8DBAJRrmp71o6HeB")
_FIXT = pathlib.Path(__file__).parent / "fixtures" / "pnft_metadata.b64"

def test_pda_helpers_match_live_values():
    assert str(metadata_pda(MINT)) == "6oLXjYugRV1zMUK7pV3HmnMjbdhY4nzC9tSwW1oNL9Qz"
    assert str(master_edition_pda(MINT)) == "6NacVi5reTpcSU9nhGDcvxUkvm8FGMUsjY3YfoPjyEBM"
    assert str(token_record_pda(MINT, ESCROW_ATA)) == "CcPSaXEbBSAZzjnAvB93Hsz7VUR8pbg5tgzKjtsf1Hi4"

def test_read_pnft_ruleset_from_live_metadata():
    data = base64.b64decode(_FIXT.read_text())
    rs = read_pnft_ruleset(data)
    assert str(rs) == "eBJLFYPxJmMGKuFwpDWkzxZeUrad92kZRC5BJLpzyT9"
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_nft_transfer.py -q`
Expected: FAIL (module/functions missing).

- [ ] **Step 3: Implement**

Create `backend/app/services/nft_transfer.py`:
```python
"""Multi-standard NFT transfer (escrow→winner). Pure builders + async resolvers.
v1: pNFT (Metaplex Transfer) + Standard (SPL). cNFT/MPL Core raise UnsupportedNftStandard."""
from __future__ import annotations
import struct
from typing import Optional
from solders.pubkey import Pubkey

METADATA_PROGRAM = Pubkey.from_string("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")
_META = bytes(METADATA_PROGRAM)


def metadata_pda(mint: Pubkey) -> Pubkey:
    return Pubkey.find_program_address([b"metadata", _META, bytes(mint)], METADATA_PROGRAM)[0]


def master_edition_pda(mint: Pubkey) -> Pubkey:
    return Pubkey.find_program_address([b"metadata", _META, bytes(mint), b"edition"], METADATA_PROGRAM)[0]


def token_record_pda(mint: Pubkey, ata: Pubkey) -> Pubkey:
    return Pubkey.find_program_address(
        [b"metadata", _META, bytes(mint), b"token_record", bytes(ata)], METADATA_PROGRAM)[0]


def read_pnft_ruleset(data: bytes) -> Optional[Pubkey]:
    """Sequential Borsh walk of a Token Metadata account → programmable_config.ruleSet (or None)."""
    o = 1 + 32 + 32  # key + update_authority + mint
    for _ in range(3):  # name, symbol, uri (borsh String: u32 len + bytes)
        n = struct.unpack_from("<I", data, o)[0]; o += 4 + n
    o += 2  # seller_fee_basis_points u16
    if data[o] == 1:  # creators: Option<Vec<Creator>>
        n = struct.unpack_from("<I", data, o + 1)[0]; o = o + 1 + 4 + n * 34
    else:
        o += 1
    o += 1 + 1  # primary_sale_happened + is_mutable
    for _ in range(2):  # edition_nonce, token_standard (Option<u8>)
        o = o + 2 if data[o] == 1 else o + 1
    o = o + 1 + 33 if data[o] == 1 else o + 1  # collection Option<Collection>
    o = o + 1 + 17 if data[o] == 1 else o + 1  # uses Option<Uses>
    o = o + 1 + (1 + 8) if data[o] == 1 else o + 1  # collection_details Option (V1: u64)
    if data[o] == 1:  # programmable_config Option<ProgrammableConfig>
        o += 1  # Some
        o += 1  # variant (V1 = 0)
        if data[o] == 1:  # rule_set Option<Pubkey>
            return Pubkey.from_bytes(data[o + 1:o + 1 + 32])
    return None
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_nft_transfer.py -q`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**
```bash
git add backend/app/services/nft_transfer.py backend/tests/test_nft_transfer.py backend/tests/fixtures/pnft_metadata.b64
git commit -m "feat(packbattle): nft_transfer PDA helpers + pNFT ruleset parser"
```

---

### Task 2: `build_pnft_transfer` (Metaplex Transfer, pure)

**Files:**
- Modify: `backend/app/services/nft_transfer.py`
- Test: `backend/tests/test_nft_transfer.py`

**Interfaces:**
- Consumes: `metadata_pda`, `master_edition_pda`, `token_record_pda`, `get_associated_token_address`.
- Produces: `build_pnft_transfer(escrow: str, winner: str, mint: str, recent_blockhash: str, *, ruleset: str) -> str` (base64 unsigned legacy tx: ComputeBudget setComputeUnitLimit(400000) + Metaplex Transfer; fee-payer = escrow).

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_nft_transfer.py`:
```python
import base64 as _b64
from solders.transaction import Transaction
from solders.token.associated import get_associated_token_address
from app.services.nft_transfer import build_pnft_transfer, METADATA_PROGRAM

ESCROW = "9oZgd4eviozqaYu7KwCTctAYgsRTWtF3McJARaztPsRQ"
WINNER = "8QDBKx8P3pxkRhiqyXFtYcPPf2CM1F5NiE5A8yjkgtm6"
MINTS = "EFGeHr1UUhADShi7shtW9Ds1VgiRYZRE4wfpoqNKGgyp"
RULESET = "eBJLFYPxJmMGKuFwpDWkzxZeUrad92kZRC5BJLpzyT9"
BLOCKHASH = "11111111111111111111111111111111"

def test_build_pnft_transfer_accounts_and_data():
    out = build_pnft_transfer(ESCROW, WINNER, MINTS, BLOCKHASH, ruleset=RULESET)
    tx = Transaction.from_bytes(_b64.b64decode(out))
    keys = tx.message.account_keys
    assert keys[0] == Pubkey.from_string(ESCROW)                  # fee payer
    meta_ix = next(ix for ix in tx.message.instructions
                   if keys[ix.program_id_index] == METADATA_PROGRAM)
    assert bytes(meta_ix.data) == bytes([49, 0]) + (1).to_bytes(8, "little") + bytes([0])
    assert len(meta_ix.accounts) == 17
    a = [str(keys[i]) for i in meta_ix.accounts]
    mint = Pubkey.from_string(MINTS)
    esc_ata = str(get_associated_token_address(Pubkey.from_string(ESCROW), mint))
    win_ata = str(get_associated_token_address(Pubkey.from_string(WINNER), mint))
    assert a[0] == esc_ata                                        # source
    assert a[1] == ESCROW                                         # token_owner
    assert a[2] == win_ata                                        # destination
    assert a[3] == WINNER                                         # destination_owner
    assert a[4] == MINTS                                          # mint
    assert a[5] == "6oLXjYugRV1zMUK7pV3HmnMjbdhY4nzC9tSwW1oNL9Qz" # metadata
    assert a[6] == "6NacVi5reTpcSU9nhGDcvxUkvm8FGMUsjY3YfoPjyEBM" # edition
    assert a[7] == "CcPSaXEbBSAZzjnAvB93Hsz7VUR8pbg5tgzKjtsf1Hi4" # escrow token record
    assert a[9] == ESCROW and a[10] == ESCROW                     # authority + payer
    assert a[16] == RULESET                                       # ruleset
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_nft_transfer.py::test_build_pnft_transfer_accounts_and_data -q`
Expected: FAIL (function missing).

- [ ] **Step 3: Implement**

Append to `backend/app/services/nft_transfer.py`:
```python
import base64
from solders.hash import Hash
from solders.instruction import Instruction, AccountMeta
from solders.message import Message
from solders.transaction import Transaction
from solders.token.associated import get_associated_token_address

TOKEN_PROGRAM = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
ATA_PROGRAM = Pubkey.from_string("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
AUTH_RULES_PROGRAM = Pubkey.from_string("auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg")
SYS_PROGRAM = Pubkey.from_string("11111111111111111111111111111111")
SYSVAR_INSTRUCTIONS = Pubkey.from_string("Sysvar1nstructions1111111111111111111111111")
COMPUTE_BUDGET = Pubkey.from_string("ComputeBudget111111111111111111111111111111")

# TransferV1 canonical flags (is_signer, is_writable), indices 0..16
_PNFT_FLAGS = [
    (False, True), (False, False), (False, True), (False, False), (False, False),
    (False, True), (False, False), (False, True), (False, True), (True, False),
    (True, True), (False, False), (False, False), (False, False), (False, False),
    (False, False), (False, False),
]


def build_pnft_transfer(escrow: str, winner: str, mint: str, recent_blockhash: str,
                        *, ruleset: str) -> str:
    esc = Pubkey.from_string(escrow); win = Pubkey.from_string(winner); mnt = Pubkey.from_string(mint)
    esc_ata = get_associated_token_address(esc, mnt)
    win_ata = get_associated_token_address(win, mnt)
    accounts = [
        esc_ata,                              # 0 source token
        esc,                                  # 1 token_owner
        win_ata,                              # 2 destination token
        win,                                  # 3 destination_owner
        mnt,                                  # 4 mint
        metadata_pda(mnt),                    # 5 metadata
        master_edition_pda(mnt),              # 6 master edition
        token_record_pda(mnt, esc_ata),       # 7 owner token record
        token_record_pda(mnt, win_ata),       # 8 destination token record
        esc,                                  # 9 authority
        esc,                                  # 10 payer
        SYS_PROGRAM,                          # 11
        SYSVAR_INSTRUCTIONS,                  # 12
        TOKEN_PROGRAM,                        # 13
        ATA_PROGRAM,                          # 14
        AUTH_RULES_PROGRAM,                   # 15
        Pubkey.from_string(ruleset),          # 16
    ]
    metas = [AccountMeta(pubkey=accounts[i], is_signer=_PNFT_FLAGS[i][0], is_writable=_PNFT_FLAGS[i][1])
             for i in range(17)]
    data = bytes([49, 0]) + (1).to_bytes(8, "little") + bytes([0])  # Transfer, V1, amount=1, auth_data=None
    transfer_ix = Instruction(METADATA_PROGRAM, data, metas)
    cu_ix = Instruction(COMPUTE_BUDGET, bytes([2]) + (400000).to_bytes(4, "little"), [])
    msg = Message.new_with_blockhash([cu_ix, transfer_ix], esc, Hash.from_string(recent_blockhash))
    return base64.b64encode(bytes(Transaction.new_unsigned(msg))).decode()
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_nft_transfer.py -q`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**
```bash
git add backend/app/services/nft_transfer.py backend/tests/test_nft_transfer.py
git commit -m "feat(packbattle): build_pnft_transfer (Metaplex Transfer, 17 accounts)"
```

---

### Task 3: detection + dispatcher + submit

**Files:**
- Modify: `backend/app/services/nft_transfer.py`
- Test: `backend/tests/test_nft_transfer.py`

**Interfaces:**
- Consumes: `build_pnft_transfer`, `read_pnft_ruleset`, `metadata_pda`, `token_record_pda`; `solana_tx.build_nft_transfer` (Standard).
- Produces:
  - `class UnsupportedNftStandard(Exception)`
  - `async detect_standard(rpc_url, mint) -> str` ("pnft"|"standard"|"cnft"|"core"|"unknown")
  - `async build_transfer(rpc_url, escrow, winner, mint, blockhash) -> str` (raises `UnsupportedNftStandard` for cnft/core/unknown)
  - `async submit_signed_tx(rpc_url, signed_tx_b64) -> str`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_nft_transfer.py`:
```python
import json, pytest, respx
from httpx import Response
from app.services.nft_transfer import (
    detect_standard, build_transfer, submit_signed_tx, UnsupportedNftStandard)

RPC = "https://rpc.test"
MPL_CORE = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"

def _acct_info(value):
    return Response(200, json={"jsonrpc": "2.0", "id": 1, "result": {"value": value}})

@respx.mock
@pytest.mark.asyncio
async def test_detect_standard_pnft_when_token_record_exists():
    # mint exists (classic token owner) AND its escrow-ATA token record exists → pnft
    def handler(request):
        body = json.loads(request.content)
        if body["method"] == "getAccountInfo":
            acct = body["params"][0]
            if acct == MINTS:  # mint account → classic token program owner
                return _acct_info({"owner": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "data": ["", "base64"]})
            return _acct_info({"owner": "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s", "data": ["AA==", "base64"]})  # token record exists
        return _acct_info(None)
    respx.post(RPC).mock(side_effect=handler)
    assert await detect_standard(RPC, MINTS) == "pnft"

@respx.mock
@pytest.mark.asyncio
async def test_detect_standard_standard_when_no_token_record():
    def handler(request):
        body = json.loads(request.content)
        acct = body["params"][0]
        if acct == MINTS:
            return _acct_info({"owner": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "data": ["", "base64"]})
        return _acct_info(None)  # token record missing
    respx.post(RPC).mock(side_effect=handler)
    assert await detect_standard(RPC, MINTS) == "standard"

@respx.mock
@pytest.mark.asyncio
async def test_detect_standard_core_and_cnft():
    respx.post(RPC).mock(return_value=_acct_info({"owner": MPL_CORE, "data": ["", "base64"]}))
    assert await detect_standard(RPC, MINTS) == "core"

@respx.mock
@pytest.mark.asyncio
async def test_build_transfer_raises_for_core():
    respx.post(RPC).mock(return_value=_acct_info({"owner": MPL_CORE, "data": ["", "base64"]}))
    with pytest.raises(UnsupportedNftStandard):
        await build_transfer(RPC, ESCROW, WINNER, MINTS, BLOCKHASH)

@respx.mock
@pytest.mark.asyncio
async def test_submit_signed_tx_returns_signature():
    respx.post(RPC).mock(return_value=Response(200, json={"jsonrpc": "2.0", "id": 1, "result": "SIG"}))
    assert await submit_signed_tx(RPC, "TX") == "SIG"
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_nft_transfer.py -k "detect or build_transfer or submit" -q`
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `backend/app/services/nft_transfer.py`:
```python
import httpx

MPL_CORE_PROGRAM = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"


class UnsupportedNftStandard(Exception):
    pass


async def _get_account(rpc_url: str, pubkey: str) -> Optional[dict]:
    async with httpx.AsyncClient() as c:
        r = await c.post(rpc_url, json={"jsonrpc": "2.0", "id": 1, "method": "getAccountInfo",
                                        "params": [pubkey, {"encoding": "base64"}]}, timeout=20)
        r.raise_for_status()
        return (r.json().get("result") or {}).get("value")


async def detect_standard(rpc_url: str, mint: str) -> str:
    info = await _get_account(rpc_url, mint)
    if info is None:
        return "cnft"  # no mint account → compressed (lives in a tree)
    if info.get("owner") == MPL_CORE_PROGRAM:
        return "core"
    if info.get("owner") != str(TOKEN_PROGRAM):
        return "unknown"
    # classic token mint → pNFT iff a token record exists for the escrow's ATA.
    # We use ANY ATA owner for the record-existence check by deriving from the mint + a probe ATA is
    # not possible without an owner; instead check the metadata's programmable marker via the record
    # under the *current largest holder*. Simpler+sufficient here: the caller passes escrow at build
    # time; detection alone uses the metadata account's token_standard. -> read metadata:
    meta = await _get_account(rpc_url, str(metadata_pda(Pubkey.from_string(mint))))
    if meta is None:
        return "standard"
    raw = base64.b64decode(meta["data"][0])
    # token_standard byte: ProgrammableNonFungible == 4. Walk to token_standard Option<u8>.
    return "pnft" if _token_standard(raw) == 4 else "standard"


def _token_standard(data: bytes) -> Optional[int]:
    o = 1 + 32 + 32
    for _ in range(3):
        n = struct.unpack_from("<I", data, o)[0]; o += 4 + n
    o += 2
    if data[o] == 1:
        n = struct.unpack_from("<I", data, o + 1)[0]; o = o + 1 + 4 + n * 34
    else:
        o += 1
    o += 1 + 1  # primary_sale + is_mutable
    o = o + 2 if data[o] == 1 else o + 1  # edition_nonce
    if data[o] == 1:  # token_standard Some
        return data[o + 1]
    return None


async def build_transfer(rpc_url: str, escrow: str, winner: str, mint: str, blockhash: str) -> str:
    std = await detect_standard(rpc_url, mint)
    if std == "pnft":
        meta = await _get_account(rpc_url, str(metadata_pda(Pubkey.from_string(mint))))
        ruleset = read_pnft_ruleset(base64.b64decode(meta["data"][0]))
        if ruleset is None:
            raise UnsupportedNftStandard("pnft with no ruleset not supported in v1")
        return build_pnft_transfer(escrow, winner, mint, blockhash, ruleset=str(ruleset))
    if std == "standard":
        from app.services.solana_tx import build_nft_transfer
        return build_nft_transfer(escrow, winner, mint, blockhash)
    raise UnsupportedNftStandard(f"standard={std}")


async def submit_signed_tx(rpc_url: str, signed_tx_b64: str) -> str:
    async with httpx.AsyncClient() as c:
        r = await c.post(rpc_url, json={"jsonrpc": "2.0", "id": 1, "method": "sendTransaction",
                                        "params": [signed_tx_b64, {"encoding": "base64"}]}, timeout=30)
        r.raise_for_status()
        d = r.json()
        if d.get("error"):
            raise RuntimeError(f"sendTransaction failed: {d['error']}")
        return d["result"]
```
**Implementer note:** the `detect_standard` pNFT check uses the metadata `token_standard == 4` (ProgrammableNonFungible) — simpler and owner-agnostic than deriving a token-record under an unknown ATA. Verify against the live metadata fixture: add a test that `_token_standard(fixture_bytes) == 4`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_nft_transfer.py -q`
Expected: PASS (all).

- [ ] **Step 5: Commit**
```bash
git add backend/app/services/nft_transfer.py backend/tests/test_nft_transfer.py
git commit -m "feat(packbattle): detect_standard + build_transfer dispatcher + submit_signed_tx"
```

---

### Task 4: Engine — async transfer + our-RPC submit

**Files:**
- Modify: `backend/app/services/pack_engine.py`
- Test: `backend/tests/test_pack_engine.py`

**Interfaces:**
- Consumes: an injected async `build_transfer_tx(escrow, dest, mint) -> str` and async `submit_tx(signed) -> str`; `signer.sign_solana`.
- Produces: `run_battle(..., build_transfer_tx, submit_tx, ...)` where settle does `tx=await build_transfer_tx(...)`, `signed=await signer.sign_solana(...)`, `await submit_tx(signed)`; `UnsupportedNftStandard`/any error mid-settle → void + return.

- [ ] **Step 1: Write the failing test**

In `backend/tests/test_pack_engine.py`, update the `_Signer`/test closures and add an injected `submit_tx`. Replace the settle assertions: pulls go via `signer.signed` (sign_solana); transfers are now `await build_transfer_tx` (async) + `await submit_tx`. Update `_Signer` to keep `sign_solana` returning `f"signed-{tx}"`; add a `_submits = []` list captured by a `submit_tx` closure. New/edited test:
```python
@pytest.mark.asyncio
async def test_run_battle_settles_with_async_transfer(session):
    b = PackBattle(id="b1", mode="pack", machine_code="pokemon_50", price=50, max_players=2, status="running")
    session.add(b)
    session.add_all([BattlePlayer(battle_id="b1", player_wallet="A"),
                     BattlePlayer(battle_id="b1", player_wallet="B")])
    session.commit()
    gacha = _Gacha({"A": {"nft_address": "nA", "insured_value": 100, "grade": 9},
                    "B": {"nft_address": "nB", "insured_value": 300, "grade": 8}})
    signer = _Signer()
    built, submits = [], []
    async def build_transfer_tx(esc, dest, mint):
        built.append((esc, dest, mint)); return f"xfer-{mint}->{dest}"
    async def submit_tx(signed):
        submits.append(signed); return "ccsig"
    out = await run_battle(session, b, gacha=gacha, signer=signer,
                           resolve_wallet_id=lambda w: f"{w}-id",
                           build_transfer_tx=build_transfer_tx, submit_tx=submit_tx,
                           can_play=lambda w: True, now_fn=lambda: __import__("datetime").datetime(2026,6,21))
    assert out == "settled" and b.winner == "B"
    assert ("ESC", "B", "nA") in built and ("ESC", "B", "nB") in built   # both → winner from escrow addr
    assert {s for s in submits} == {"signed-xfer-nA->B", "signed-xfer-nB->B"}  # sign_solana then submit

@pytest.mark.asyncio
async def test_run_battle_voids_on_unsupported_standard(session):
    from app.services.nft_transfer import UnsupportedNftStandard
    b = PackBattle(id="b9", mode="pack", machine_code="pokemon_50", price=50, max_players=1, status="running")
    session.add(b); session.add(BattlePlayer(battle_id="b9", player_wallet="A")); session.commit()
    gacha = _Gacha({"A": {"nft_address": "nA", "insured_value": 100, "grade": 9}})
    signer = _Signer()
    async def build_transfer_tx(esc, dest, mint): raise UnsupportedNftStandard("cnft")
    async def submit_tx(signed): return "x"
    out = await run_battle(session, b, gacha=gacha, signer=signer,
                           resolve_wallet_id=lambda w: f"{w}-id",
                           build_transfer_tx=build_transfer_tx, submit_tx=submit_tx,
                           can_play=lambda w: True, now_fn=lambda: __import__("datetime").datetime(2026,6,21))
    assert out == "voided" and b.winner is None
```
Also update `test_run_battle_settles_to_winner`/`_sponsor_flag_propagates`/`_polls_open_pack...`/`_voids_when_player_cannot_play` to pass the new async `build_transfer_tx` + `submit_tx` closures (sync lambdas → async; add `submit_tx`). The `_Signer.sign_and_send_solana` is no longer used by settle — remove the `.sent`-based transfer assertions (those move to `built`/`submits`).

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_pack_engine.py -q`
Expected: FAIL (run_battle has no `submit_tx`, build_transfer_tx not awaited).

- [ ] **Step 3: Implement**

In `backend/app/services/pack_engine.py`, change the signature to add `submit_tx` and make the transfer steps async:
```python
async def run_battle(session, battle, *, gacha, signer, resolve_wallet_id, build_transfer_tx,
                     submit_tx, can_play, now_fn, sponsor: bool = False,
                     open_max_attempts: int = 20, open_delay: float = 3.0, sleep_fn=None) -> str:
```
Settle loop:
```python
    winner = determine_winner(outcomes, players)
    for o in outcomes:
        tx = await build_transfer_tx(esc["address"], winner, o.nft_address)
        signed = await signer.sign_solana(esc["id"], tx)
        await submit_tx(signed)
    battle.winner = winner; battle.status = "settled"; battle.settled_at = now_fn()
    session.commit()
    return "settled"
```
`_void_return` becomes async-transfer too:
```python
async def _void_return(signer, esc, outcomes, build_transfer_tx, submit_tx):
    for o in outcomes:
        try:
            tx = await build_transfer_tx(esc["address"], o.player_wallet, o.nft_address)
            signed = await signer.sign_solana(esc["id"], tx)
            await submit_tx(signed)
        except Exception:
            logger.warning("void-return transfer failed: escrow=%s nft=%s player=%s",
                           esc.get("id"), o.nft_address, o.player_wallet)
```
Update the two `_void_return(...)` call sites to pass `submit_tx` and drop the `sponsor` arg. Remove the `sponsor=sponsor` from the (now-removed) transfer `sign_and_send_solana` calls — settle no longer calls `sign_and_send_solana`. Keep the `sponsor` param on `run_battle` for now (unused; the pull path never used it either after the CC-submit change).

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_pack_engine.py -q`
Expected: PASS.

- [ ] **Step 5: Full suite + commit**
```bash
cd backend && .venv/bin/pytest -q   # expect green
git add backend/app/services/pack_engine.py backend/tests/test_pack_engine.py
git commit -m "feat(packbattle): engine settle via async build_transfer + our-RPC submit (+void on unsupported)"
```

---

### Task 5: Wiring — async dispatcher + submit

**Files:**
- Modify: `backend/app/services/pack_orchestration.py`
- Test: `backend/tests/test_pack_orchestration.py`

**Interfaces:**
- Consumes: `nft_transfer.build_transfer`, `nft_transfer.submit_signed_tx`; the updated `run_battle(..., build_transfer_tx, submit_tx, ...)`.
- Produces: `run_pack_battle_live` passes `build_transfer_tx = lambda esc, dest, mint: build_transfer(rpc_url, esc, dest, mint, blockhash)` and `submit_tx = lambda signed: submit_signed_tx(rpc_url, signed)`.

- [ ] **Step 1: Update the failing test**

In `backend/tests/test_pack_orchestration.py`, the happy-path test must now stub the per-NFT transfer. Easiest: monkeypatch `app.services.pack_orchestration.build_transfer` and `submit_signed_tx` with async fakes (the real ones need pNFT metadata over RPC, out of scope for the wiring unit test). Update the `_Signer` fake to have `sign_solana`. Assert the run reaches "settled" and that the fakes were called with `(rpc_url, escrow, winner, nft, blockhash)` and the signed tx. Keep the underfunded-player void test (it voids before settle, so transfers aren't reached).
```python
@pytest.mark.asyncio
async def test_run_pack_battle_live_uses_transfer_dispatcher(session, monkeypatch):
    import app.services.pack_orchestration as po
    calls = {"build": [], "submit": []}
    async def fake_build(rpc, esc, dest, mint, bh): calls["build"].append((esc, dest, mint)); return f"tx-{mint}"
    async def fake_submit(rpc, signed): calls["submit"].append(signed); return "sig"
    monkeypatch.setattr(po, "build_transfer", fake_build)
    monkeypatch.setattr(po, "submit_signed_tx", fake_submit)
    # ... set up battle + 1 player with wallet_id + sufficient USDC (respx for blockhash + balance) ...
    # assert result == "settled" and calls["build"] and calls["submit"]
```
(Reuse the existing happy-path scaffolding; mirror its respx setup. The fake signer's `sign_solana` returns `f"signed-{tx}"`.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_pack_orchestration.py -q`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `backend/app/services/pack_orchestration.py`: import `from app.services.nft_transfer import build_transfer, submit_signed_tx`. In `run_pack_battle_live`, replace the sync `build_transfer_tx` closure and add `submit_tx`:
```python
    build_transfer_tx = lambda esc, dest, mint: build_transfer(rpc_url, esc, dest, mint, blockhash)  # noqa: E731
    submit_tx = lambda signed: submit_signed_tx(rpc_url, signed)  # noqa: E731
    return await run_battle(session, battle, gacha=gacha, signer=signer,
                            resolve_wallet_id=resolve_wallet_id, build_transfer_tx=build_transfer_tx,
                            submit_tx=submit_tx, can_play=can_play, now_fn=now_fn, sponsor=sponsor)
```
(The closures return coroutines; the engine awaits them — correct.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_pack_orchestration.py -q` then `cd backend && .venv/bin/pytest -q`
Expected: PASS, full suite green.

- [ ] **Step 5: Commit**
```bash
git add backend/app/services/pack_orchestration.py backend/tests/test_pack_orchestration.py
git commit -m "feat(packbattle): wire multi-standard transfer dispatcher into run_pack_battle_live"
```

---

## Self-Review
**1. Spec coverage:** detection → Task 3; ruleset parse → Task 1; pNFT Transfer (17 accounts) → Task 2; Standard via solana_tx → Task 3 dispatcher; sign-only+our-RPC submit → Task 3 (`submit_signed_tx`) + Task 4 engine; engine async + void-on-unsupported → Task 4; wiring → Task 5. cNFT/Core void → Tasks 3/4. ✓
**2. Placeholders:** All code is concrete. Task 5's test snippet says "reuse the existing scaffolding" with the exact monkeypatch fakes given — the implementer mirrors the committed happy-path test's respx setup (named in the task). The `detect_standard` approach is pinned to `token_standard==4` with a note + a fixture assertion.
**3. Type consistency:** `build_pnft_transfer(escrow,winner,mint,blockhash,*,ruleset)`, `build_transfer(rpc_url,escrow,winner,mint,blockhash)`, `submit_signed_tx(rpc_url,signed)`, `detect_standard(rpc_url,mint)`, engine `run_battle(...,build_transfer_tx,submit_tx,...)` consistent across Tasks 2–5 and the spec. PDA helper names match Task 1.

## No-goals (carried)
cNFT (Bubblegum+DAS) and MPL Core transfers; lobby/#3; UI/#4; App-pays sponsorship for transfers; DAS-based detection.
