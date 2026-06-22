# Turbo settle + MPL Core transfer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settle both battle modes correctly for every standard the gacha delivers — pull in turbo (CC auto-sells commons → USDC to the escrow), transfer non-common cards (incl. MPL Core) to the winner, hand the winner the escrow USDC, resiliently.

**Architecture:** Add an MPL Core `TransferV1` builder to the existing multi-standard dispatcher; flip battle pulls to turbo; persist `auto_sold`/`transferred` per pull; replace both engines' settle with one shared resilient helper that transfers non-auto-sold NFTs (bounded retries, flag stuck cards) and sweeps the escrow USDC to the winner; the live wiring pre-creates the escrow USDC ATA (so CC's payout doesn't revert) and provides the USDC-sweep builder.

**Tech Stack:** Python 3.9, FastAPI, SQLAlchemy, solders 0.27.1 (hand-built instructions), pytest/pytest-asyncio. Run from `backend/` with `.venv/bin/pytest`.

## Global Constraints

- Secrets stay backend-only; the signer never logs tx bytes, keys, or signatures (log only wallet/battle id/mint/error).
- Card value source is **only** `insuredValue`; ranking (winner + royale elimination) uses `insured_value`, **never** `buyback_amount`.
- **Turbo (`turbo=True`) is for battles only** — the solo-gacha flow keeps `turbo=False` (user chooses keep/buyback). Do not touch solo-gacha behaviour.
- **The escrow USDC ATA must exist before any turbo pull** (else CC's auto-buyback payout reverts: CreateIdempotent eats the CU budget → the Memo runs out → `ProgramFailedToComplete`).
- **Never void a battle after the winner is determined.** Settle is resilient: retry transient failures, flag a genuinely-unsupported card (`transferred=False`), continue.
- MPL Core `TransferV1`: program `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d`, data `bytes([14, 0])`, 7 accounts `[asset(w), collection(w if present else CoRE id), payer(signer,w), authority(signer), new_owner, system_program, log_wrapper=CoRE id]`. These are confirmed live; do not change them.

---

### Task 1: MPL Core transfer builder + dispatcher route

**Files:**
- Modify: `backend/app/services/nft_transfer.py` (add `read_core_collection`, `build_core_transfer`, a `"core"` branch in `build_transfer`)
- Test: `backend/tests/test_nft_transfer_core.py`

**Interfaces:**
- Consumes: existing `MPL_CORE_PROGRAM` (str), `SYS_PROGRAM`, `COMPUTE_BUDGET` (Pubkey), `_get_account`, `detect_standard` (already returns `"core"`).
- Produces:
  - `read_core_collection(data: bytes) -> Optional[Pubkey]`
  - `build_core_transfer(escrow: str, winner: str, mint: str, recent_blockhash: str, *, collection: Optional[str]) -> str`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_nft_transfer_core.py`:

```python
import base64
from solders.pubkey import Pubkey
from solders.transaction import Transaction
from app.services.nft_transfer import (
    build_core_transfer, read_core_collection, MPL_CORE_PROGRAM, SYS_PROGRAM)

ASSET = "4VE7wrGvS3hBNb9kyManAx2pWmRQJftQAqGsEE7C5Tff"
ESCROW = "9oZgd4eviozqaYu7KwCTctAYgsRTWtF3McJARaztPsRQ"
WINNER = "8QDBKx8P3pxkRhiqyXFtYcPPf2CM1F5NiE5A8yjkgtm6"
COLLECTION = "CCryptUfeFSZ3Fgc9FLeKrhLVAP67FSqi1GuVoj9CRac"
BLOCKHASH = "11111111111111111111111111111111"


def _core_ix(out):
    tx = Transaction.from_bytes(base64.b64decode(out))
    keys = tx.message.account_keys
    core = Pubkey.from_string(MPL_CORE_PROGRAM)
    ix = next(i for i in tx.message.instructions if keys[i.program_id_index] == core)
    return tx, keys, ix


def test_build_core_transfer_with_collection():
    tx, keys, ix = _core_ix(build_core_transfer(ESCROW, WINNER, ASSET, BLOCKHASH, collection=COLLECTION))
    assert keys[0] == Pubkey.from_string(ESCROW)            # fee payer
    assert bytes(ix.data) == bytes([14, 0])                 # TransferV1, compression_proof None
    assert len(ix.accounts) == 7
    a = [str(keys[i]) for i in ix.accounts]
    assert a == [ASSET, COLLECTION, ESCROW, ESCROW, WINNER, str(SYS_PROGRAM), MPL_CORE_PROGRAM]
    # collection writable, asset writable, payer writable+signer, authority signer
    flags = [(keys[i], ix.accounts) for i in ix.accounts]   # touch to ensure indices valid
    assert ix.accounts is not None


def test_build_core_transfer_no_collection_uses_program_id():
    tx, keys, ix = _core_ix(build_core_transfer(ESCROW, WINNER, ASSET, BLOCKHASH, collection=None))
    a = [str(keys[i]) for i in ix.accounts]
    assert a[1] == MPL_CORE_PROGRAM                         # None → CoRE program id


def test_read_core_collection_variant2_returns_pubkey():
    data = bytes([1]) + bytes(32) + bytes([2]) + bytes(Pubkey.from_string(COLLECTION))
    assert str(read_core_collection(data)) == COLLECTION


def test_read_core_collection_variant1_or_0_returns_none():
    assert read_core_collection(bytes([1]) + bytes(32) + bytes([1]) + bytes(32)) is None
    assert read_core_collection(bytes([1]) + bytes(32) + bytes([0])) is None


def test_read_core_collection_truncated_returns_none():
    assert read_core_collection(b"\x01" + b"\x00" * 10) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_nft_transfer_core.py -v`
Expected: FAIL with `ImportError: cannot import name 'build_core_transfer'`.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/services/nft_transfer.py`, just below the `MPL_CORE_PROGRAM = "..."` line (the `class UnsupportedNftStandard` area), add the module constant and two functions:

```python
_MPL_CORE_PK = Pubkey.from_string(MPL_CORE_PROGRAM)


def read_core_collection(data: bytes) -> Optional[Pubkey]:
    """MPL Core AssetV1: key(1) + owner(32) + update_authority enum.
    Variant 2 == Collection → next 32 bytes are the collection pubkey; variants 0/1 → None.
    Returns None on any truncated buffer (caller transfers without a collection)."""
    try:
        o = 1 + 32  # key + owner
        if data[o] == 2:  # Collection
            return Pubkey.from_bytes(data[o + 1:o + 1 + 32])
        return None
    except (IndexError, ValueError):
        return None


def build_core_transfer(escrow: str, winner: str, mint: str, recent_blockhash: str,
                        *, collection: Optional[str]) -> str:
    esc = Pubkey.from_string(escrow); win = Pubkey.from_string(winner); asset = Pubkey.from_string(mint)
    coll = Pubkey.from_string(collection) if collection else _MPL_CORE_PK  # None → program id
    metas = [
        AccountMeta(asset,    is_signer=False, is_writable=True),                       # 0 asset
        AccountMeta(coll,     is_signer=False, is_writable=(collection is not None)),   # 1 collection|None
        AccountMeta(esc,      is_signer=True,  is_writable=True),                       # 2 payer
        AccountMeta(esc,      is_signer=True,  is_writable=False),                      # 3 authority (owner)
        AccountMeta(win,      is_signer=False, is_writable=False),                      # 4 new_owner
        AccountMeta(SYS_PROGRAM, is_signer=False, is_writable=False),                   # 5 system_program
        AccountMeta(_MPL_CORE_PK, is_signer=False, is_writable=False),                  # 6 log_wrapper (None)
    ]
    transfer_ix = Instruction(_MPL_CORE_PK, bytes([14, 0]), metas)  # TransferV1, compression_proof None
    cu_ix = Instruction(COMPUTE_BUDGET, bytes([2]) + (100000).to_bytes(4, "little"), [])
    msg = Message.new_with_blockhash([cu_ix, transfer_ix], esc, Hash.from_string(recent_blockhash))
    return base64.b64encode(bytes(Transaction.new_unsigned(msg))).decode()
```

Then add the `"core"` branch to `build_transfer`, immediately before the final `raise UnsupportedNftStandard(...)`:

```python
    if std == "core":
        info = await _get_account(rpc_url, mint)
        coll = read_core_collection(base64.b64decode(info["data"][0])) if info else None
        return build_core_transfer(escrow, winner, mint, blockhash,
                                   collection=str(coll) if coll else None)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_nft_transfer_core.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/nft_transfer.py backend/tests/test_nft_transfer_core.py
git commit -m "feat(nft): MPL Core TransferV1 builder + dispatcher route"
```

---

### Task 2: BattlePull.auto_sold + transferred columns

**Files:**
- Modify: `backend/app/models.py:92-102` (BattlePull)
- Test: `backend/tests/test_models.py`

**Interfaces:**
- Produces: `BattlePull.auto_sold: bool` (default False), `BattlePull.transferred: bool` (default False).

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_models.py`:

```python
def test_battle_pull_auto_sold_and_transferred_defaults():
    from app.db import make_engine, make_session_factory, init_db
    from app.models import BattlePull
    engine = make_engine("sqlite:///:memory:"); init_db(engine)
    Session = make_session_factory(engine)
    with Session() as s:
        p = BattlePull(battle_id="b1", player_wallet="A", memo="m1")
        s.add(p); s.commit()
        row = s.query(BattlePull).first()
        assert row.auto_sold is False and row.transferred is False
        row.auto_sold = True; row.transferred = True; s.commit()
        assert s.query(BattlePull).first().auto_sold is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_models.py::test_battle_pull_auto_sold_and_transferred_defaults -v`
Expected: FAIL with `AttributeError: 'BattlePull' object has no attribute 'auto_sold'`.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/models.py`, in `class BattlePull`, after the `rarity` line add:

```python
    auto_sold: Mapped[bool] = mapped_column(Boolean, default=False)
    transferred: Mapped[bool] = mapped_column(Boolean, default=False)
```

(`Boolean` is already imported on line 3.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_models.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/tests/test_models.py
git commit -m "feat(models): BattlePull.auto_sold + transferred"
```

---

### Task 3: GachaService.generate_pack turbo flag

**Files:**
- Modify: `backend/app/services/gacha.py:111-117` (generate_pack)
- Test: `backend/tests/test_gacha.py`

**Interfaces:**
- Produces: `generate_pack(self, player_address, pack_type, alt_player_address=None, turbo=False)` — adds `"turbo": True` to the body only when `turbo` is true.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_gacha.py`:

```python
@pytest.mark.asyncio
async def test_generate_pack_turbo_flag(monkeypatch):
    from app.services.gacha import GachaService
    g = GachaService(base_url="http://x", api_key="k")
    captured = {}
    async def fake_request(method, path, json=None, params=None):
        captured["json"] = json
        return {"memo": "m", "transaction": "t"}
    monkeypatch.setattr(g, "_request", fake_request)

    await g.generate_pack("P", "pokemon_50", alt_player_address="E", turbo=True)
    assert captured["json"]["turbo"] is True
    assert captured["json"]["altPlayerAddress"] == "E"

    await g.generate_pack("P", "pokemon_50")
    assert "turbo" not in captured["json"]
```

(If `test_gacha.py` lacks `import pytest`, add it at the top.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_gacha.py::test_generate_pack_turbo_flag -v`
Expected: FAIL with `TypeError: generate_pack() got an unexpected keyword argument 'turbo'`.

- [ ] **Step 3: Write minimal implementation**

Replace `generate_pack` in `backend/app/services/gacha.py`:

```python
    async def generate_pack(self, player_address: str, pack_type: str,
                            alt_player_address: str | None = None, turbo: bool = False) -> dict:
        body = {"playerAddress": player_address, "packType": pack_type}
        if alt_player_address:
            body["altPlayerAddress"] = alt_player_address
        if turbo:
            body["turbo"] = True
        raw = await self._request("POST", "/api/generatePack", json=body)
        return {"memo": raw.get("memo"), "transaction": raw.get("transaction")}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_gacha.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/gacha.py backend/tests/test_gacha.py
git commit -m "feat(gacha): generate_pack turbo flag (battles only)"
```

---

### Task 4: build_create_ata helper

**Files:**
- Modify: `backend/app/services/solana_tx.py` (add `build_create_ata`)
- Test: `backend/tests/test_solana_tx.py`

**Interfaces:**
- Produces: `build_create_ata(owner_address: str, mint: str, recent_blockhash: str, *, payer: str = None, token_program: str = TOKEN_PROGRAM) -> str` — one CreateIdempotent ATA instruction for `owner_address`'s ATA of `mint`; fee payer = `payer` if given else owner.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_solana_tx.py`:

```python
def test_build_create_ata_single_idempotent_ix_operator_payer():
    from app.services.solana_tx import build_create_ata, ATA_PROGRAM, TOKEN_PROGRAM
    import base64
    from solders.transaction import Transaction
    from solders.pubkey import Pubkey
    from solders.token.associated import get_associated_token_address
    OWNER = "9oZgd4eviozqaYu7KwCTctAYgsRTWtF3McJARaztPsRQ"
    OP    = "A4ahkivAG4NoZAE8Sy4qv8nn2DU9yoXRQcttuCeGtTJv"
    USDC  = "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr"
    out = build_create_ata(OWNER, USDC, "11111111111111111111111111111111", payer=OP)
    tx = Transaction.from_bytes(base64.b64decode(out))
    keys = tx.message.account_keys
    assert keys[0] == Pubkey.from_string(OP)               # fee payer = operator
    assert len(tx.message.instructions) == 1
    ix = tx.message.instructions[0]
    assert keys[ix.program_id_index] == Pubkey.from_string(ATA_PROGRAM)
    assert bytes(ix.data) == bytes([1])                    # CreateIdempotent
    ata = get_associated_token_address(Pubkey.from_string(OWNER),
                                       Pubkey.from_string(USDC),
                                       Pubkey.from_string(TOKEN_PROGRAM))
    a = [str(keys[i]) for i in ix.accounts]
    assert a[1] == str(ata) and a[2] == OWNER              # ATA + its owner
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_solana_tx.py::test_build_create_ata_single_idempotent_ix_operator_payer -v`
Expected: FAIL with `ImportError: cannot import name 'build_create_ata'`.

- [ ] **Step 3: Write minimal implementation**

Append to `backend/app/services/solana_tx.py`:

```python
def build_create_ata(
    owner_address: str,
    mint: str,
    recent_blockhash: str,
    *,
    payer: str = None,
    token_program: str = TOKEN_PROGRAM,
) -> str:
    """Unsigned legacy tx with a single CreateIdempotent ATA instruction for
    owner_address's associated token account of `mint`. Fee payer = payer if given else owner.
    Used to pre-create the escrow's USDC ATA so CC's turbo auto-buyback payout does not revert."""
    owner_pk      = Pubkey.from_string(owner_address)
    mint_pk       = Pubkey.from_string(mint)
    token_prog_pk = Pubkey.from_string(token_program)
    ata_prog_pk   = Pubkey.from_string(ATA_PROGRAM)
    sys_prog_pk   = Pubkey.from_string(SYS_PROGRAM)
    payer_pk      = Pubkey.from_string(payer) if payer else owner_pk
    ata = get_associated_token_address(owner_pk, mint_pk, token_prog_pk)
    create_ix = Instruction(
        ata_prog_pk,
        bytes([1]),  # CreateIdempotent
        [
            AccountMeta(payer_pk,      is_signer=True,  is_writable=True),
            AccountMeta(ata,           is_signer=False, is_writable=True),
            AccountMeta(owner_pk,      is_signer=False, is_writable=False),
            AccountMeta(mint_pk,       is_signer=False, is_writable=False),
            AccountMeta(sys_prog_pk,   is_signer=False, is_writable=False),
            AccountMeta(token_prog_pk, is_signer=False, is_writable=False),
        ],
    )
    message = Message.new_with_blockhash([create_ix], payer_pk, Hash.from_string(recent_blockhash))
    return base64.b64encode(bytes(Transaction.new_unsigned(message))).decode()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_solana_tx.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/solana_tx.py backend/tests/test_solana_tx.py
git commit -m "feat(solana): build_create_ata (CreateIdempotent) helper"
```

---

### Task 5: Shared resilient settle helper

**Files:**
- Modify: `backend/app/services/pack_engine.py` (add `settle_cards_to_winner`; import `UnsupportedNftStandard`)
- Test: `backend/tests/test_settle.py`

**Interfaces:**
- Consumes: `_wait_in_escrow` (existing), `UnsupportedNftStandard` (from `nft_transfer`), `BattlePull` (with `auto_sold`/`transferred` from Task 2).
- Produces:
  ```python
  async def settle_cards_to_winner(session, battle, *, escrow_wallet_id, escrow_address, winner,
                                   build_transfer_tx, submit_tx, signer, confirm_in_escrow,
                                   build_usdc_sweep_tx, sleep_fn, wait_max_attempts, wait_delay,
                                   retries=3) -> None
  ```
  Transfers each `BattlePull` with `auto_sold==False and nft_address` to the winner (bounded retries; sets `transferred=True` on success; on `UnsupportedNftStandard` or exhausted retries leaves `transferred=False` and continues). Then, if `build_usdc_sweep_tx` is not None, sweeps the escrow USDC to the winner (bounded retries). Never raises.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_settle.py`:

```python
import pytest
from app.db import make_engine, make_session_factory, init_db
from app.models import PackBattle, BattlePull
from app.services.pack_engine import settle_cards_to_winner
from app.services.nft_transfer import UnsupportedNftStandard


@pytest.fixture
def session():
    engine = make_engine("sqlite:///:memory:"); init_db(engine)
    Session = make_session_factory(engine)
    with Session() as s:
        yield s


class _Signer:
    def __init__(self): self.signed = []
    async def sign_solana(self, wallet_id, tx):
        self.signed.append((wallet_id, tx)); return f"signed-{tx}"


async def _noslp(_): return None
async def _ce(esc, nft): return True


def _battle_with_pulls(session, pulls):
    b = PackBattle(id="b1", mode="pack", machine_code="m", price=50, max_players=4, status="running")
    session.add(b)
    for w, nft, auto in pulls:
        session.add(BattlePull(battle_id="b1", player_wallet=w, memo=f"m-{w}",
                               nft_address=nft, auto_sold=auto))
    session.commit()
    return b


@pytest.mark.asyncio
async def test_settle_transfers_non_autosold_and_sweeps_usdc(session):
    b = _battle_with_pulls(session, [("A", "nftA", False), ("B", "nftB", True), ("C", None, False)])
    transfers, sweeps = [], []
    async def btx(esc, dest, nft): transfers.append((dest, nft)); return f"tx-{nft}"
    async def sub(signed): return "sig"
    async def sweep(esc, winner): sweeps.append((esc, winner)); return "sweep-tx"
    await settle_cards_to_winner(session, b, escrow_wallet_id="eid", escrow_address="ESC", winner="A",
        build_transfer_tx=btx, submit_tx=sub, signer=_Signer(), confirm_in_escrow=_ce,
        build_usdc_sweep_tx=sweep, sleep_fn=_noslp, wait_max_attempts=2, wait_delay=0)
    # only the non-auto-sold pull with an nft was transferred
    assert transfers == [("A", "nftA")]
    assert sweeps == [("ESC", "A")]
    a = session.query(BattlePull).filter_by(player_wallet="A").first()
    bb = session.query(BattlePull).filter_by(player_wallet="B").first()
    assert a.transferred is True and bb.transferred is False


@pytest.mark.asyncio
async def test_settle_flags_unsupported_without_raising(session):
    b = _battle_with_pulls(session, [("A", "nftA", False)])
    async def btx(esc, dest, nft): raise UnsupportedNftStandard("cnft")
    async def sub(signed): return "sig"
    async def sweep(esc, winner): return None
    await settle_cards_to_winner(session, b, escrow_wallet_id="eid", escrow_address="ESC", winner="A",
        build_transfer_tx=btx, submit_tx=sub, signer=_Signer(), confirm_in_escrow=_ce,
        build_usdc_sweep_tx=sweep, sleep_fn=_noslp, wait_max_attempts=1, wait_delay=0)
    assert session.query(BattlePull).filter_by(player_wallet="A").first().transferred is False


@pytest.mark.asyncio
async def test_settle_retries_transient_then_flags(session):
    b = _battle_with_pulls(session, [("A", "nftA", False)])
    calls = {"n": 0}
    async def btx(esc, dest, nft):
        calls["n"] += 1; raise RuntimeError("rpc hiccup")
    async def sub(signed): return "sig"
    async def sweep(esc, winner): return None
    await settle_cards_to_winner(session, b, escrow_wallet_id="eid", escrow_address="ESC", winner="A",
        build_transfer_tx=btx, submit_tx=sub, signer=_Signer(), confirm_in_escrow=_ce,
        build_usdc_sweep_tx=sweep, sleep_fn=_noslp, wait_max_attempts=1, wait_delay=0, retries=3)
    assert calls["n"] == 3   # retried 3×
    assert session.query(BattlePull).filter_by(player_wallet="A").first().transferred is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_settle.py -v`
Expected: FAIL with `ImportError: cannot import name 'settle_cards_to_winner'`.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/services/pack_engine.py`, add the import near the top imports:

```python
from app.services.nft_transfer import UnsupportedNftStandard
```

Add the function (after `_wait_in_escrow`):

```python
async def settle_cards_to_winner(session, battle, *, escrow_wallet_id, escrow_address, winner,
                                 build_transfer_tx, submit_tx, signer, confirm_in_escrow,
                                 build_usdc_sweep_tx, sleep_fn, wait_max_attempts, wait_delay,
                                 retries=3) -> None:
    """Resilient settle (call ONLY after the winner is decided — never voids):
    transfer each non-auto-sold escrow NFT to the winner with bounded retries (set transferred=True
    on success; on UnsupportedNftStandard or exhausted retries leave transferred=False and continue),
    then sweep the escrow USDC to the winner. Never raises."""
    from app.models import BattlePull
    pulls = session.query(BattlePull).filter_by(battle_id=battle.id).all()
    for p in pulls:
        if p.auto_sold or not p.nft_address:
            continue
        for _ in range(retries):
            try:
                await _wait_in_escrow(confirm_in_escrow, escrow_address, p.nft_address,
                                      sleep_fn, wait_max_attempts, wait_delay)
                tx = await build_transfer_tx(escrow_address, winner, p.nft_address)
                signed = await signer.sign_solana(escrow_wallet_id, tx)
                await submit_tx(signed)
                p.transferred = True
                session.commit()
                break
            except UnsupportedNftStandard as exc:
                logger.warning("settle: unsupported nft %s in battle %s: %s — flagging",
                               p.nft_address, battle.id, exc)
                break
            except Exception as exc:
                logger.warning("settle transfer retry for %s in battle %s: %s",
                               p.nft_address, battle.id, exc)
                await sleep_fn(wait_delay)
    if build_usdc_sweep_tx is not None:
        for _ in range(retries):
            try:
                sweep = await build_usdc_sweep_tx(escrow_address, winner)
                if sweep:
                    signed = await signer.sign_solana(escrow_wallet_id, sweep)
                    await submit_tx(signed)
                break
            except Exception as exc:
                logger.warning("settle usdc sweep retry in battle %s: %s", battle.id, exc)
                await sleep_fn(wait_delay)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_settle.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/pack_engine.py backend/tests/test_settle.py
git commit -m "feat(engine): resilient settle_cards_to_winner (retries + flag, never voids)"
```

---

### Task 6: Pack Battle engine — turbo pulls + resilient settle

**Files:**
- Modify: `backend/app/services/pack_engine.py` (`PullOutcome`, `run_battle`, `_void_return`)
- Test: `backend/tests/test_pack_engine.py`

**Interfaces:**
- Consumes: `settle_cards_to_winner` (Task 5), `BattlePull.auto_sold/transferred` (Task 2), `generate_pack(turbo=...)` (Task 3).
- Produces: `PullOutcome` gains `auto_sold: bool = False`; `run_battle(...)` gains `build_usdc_sweep_tx=None`; pulls use `turbo=True`; settle delegates to `settle_cards_to_winner`; `_void_return` skips auto-sold pulls.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_pack_engine.py`:

```python
@pytest.mark.asyncio
async def test_run_battle_turbo_autosold_common_not_transferred(session):
    # A pulls a common CC auto-sells (no NFT to transfer); B pulls an epic kept in escrow → B wins.
    b = PackBattle(id="bt", mode="pack", machine_code="pokemon_50", price=50, max_players=2,
                   status="lobby", server_seed="ab" * 32)
    session.add(b)
    session.add_all([BattlePlayer(battle_id="bt", player_wallet="A"),
                     BattlePlayer(battle_id="bt", player_wallet="B")])
    session.commit()

    gacha = _Gacha({
        "A": {"nft_address": "nftA", "insured_value": 50, "grade": None, "rarity": "Common", "auto_sold": True},
        "B": {"nft_address": "nftB", "insured_value": 500, "grade": 9, "rarity": "Epic", "auto_sold": False},
    })
    signer = _Signer()
    transfers, sweeps = [], []
    async def btx(esc, dest, nft): transfers.append((dest, nft)); return f"tx-{nft}"
    async def sweep(esc, winner): sweeps.append(winner); return "sweep-tx"

    out = await run_battle(session, b, gacha=gacha, signer=signer,
        resolve_wallet_id=lambda w: f"id-{w}", build_transfer_tx=btx, submit_tx=_sub,
        prepare_escrow=lambda a: _noop(), confirm_in_escrow=_ce, can_play=lambda w: True,
        now_fn=lambda: __import__("datetime").datetime.now(),
        build_usdc_sweep_tx=sweep, sleep_fn=_noslp)

    assert out == "settled" and b.winner == "B"
    assert gacha.turbo is True                          # battles pull in turbo
    assert transfers == [("B", "nftB")]                 # only the kept epic transferred
    assert sweeps == ["B"]                              # USDC swept to winner
    a_pull = session.query(BattlePull).filter_by(battle_id="bt", player_wallet="A").first()
    assert a_pull.auto_sold is True and a_pull.transferred is False
```

Add these module-level helpers near the existing `_btx/_sub/_ce` in the test file (if not present):

```python
async def _noop(): return "ok"
async def _noslp(_): return None
```

And extend the `_Gacha` fake in `test_pack_engine.py` to record turbo and accept it:

```python
    async def generate_pack(self, player_address, pack_type, alt_player_address=None, turbo=False):
        self.alt = alt_player_address; self.turbo = turbo; self.pulled.append(player_address)
        return {"memo": f"m-{player_address}", "transaction": f"tx-{player_address}"}
```

(Initialise `self.turbo = None` in `_Gacha.__init__`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_pack_engine.py::test_run_battle_turbo_autosold_common_not_transferred -v`
Expected: FAIL — `run_battle()` has no `build_usdc_sweep_tx` kwarg (TypeError), or assertions fail.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/services/pack_engine.py`:

(a) Extend `PullOutcome`:

```python
@dataclass
class PullOutcome:
    player_wallet: str
    memo: str
    nft_address: str
    insured_value: float
    grade: Optional[int]
    auto_sold: bool = False
```

(b) Add `build_usdc_sweep_tx=None` to `run_battle`'s signature (after `sleep_fn=None`):

```python
async def run_battle(session, battle, *, gacha, signer, resolve_wallet_id, build_transfer_tx,
                     submit_tx, prepare_escrow, confirm_in_escrow, can_play, now_fn,
                     sponsor: bool = False,
                     open_max_attempts: int = 20, open_delay: float = 3.0,
                     escrow_max_attempts: int = 20, escrow_delay: float = 3.0,
                     sleep_fn=None, build_usdc_sweep_tx=None) -> str:
```

(c) In the pull loop, pass `turbo=True` and persist `auto_sold`. Replace the `generate_pack(...)` call and the result-persist block:

```python
            pack = await gacha.generate_pack(player_address=w, pack_type=battle.machine_code,
                                             alt_player_address=esc["address"], turbo=True)
```

and after `res` resolves:

```python
            pull.nft_address = res["nft_address"]
            pull.insured_value = res.get("insured_value") or 0
            pull.grade = res.get("grade")
            pull.rarity = res.get("rarity")
            pull.auto_sold = bool(res.get("auto_sold"))
            session.commit()
            outcomes.append(PullOutcome(w, pack["memo"], res["nft_address"],
                                        res.get("insured_value") or 0, res.get("grade"),
                                        auto_sold=bool(res.get("auto_sold"))))
```

(d) Replace the whole settle block (the `try: ... except ...` that determined the winner and looped transfers, lines ~110-130) with:

```python
    # Winner determination can still void (e.g. tie with no server_seed). Settle itself is resilient.
    try:
        client_seed = client_seed_from_nfts([o.nft_address for o in outcomes])
        winner, tie_idx = determine_winner(outcomes, server_seed=battle.server_seed, client_seed=client_seed)
    except Exception as exc:
        logger.warning("winner determination failed in battle %s: %s — voiding", battle.id, exc)
        await _void_return(signer, esc, outcomes, build_transfer_tx, submit_tx)
        battle.status = "voided"; session.commit(); return "voided"

    battle.client_seed = client_seed
    battle.tie_break_index = tie_idx
    session.commit()

    await settle_cards_to_winner(
        session, battle, escrow_wallet_id=esc["id"], escrow_address=esc["address"], winner=winner,
        build_transfer_tx=build_transfer_tx, submit_tx=submit_tx, signer=signer,
        confirm_in_escrow=confirm_in_escrow, build_usdc_sweep_tx=build_usdc_sweep_tx,
        sleep_fn=sleep_fn, wait_max_attempts=escrow_max_attempts, wait_delay=escrow_delay,
    )

    battle.winner = winner; battle.status = "settled"; battle.settled_at = now_fn()
    session.commit()
    return "settled"
```

(e) Make `_void_return` skip auto-sold pulls:

```python
async def _void_return(signer, esc, outcomes, build_transfer_tx, submit_tx):
    # Return each already-pulled NFT to its original puller (nobody robbed).
    # Auto-sold commons have no NFT to return (their USDC is in the escrow; refund is #3c).
    for o in outcomes:
        if o.auto_sold or not o.nft_address:
            continue
        try:
            tx = await build_transfer_tx(esc["address"], o.player_wallet, o.nft_address)
            signed = await signer.sign_solana(esc["id"], tx)
            await submit_tx(signed)
        except Exception:
            logger.warning("void-return transfer failed: escrow=%s nft=%s player=%s",
                           esc.get("id"), o.nft_address, o.player_wallet)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_pack_engine.py -v`
Expected: PASS (new test + existing tests still green — existing tests pass no `build_usdc_sweep_tx`, so the USDC sweep is skipped, and their non-auto-sold pulls still transfer).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/pack_engine.py backend/tests/test_pack_engine.py
git commit -m "feat(pack-engine): turbo pulls + resilient settle to winner"
```

---

### Task 7: Battle Royale engine — turbo pulls + resilient settle

**Files:**
- Modify: `backend/app/services/royale_engine.py` (`run_royale` pull loop + settle)
- Test: `backend/tests/test_royale_engine.py`

**Interfaces:**
- Consumes: `settle_cards_to_winner` (Task 5), `BattlePull.auto_sold/transferred/rarity` (Task 2), `generate_pack(turbo=...)` (Task 3).
- Produces: `run_royale(...)` gains `build_usdc_sweep_tx=None`; pulls use `turbo=True`; persists `rarity` + `auto_sold`; settle delegates to `settle_cards_to_winner`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_royale_engine.py` (mirror the existing fakes there; they expose `generate_pack`, `open_pack`, `submit_tx`):

```python
@pytest.mark.asyncio
async def test_run_royale_turbo_persists_rarity_and_resilient_settle(session):
    # Minimal 2-player royale: round 1, A pulls common (auto-sold), B pulls epic → A eliminated, B wins.
    b = PackBattle(id="r1", mode="royale", machine_code="pokemon_50", price=50, max_players=2,
                   status="running", server_seed="ab" * 32,
                   escrow_wallet_id="eid", escrow_address="ESC")
    session.add(b)
    session.add_all([BattlePlayer(battle_id="r1", player_wallet="A"),
                     BattlePlayer(battle_id="r1", player_wallet="B")])
    session.commit()

    opens = {
        "A": {"nft_address": "nftA", "insured_value": 50, "grade": None, "rarity": "Common", "auto_sold": True},
        "B": {"nft_address": "nftB", "insured_value": 500, "grade": 9, "rarity": "Epic", "auto_sold": False},
    }
    gacha = _RoyaleGacha(opens)          # existing fake in this test module
    signer = _RoyaleSigner()
    transfers, sweeps = [], []
    async def btx(esc, dest, nft): transfers.append((dest, nft)); return f"tx-{nft}"
    async def sweep(esc, winner): sweeps.append(winner); return "sweep-tx"
    async def distribute(esc, w, amt): return "dsig"
    async def confirm_usdc(w, amt): return True
    async def ce(esc, nft): return True
    async def prep(esc): return "ok"
    async def noslp(_): return None

    out = await run_royale(session, b, gacha=gacha, signer=signer,
        resolve_wallet_id=lambda w: f"id-{w}", distribute=distribute, confirm_usdc=confirm_usdc,
        confirm_in_escrow=ce, build_transfer_tx=btx, submit_tx=lambda s: _ok(), prepare_escrow=prep,
        price_base=50, now_fn=lambda: __import__("datetime").datetime.now(),
        sleep_fn=noslp, build_usdc_sweep_tx=sweep)

    assert out == "settled" and b.winner == "B"
    assert gacha.turbo is True
    assert transfers == [("B", "nftB")]      # only the kept epic
    assert sweeps == ["B"]
    a_pull = session.query(BattlePull).filter_by(battle_id="r1", player_wallet="A").first()
    assert a_pull.rarity == "Common" and a_pull.auto_sold is True
```

If `test_royale_engine.py` lacks a `_RoyaleGacha`/`_RoyaleSigner`/`_ok`, add minimal ones mirroring `_Gacha`/`_Signer` from `test_pack_engine.py`, where `generate_pack(..., turbo=False)` records `self.turbo`, `open_pack` returns `{"pending": False, **opens[wallet]}`, and `submit_tx` returns `{"signature": "ccsig"}`. Add `async def _ok(): return "ccsig"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_royale_engine.py::test_run_royale_turbo_persists_rarity_and_resilient_settle -v`
Expected: FAIL — `run_royale()` has no `build_usdc_sweep_tx` kwarg, or `rarity` not persisted.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/services/royale_engine.py`:

(a) Add the import at the top:

```python
from app.services.pack_engine import _wait_in_escrow, settle_cards_to_winner
```

(replace the existing `from app.services.pack_engine import _wait_in_escrow` line.)

(b) Add `build_usdc_sweep_tx=None` to `run_royale`'s signature (after `delay=3.0`):

```python
    sleep_fn=None, max_attempts=20, delay=3.0, build_usdc_sweep_tx=None,
```

(c) Pass `turbo=True` to the pull and persist `rarity` + `auto_sold`. Replace the `gacha.generate_pack(...)` call:

```python
                pack = await gacha.generate_pack(
                    player_address=w,
                    pack_type=battle.machine_code,
                    alt_player_address=esc["address"],
                    turbo=True,
                )
```

and the result-persist block (after `res` resolves):

```python
                pull.nft_address = res["nft_address"]
                pull.insured_value = res.get("insured_value") or 0
                pull.grade = res.get("grade")
                pull.rarity = res.get("rarity")
                pull.auto_sold = bool(res.get("auto_sold"))
                session.commit()
```

(d) Replace the settle block (lines that read `nfts = [...]` and the `for nft in nfts:` transfer loop) with:

```python
        # Settle: transfer all non-auto-sold escrow NFTs + the escrow USDC to the winner (resilient).
        winner = remaining[0]
        await settle_cards_to_winner(
            session, battle, escrow_wallet_id=esc["id"], escrow_address=esc["address"], winner=winner,
            build_transfer_tx=build_transfer_tx, submit_tx=submit_tx, signer=signer,
            confirm_in_escrow=confirm_in_escrow, build_usdc_sweep_tx=build_usdc_sweep_tx,
            sleep_fn=sleep_fn, wait_max_attempts=max_attempts, wait_delay=delay,
        )

        battle.winner = winner
        battle.status = "settled"
        battle.settled_at = now_fn()
        session.commit()
        return "settled"
```

Note: `sleep_fn` is normalised to `asyncio.sleep` at the top of `run_royale` already; `settle_cards_to_winner` receives that.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_royale_engine.py -v`
Expected: PASS (new test + existing royale tests still green).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/royale_engine.py backend/tests/test_royale_engine.py
git commit -m "feat(royale-engine): turbo pulls + resilient settle to winner"
```

---

### Task 8: Live wiring — USDC sweep builder + escrow USDC ATA pre-create

**Files:**
- Modify: `backend/app/services/pack_orchestration.py` (`run_pack_battle_live`, `run_royale_live`; imports)
- Test: `backend/tests/test_pack_orchestration.py`

**Interfaces:**
- Consumes: `build_create_ata` (Task 4), `build_token_transfer` (existing), `usdc_balance_base_units`/`fetch_latest_blockhash`/`seed_escrow`/`submit_signed_tx` (existing), `run_battle`/`run_royale` with `build_usdc_sweep_tx` (Tasks 6/7).
- Produces: both live runners build a `build_usdc_sweep_tx(esc_addr, winner_addr) -> str | None` closure and pass it to the engine; `run_pack_battle_live`'s `prepare_escrow` additionally pre-creates the escrow USDC ATA (operator-paid).

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_pack_orchestration.py`:

```python
@pytest.mark.asyncio
async def test_build_usdc_sweep_tx_zero_balance_returns_none(monkeypatch):
    import app.services.pack_orchestration as po
    captured = {}
    async def fake_run_battle(session, battle, **kw):
        captured["sweep"] = kw["build_usdc_sweep_tx"]; return "settled"
    monkeypatch.setattr(po, "run_battle", fake_run_battle)
    async def zero_bal(rpc, owner, mint, tp=None): return 0
    monkeypatch.setattr(po, "usdc_balance_base_units", zero_bal)

    class _S: pass
    await po.run_pack_battle_live(_FakeSession([]), _FakeBattle(), gacha=None, signer=None,
        rpc_url="http://x", usdc_mint="Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr",
        min_usdc_base_units=0)
    assert await captured["sweep"]("ESC", "WIN") is None     # 0 balance → None


@pytest.mark.asyncio
async def test_build_usdc_sweep_tx_positive_balance_builds_tx(monkeypatch):
    import app.services.pack_orchestration as po
    captured = {}
    async def fake_run_battle(session, battle, **kw):
        captured["sweep"] = kw["build_usdc_sweep_tx"]; return "settled"
    monkeypatch.setattr(po, "run_battle", fake_run_battle)
    async def bal(rpc, owner, mint, tp=None): return 42_500_000
    async def bh(rpc): return "11111111111111111111111111111111"
    monkeypatch.setattr(po, "usdc_balance_base_units", bal)
    monkeypatch.setattr(po, "fetch_latest_blockhash", bh)

    await po.run_pack_battle_live(_FakeSession([]), _FakeBattle(), gacha=None, signer=None,
        rpc_url="http://x", usdc_mint="Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr",
        min_usdc_base_units=0)
    out = await captured["sweep"]("9oZgd4eviozqaYu7KwCTctAYgsRTWtF3McJARaztPsRQ",
                                  "8QDBKx8P3pxkRhiqyXFtYcPPf2CM1F5NiE5A8yjkgtm6")
    assert isinstance(out, str) and len(out) > 0             # built a tx
```

Add these fakes at the top of the test file if absent:

```python
import pytest

class _FakeBattle:
    id = "b1"; mode = "pack"; machine_code = "pokemon_50"; price = 50
    escrow_wallet_id = "eid"; escrow_address = "ESC"; status = "lobby"

class _FakeSession:
    def __init__(self, players): self._players = players
    def query(self, *a, **k): return self
    def filter_by(self, **k): return self
    def order_by(self, *a, **k): return self
    def all(self): return self._players
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_pack_orchestration.py -k usdc_sweep -v`
Expected: FAIL — `run_battle` is called without `build_usdc_sweep_tx` (KeyError in the fake) or the closure is absent.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/services/pack_orchestration.py`:

(a) Extend the imports:

```python
from app.services.solana_tx import TOKEN_PROGRAM, build_token_transfer, build_create_ata
```

(b) In `run_pack_battle_live`, replace the `prepare_escrow` closure and add the sweep closure, then pass it to `run_battle`:

```python
    async def prepare_escrow(esc_addr):
        bh = await fetch_latest_blockhash(rpc_url)
        await seed_escrow(
            rpc_url, signer, operator_wallet_id, operator_address, esc_addr, seed_lamports, bh
        )
        # Pre-create the escrow's USDC ATA (operator pays) so CC's turbo auto-buyback payout
        # does not revert (CreateIdempotent would otherwise exhaust the payout tx's CU budget).
        bh2 = await fetch_latest_blockhash(rpc_url)
        ata_tx = build_create_ata(esc_addr, usdc_mint, bh2, payer=operator_address)
        signed = await signer.sign_solana(operator_wallet_id, ata_tx)
        return await submit_signed_tx(rpc_url, signed)

    async def build_usdc_sweep_tx(esc_addr, winner_addr):
        bal = await usdc_balance_base_units(rpc_url, esc_addr, usdc_mint, token_program)
        if bal <= 0:
            return None
        bh = await fetch_latest_blockhash(rpc_url)
        return build_token_transfer(esc_addr, winner_addr, usdc_mint, bh, amount=bal, decimals=6)
```

and add `build_usdc_sweep_tx=build_usdc_sweep_tx,` to the `run_battle(...)` call.

(c) In `run_royale_live`, add the same sweep closure (its `prepare_escrow` is unchanged — the royale escrow USDC ATA already exists from buy-ins):

```python
    async def build_usdc_sweep_tx(esc_addr, winner_addr):
        bal = await usdc_balance_base_units(rpc_url, esc_addr, usdc_mint)
        if bal <= 0:
            return None
        bh = await fetch_latest_blockhash(rpc_url)
        return build_token_transfer(esc_addr, winner_addr, usdc_mint, bh, amount=bal, decimals=6)
```

and add `build_usdc_sweep_tx=build_usdc_sweep_tx,` to the `run_royale(...)` call.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_pack_orchestration.py -v`
Expected: PASS.

- [ ] **Step 5: Run the full suite + commit**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest -q`
Expected: all green (the prior 202 + the new tests).

```bash
git add backend/app/services/pack_orchestration.py backend/tests/test_pack_orchestration.py
git commit -m "feat(wiring): USDC-sweep-to-winner builder + escrow USDC ATA pre-create"
```

---

## Self-Review

**1. Spec coverage:**
- Turbo pulls (`generate_pack(turbo=True)`) → Task 3 (flag) + Tasks 6/7 (engines pass it). ✓
- Auto-sold handling (excluded from transfer, still counts for ranking) → Tasks 6/7 + Task 5. ✓
- Pre-create escrow USDC ATA → Task 4 (builder) + Task 8 (pack prepare_escrow). ✓
- `build_core_transfer` + dispatcher `"core"` → Task 1. ✓
- Resilient settle (retries, flag, never void post-winner) + USDC→winner → Task 5 + Tasks 6/7. ✓
- Models `auto_sold`/`transferred`; persist `rarity` in royale → Task 2 + Task 7. ✓
- Void best-effort skips auto-sold; USDC refund deferred → Task 6 `_void_return` (royale `_void` already only marks voided). ✓
- No-goals (manual buyback, cNFT, #3c, UI, Helius) → not implemented. ✓

**2. Placeholder scan:** No TBD/TODO; every code step has complete code; every test has assertions. ✓

**3. Type consistency:** `build_core_transfer(..., *, collection)`, `read_core_collection(data)->Optional[Pubkey]`, `build_create_ata(..., *, payer=None)`, `settle_cards_to_winner(..., build_usdc_sweep_tx, ...)`, `PullOutcome.auto_sold`, `run_battle/run_royale(..., build_usdc_sweep_tx=None)`, wiring closure `build_usdc_sweep_tx(esc_addr, winner_addr)->str|None` — names/signatures match across Tasks 1/4/5/6/7/8. ✓
