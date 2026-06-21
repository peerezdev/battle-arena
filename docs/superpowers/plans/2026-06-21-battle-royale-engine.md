# Battle Royale #3b — multi-round engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Battle Royale mode — flat buy-in into a pool, per-round per-player on-chain pulls, eliminate the lowest accumulated `insuredValue` each round (Provably-Fair tie-break), winner takes all cards.

**Architecture:** Funding primitives (buy-in math + a generalized SPL token transfer + USDC distribute/collect/confirm), model additions (per-round + accumulation + a `BattleRound` audit table), a `royale_engine.run_royale` multi-round loop with injected I/O, and lobby/wiring integration that enables `mode="royale"`.

**Tech Stack:** FastAPI + SQLAlchemy + solders 0.27 + httpx + respx + pytest/pytest-asyncio. Python 3.9.

## Global Constraints
- **Buy-in (flat):** `total_pulls(N) = N(N+1)/2 − 1`; `buy_in_base = ceil(total_pulls(N) × price_base / N)` (round up; remainder → winner). Collected at join into the escrow pool.
- **Every pull is on-chain with the player's own wallet** (the pool funds the player just-in-time each round).
- **Provably-Fair per round:** one `server_seed` (committed at creation); per-round `client_seed = sha256(f"{round}:" + ":".join(sorted(round_nft_addresses)))`; eliminate `sorted(tied_losers)[pick_index(server_seed, client_seed, n)]`.
- **Buy-in collection** is a 2-signer tx: source = player (USDC authority, via session signer), fee-payer = operator (has SOL, via quorum). **Distribution** (escrow→player) is single-signer (escrow, seeded with SOL).
- **Void (v1):** any distribution/pull/settle failure → best-effort refund the escrow's remaining USDC to players + mark `voided` + log; already-pulled cards stay in escrow (ops). No perfect partial unwind.
- No secret logging. CC devnet USDC mint default `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr` (6 decimals).

---

## File Structure
- `backend/app/services/solana_tx.py` — generalize to `build_token_transfer(amount, decimals, fee_payer)`; `build_nft_transfer` becomes a thin wrapper.
- `backend/app/services/royale_funding.py` — NEW: `royale_buyin`, `distribute_usdc`, `collect_buyin`, `confirm_usdc`.
- `backend/app/services/provably_fair.py` — add `client_seed_round`.
- `backend/app/models.py` — `BattlePlayer` + `BattlePull` columns; new `BattleRound`.
- `backend/app/services/royale_engine.py` — NEW: `run_royale`.
- `backend/app/services/pack_lobby.py` + `pack_orchestration.py` + `main.py` — enable royale (escrow-at-creation, buy-in collection, run dispatch).
- Tests: `test_royale_funding.py`, `test_royale_engine.py`, `test_solana_tx.py` (extend), `test_pack_lobby.py` (extend), `test_provably_fair.py` (extend).

---

### Task 1: Funding primitives (buy-in math + generalized SPL transfer + USDC distribute/collect/confirm)

**Files:**
- Modify: `backend/app/services/solana_tx.py`
- Create: `backend/app/services/royale_funding.py`
- Test: `backend/tests/test_solana_tx.py`, `backend/tests/test_royale_funding.py`

**Interfaces:**
- Produces: `build_token_transfer(source, dest, mint, recent_blockhash, *, amount=1, decimals=0, fee_payer=None, token_program=TOKEN_PROGRAM) -> str`;
  `royale_buyin(n, price_base) -> int`; `total_pulls(n) -> int`;
  `distribute_usdc(rpc_url, signer, escrow_wallet_id, escrow_address, player_address, usdc_mint, amount, blockhash) -> str`;
  `collect_buyin(rpc_url, signer, player_wallet_id, player_address, operator_wallet_id, operator_address, escrow_address, usdc_mint, amount, blockhash) -> str`;
  `confirm_usdc(rpc_url, owner, usdc_mint, min_base_units) -> bool`.

- [ ] **Step 1: Write failing tests**

`test_solana_tx.py` (append): generalized transfer keeps the NFT case + adds a USDC case.
```python
def test_build_token_transfer_usdc_amount_decimals_and_feepayer():
    from app.services.solana_tx import build_token_transfer, TOKEN_PROGRAM
    import base64
    from solders.transaction import Transaction
    from solders.pubkey import Pubkey
    ESCROW="9oZgd4eviozqaYu7KwCTctAYgsRTWtF3McJARaztPsRQ"
    PLAYER="8QDBKx8P3pxkRhiqyXFtYcPPf2CM1F5NiE5A8yjkgtm6"
    OP="A4ahkivAG4NoZAE8Sy4qv8nn2DU9yoXRQcttuCeGtTJv"
    USDC="Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr"
    out = build_token_transfer(PLAYER, ESCROW, USDC, "11111111111111111111111111111111",
                               amount=50_000_000, decimals=6, fee_payer=OP)
    tx = Transaction.from_bytes(base64.b64decode(out))
    keys = tx.message.account_keys
    assert keys[0] == Pubkey.from_string(OP)   # fee payer = operator
    tok = Pubkey.from_string(TOKEN_PROGRAM)
    ix = next(i for i in tx.message.instructions if keys[i.program_id_index] == tok)
    assert bytes(ix.data) == bytes([12]) + (50_000_000).to_bytes(8,"little") + bytes([6])
```
`test_royale_funding.py`:
```python
from app.services.royale_funding import royale_buyin, total_pulls

def test_total_pulls():
    assert total_pulls(4) == 9 and total_pulls(10) == 54 and total_pulls(2) == 2

def test_royale_buyin_rounds_up():
    assert royale_buyin(4, 50_000_000) == 112_500_000      # 9*50/4 = 112.5 USDC (exact)
    assert royale_buyin(10, 50_000_000) == 270_000_000     # 54*50/10 = 270 USDC
    assert royale_buyin(3, 50_000_000) == 83_333_334       # ceil(5*50/3)=83.333334 USDC
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_solana_tx.py -k token_transfer tests/test_royale_funding.py -q`
Expected: FAIL.

- [ ] **Step 3: Implement**

`solana_tx.py` — generalize. Rename the body to `build_token_transfer` with `amount`/`decimals`/`fee_payer`; `build_nft_transfer` calls it with `amount=1, decimals=0`:
```python
def build_token_transfer(source_address, dest_address, mint, recent_blockhash, *,
                         amount=1, decimals=0, fee_payer=None, token_program=TOKEN_PROGRAM) -> str:
    src_pk = Pubkey.from_string(source_address); dest_pk = Pubkey.from_string(dest_address)
    mint_pk = Pubkey.from_string(mint); token_prog_pk = Pubkey.from_string(token_program)
    payer_pk = Pubkey.from_string(fee_payer) if fee_payer else src_pk
    ata_prog_pk = Pubkey.from_string(ATA_PROGRAM); sys_prog_pk = Pubkey.from_string(SYS_PROGRAM)
    src_ata = get_associated_token_address(src_pk, mint_pk, token_prog_pk)
    dest_ata = get_associated_token_address(dest_pk, mint_pk, token_prog_pk)
    create_ix = Instruction(ata_prog_pk, bytes([1]), [
        AccountMeta(payer_pk, is_signer=True, is_writable=True),
        AccountMeta(dest_ata, is_signer=False, is_writable=True),
        AccountMeta(dest_pk, is_signer=False, is_writable=False),
        AccountMeta(mint_pk, is_signer=False, is_writable=False),
        AccountMeta(sys_prog_pk, is_signer=False, is_writable=False),
        AccountMeta(token_prog_pk, is_signer=False, is_writable=False)])
    transfer_data = bytes([12]) + (amount).to_bytes(8, "little") + bytes([decimals])
    transfer_ix = Instruction(token_prog_pk, transfer_data, [
        AccountMeta(src_ata, is_signer=False, is_writable=True),
        AccountMeta(mint_pk, is_signer=False, is_writable=False),
        AccountMeta(dest_ata, is_signer=False, is_writable=True),
        AccountMeta(src_pk, is_signer=True, is_writable=False)])    # source owner = transfer authority
    message = Message.new_with_blockhash([create_ix, transfer_ix], payer_pk, Hash.from_string(recent_blockhash))
    return base64.b64encode(bytes(Transaction.new_unsigned(message))).decode()

def build_nft_transfer(escrow_address, dest_address, mint, recent_blockhash, token_program=TOKEN_PROGRAM) -> str:
    return build_token_transfer(escrow_address, dest_address, mint, recent_blockhash,
                                amount=1, decimals=0, token_program=token_program)
```
(For a 2-signer tx, both `payer_pk` (fee payer) and `src_pk` (authority) are marked `is_signer=True`; solders dedupes and the message header will require 2 signatures.)

`royale_funding.py`:
```python
"""Battle Royale USDC funding: buy-in math + pool distribute/collect/confirm. Pulls themselves are
paid by each player's wallet (funded just-in-time from the pool)."""
from __future__ import annotations
import math
import httpx
from solders.pubkey import Pubkey
from solders.token.associated import get_associated_token_address
from app.services.solana_tx import build_token_transfer, TOKEN_PROGRAM
from app.services.nft_transfer import submit_signed_tx


def total_pulls(n: int) -> int:
    return n * (n + 1) // 2 - 1


def royale_buyin(n: int, price_base: int) -> int:
    return math.ceil(total_pulls(n) * price_base / n)


async def confirm_usdc(rpc_url: str, owner: str, usdc_mint: str, min_base_units: int) -> bool:
    ata = str(get_associated_token_address(Pubkey.from_string(owner), Pubkey.from_string(usdc_mint)))
    async with httpx.AsyncClient() as c:
        r = await c.post(rpc_url, json={"jsonrpc": "2.0", "id": 1, "method": "getTokenAccountBalance",
                                        "params": [ata, {"commitment": "confirmed"}]}, timeout=20)
        r.raise_for_status(); d = r.json()
    if "error" in d:
        return False
    v = (d.get("result") or {}).get("value")
    try:
        return v is not None and int(v["amount"]) >= min_base_units
    except (KeyError, ValueError, TypeError):
        return False


async def distribute_usdc(rpc_url, signer, escrow_wallet_id, escrow_address, player_address,
                          usdc_mint, amount, blockhash) -> str:
    tx = build_token_transfer(escrow_address, player_address, usdc_mint, blockhash, amount=amount, decimals=6)
    signed = await signer.sign_solana(escrow_wallet_id, tx)   # escrow (has SOL) is sole signer/fee-payer
    return await submit_signed_tx(rpc_url, signed)


async def collect_buyin(rpc_url, signer, player_wallet_id, player_address, operator_wallet_id,
                        operator_address, escrow_address, usdc_mint, amount, blockhash) -> str:
    # 2-signer: player = USDC authority, operator = fee-payer (player has no SOL).
    tx = build_token_transfer(player_address, escrow_address, usdc_mint, blockhash,
                              amount=amount, decimals=6, fee_payer=operator_address)
    signed = await signer.sign_solana(player_wallet_id, tx)        # player authorizes the USDC move
    signed = await signer.sign_solana(operator_wallet_id, signed)  # operator pays the fee
    return await submit_signed_tx(rpc_url, signed)
```
**Implementer note:** confirm `signer.sign_solana` adds a signature to an already-partially-signed base64 tx (Privy `signTransaction` does). If a second sign replaces rather than appends, fall back to building+signing per-key with solders is NOT possible (keys are in the TEE) — instead verify Privy's behavior; the live Task is gated, but the unit test mocks `sign_solana` to record both calls.

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_solana_tx.py tests/test_royale_funding.py -q` then `cd backend && .venv/bin/pytest -q`
Expected: PASS (the existing `build_nft_transfer` tests still pass via the wrapper).

- [ ] **Step 5: Commit**
```bash
git add backend/app/services/solana_tx.py backend/app/services/royale_funding.py backend/tests/test_solana_tx.py backend/tests/test_royale_funding.py
git commit -m "feat(royale): buy-in math + generalized token transfer + USDC distribute/collect/confirm"
```

---

### Task 2: Models + per-round client_seed

**Files:**
- Modify: `backend/app/models.py`, `backend/app/services/provably_fair.py`
- Test: `backend/tests/test_models.py`, `backend/tests/test_provably_fair.py`

**Interfaces:**
- Produces: `BattlePlayer.eliminated_round`/`accumulated_value`; `BattlePull.round_number`; `class BattleRound`;
  `provably_fair.client_seed_round(round_number, nft_addresses) -> str`.

- [ ] **Step 1: Write failing tests**

`test_provably_fair.py` (append):
```python
def test_client_seed_round_order_independent_and_round_sensitive():
    from app.services.provably_fair import client_seed_round
    a = client_seed_round(2, ["m2", "m1"]); b = client_seed_round(2, ["m1", "m2"])
    assert a == b
    assert client_seed_round(1, ["m1", "m2"]) != client_seed_round(2, ["m1", "m2"])
```
`test_models.py` (append):
```python
def test_royale_model_columns(session):
    from app.models import PackBattle, BattlePlayer, BattlePull, BattleRound
    session.add(PackBattle(id="r1", mode="royale", machine_code="pokemon_50", price=50_000_000, max_players=4, status="lobby"))
    session.add(BattlePlayer(battle_id="r1", player_wallet="A", eliminated_round=1, accumulated_value=10.0))
    session.add(BattlePull(battle_id="r1", player_wallet="A", memo="m", round_number=2))
    session.add(BattleRound(battle_id="r1", round_number=1, client_seed="cs", eliminated_wallet="A", tie_break_index=None))
    session.commit()
    assert session.query(BattleRound).filter_by(battle_id="r1").one().eliminated_wallet == "A"
    assert session.get(BattlePlayer, session.query(BattlePlayer).filter_by(battle_id="r1").one().id).accumulated_value == 10.0
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_models.py -k royale_model tests/test_provably_fair.py -k client_seed_round -q`
Expected: FAIL.

- [ ] **Step 3: Implement**

`provably_fair.py` (append):
```python
def client_seed_round(round_number: int, nft_addresses: list[str]) -> str:
    return hashlib.sha256((f"{round_number}:" + ":".join(sorted(nft_addresses))).encode()).hexdigest()
```
`models.py` — `BattlePlayer` add: `eliminated_round: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)`,
`accumulated_value: Mapped[float] = mapped_column(Float, default=0.0)`. `BattlePull` add:
`round_number: Mapped[int] = mapped_column(Integer, default=1)`. New model:
```python
class BattleRound(Base):
    __tablename__ = "battle_rounds"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    battle_id: Mapped[str] = mapped_column(String, index=True)
    round_number: Mapped[int] = mapped_column(Integer)
    client_seed: Mapped[str] = mapped_column(String)
    eliminated_wallet: Mapped[str] = mapped_column(String)
    tie_break_index: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
```
(Ensure `Float` is imported in models.py — it already is from the earlier PF columns.)

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_models.py tests/test_provably_fair.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add backend/app/models.py backend/app/services/provably_fair.py backend/tests/test_models.py backend/tests/test_provably_fair.py
git commit -m "feat(royale): models (rounds/accumulation/BattleRound) + per-round client_seed"
```

---

### Task 3: `royale_engine.run_royale` (multi-round loop)

**Files:**
- Create: `backend/app/services/royale_engine.py`
- Test: `backend/tests/test_royale_engine.py`

**Interfaces:**
- Consumes: `gacha`, `signer`, `resolve_wallet_id`, `distribute_usdc`(injected callable `(escrow_addr, player_addr, amount) -> awaitable`), `confirm_usdc`(injected `(player_addr, min) -> awaitable bool`), `confirm_in_escrow`, `build_transfer_tx`, `submit_tx`, `prepare_escrow`, `now_fn`, `sleep_fn`; `price_base`; the battle's `server_seed`; `provably_fair.client_seed_round`/`pick_index`.
- Produces: `async run_royale(session, battle, *, gacha, signer, resolve_wallet_id, distribute, confirm_usdc, confirm_in_escrow, build_transfer_tx, submit_tx, prepare_escrow, price_base, now_fn, sleep_fn=None, max_attempts=20, delay=3.0) -> str` ("settled"|"voided").

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_royale_engine.py` (mirror `test_pack_engine.py`'s session fixture + fakes):
```python
import pytest
from app.db import make_engine, make_session_factory, init_db
from app.models import PackBattle, BattlePlayer, BattlePull, BattleRound
from app.services.royale_engine import run_royale

@pytest.fixture
def session():
    e = make_engine("sqlite:///:memory:"); init_db(e)
    with make_session_factory(e)() as s: yield s

class _Gacha:
    """opens: (wallet, round) -> value. Pull memo encodes wallet+round."""
    def __init__(self, opens): self.opens = opens
    async def generate_pack(self, player_address, pack_type, alt_player_address=None):
        return {"memo": f"m-{player_address}", "transaction": "tx"}
    async def submit_tx(self, signed): return {"signature": "s", "confirmation_status": "confirmed"}
    async def open_pack(self, memo):
        w = memo.split("m-")[1]
        return {"pending": False, "nft_address": f"nft-{w}-{self.opens['_r']}", "insured_value": self.opens[(w, self.opens['_r'])], "grade": 9}

class _Signer:
    def __init__(self): self.signed=[]
    async def sign_solana(self, wid, tx): self.signed.append((wid,tx)); return f"sig-{tx}"

def _mk(session, bid, players, values, server_seed="ab"*32, max_players=None):
    session.add(PackBattle(id=bid, mode="royale", machine_code="pokemon_50", price=50_000_000,
                           max_players=max_players or len(players), status="running", server_seed=server_seed))
    for w in players: session.add(BattlePlayer(battle_id=bid, player_wallet=w))
    session.commit()

@pytest.mark.asyncio
async def test_royale_eliminates_lowest_each_round_until_winner(session):
    # 3 players. Round1 values A=10,B=20,C=30 -> A out. Round2 B=5(acc25),C=5(acc35) -> B out. C wins.
    vals = {("A",1):10,("B",1):20,("C",1):30,("B",2):5,("C",2):5}
    g = _Gacha({**vals, "_r":1})
    _mk(session, "r1", ["A","B","C"], vals)
    seeded=[]; built=[]; submits=[]; dists=[]
    async def distribute(esc, p, amt): dists.append((p,amt))
    async def confirm_usdc(p, m): return True
    async def confirm_in_escrow(esc, nft): return True
    async def build_transfer_tx(esc, dest, nft): built.append((dest,nft)); return f"x-{nft}"
    async def submit_tx(s): submits.append(s); return "sig"
    async def prepare_escrow(addr): seeded.append(addr)
    # advance the gacha "round" pointer as the engine progresses: monkeypatch open_pack via _r
    # (simplest: make _Gacha read round from memo; here we drive _r through a wrapper)
    rounds = {"n":0}
    orig_open = g.open_pack
    async def open_pack(memo):
        return await orig_open(memo)
    g.open_pack = open_pack
    # Use a signer whose escrow create returns a real-ish escrow
    class S(_Signer):
        async def create_solana_wallet(self): return {"id":"esc","address":"ESC"}
    signer = S()
    out = await run_royale(session, session.get(PackBattle,"r1"), gacha=g, signer=signer,
        resolve_wallet_id=lambda w: f"{w}-id", distribute=distribute, confirm_usdc=confirm_usdc,
        confirm_in_escrow=confirm_in_escrow, build_transfer_tx=build_transfer_tx, submit_tx=submit_tx,
        prepare_escrow=prepare_escrow, price_base=50_000_000,
        now_fn=lambda: __import__("datetime").datetime(2026,6,21), sleep_fn=lambda d: _noop())
    assert out == "settled"
    assert session.get(PackBattle,"r1").winner == "C"
```
**NOTE to implementer:** the test above sketches the harness; the round-indexed `open_pack` is fiddly with a stateful `_Gacha`. Build a clean fake where `generate_pack`/`open_pack` are driven by an explicit per-call round counter the engine increments, OR have `_Gacha.open_pack` return values from a queue keyed by (wallet, call-order). The REQUIRED assertions: result `"settled"`, `winner == "C"`, an eliminated player per round recorded in `BattleRound`, and `distribute` called before each pull. Also add: a forced-tie test (two players tie at the min → `BattleRound.tie_break_index` is set and the eliminated one matches `sorted(tied)[pick_index(...)]`), and a void test (a `confirm_usdc` that returns False → `"voided"`).

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_royale_engine.py -q`
Expected: FAIL.

- [ ] **Step 3: Implement**
```python
"""Battle Royale multi-round engine. Injected I/O for unit-testing. Pool funds each player just-in-time;
each player pays their own pull on-chain; eliminate the lowest accumulated insured_value each round
(Provably-Fair tie-break); winner takes all escrow cards."""
from __future__ import annotations
import asyncio
import logging
from app.models import BattlePlayer, BattlePull, BattleRound
from app.services.provably_fair import client_seed_round, pick_index
from app.services.pack_engine import _wait_in_escrow   # reuse the escrow-confirm poll

logger = logging.getLogger(__name__)


async def run_royale(session, battle, *, gacha, signer, resolve_wallet_id, distribute, confirm_usdc,
                     confirm_in_escrow, build_transfer_tx, submit_tx, prepare_escrow, price_base,
                     now_fn, sleep_fn=None, max_attempts=20, delay=3.0) -> str:
    sleep_fn = sleep_fn or asyncio.sleep
    players = [p.player_wallet for p in session.query(BattlePlayer)
               .filter_by(battle_id=battle.id).order_by(BattlePlayer.joined_at).all()]
    esc = await signer.create_solana_wallet()
    battle.escrow_wallet_id = esc["id"]; battle.escrow_address = esc["address"]; session.commit()
    try:
        await prepare_escrow(esc["address"])
    except Exception as exc:
        logger.warning("royale escrow seed failed %s: %s", battle.id, exc)
        return await _void(session, battle)

    remaining = list(players)
    accumulated = {w: 0.0 for w in players}
    round_number = 0
    try:
        while len(remaining) > 1:
            round_number += 1
            round_nfts = []
            for w in remaining:
                await distribute(esc["address"], w, price_base)
                for _ in range(max_attempts):
                    if await confirm_usdc(w, price_base):
                        break
                    await sleep_fn(delay)
                else:
                    raise RuntimeError(f"usdc not delivered to {w}")
                pack = await gacha.generate_pack(player_address=w, pack_type=battle.machine_code,
                                                 alt_player_address=esc["address"])
                pull = BattlePull(battle_id=battle.id, player_wallet=w, memo=pack["memo"], round_number=round_number)
                session.add(pull); session.commit()
                signed = await signer.sign_solana(resolve_wallet_id(w), pack["transaction"])
                sub = await gacha.submit_tx(signed)
                if not sub.get("signature"):
                    raise RuntimeError("pull submit failed")
                res = await gacha.open_pack(pack["memo"])
                attempts = 0
                while res.get("pending") and attempts < max_attempts:
                    await sleep_fn(delay); res = await gacha.open_pack(pack["memo"]); attempts += 1
                if res.get("pending") or not res.get("nft_address"):
                    raise RuntimeError("pull did not resolve")
                pull.nft_address = res["nft_address"]; pull.insured_value = res.get("insured_value") or 0
                pull.grade = res.get("grade"); session.commit()
                accumulated[w] += res.get("insured_value") or 0
                round_nfts.append(res["nft_address"])
            # eliminate lowest accumulated
            minv = min(accumulated[w] for w in remaining)
            losers = sorted([w for w in remaining if accumulated[w] == minv])
            if len(losers) == 1:
                elim, tie_idx, cs = losers[0], None, ""
            else:
                cs = client_seed_round(round_number, round_nfts)
                tie_idx = pick_index(battle.server_seed, cs, len(losers))
                elim = losers[tie_idx]
            remaining.remove(elim)
            bp = session.query(BattlePlayer).filter_by(battle_id=battle.id, player_wallet=elim).first()
            bp.eliminated_round = round_number
            for w in remaining + [elim]:
                p = session.query(BattlePlayer).filter_by(battle_id=battle.id, player_wallet=w).first()
                p.accumulated_value = accumulated[w]
            session.add(BattleRound(battle_id=battle.id, round_number=round_number, client_seed=cs,
                                    eliminated_wallet=elim, tie_break_index=tie_idx))
            session.commit()
        # settle: all escrow cards → winner
        winner = remaining[0]
        nfts = [p.nft_address for p in session.query(BattlePull).filter_by(battle_id=battle.id).all() if p.nft_address]
        for nft in nfts:
            await _wait_in_escrow(confirm_in_escrow, esc["address"], nft, sleep_fn, max_attempts, delay)
            tx = await build_transfer_tx(esc["address"], winner, nft)
            signed = await signer.sign_solana(esc["id"], tx)
            await submit_tx(signed)
        battle.winner = winner; battle.status = "settled"; battle.settled_at = now_fn(); session.commit()
        return "settled"
    except Exception as exc:
        logger.warning("royale failed %s: %s — voiding", battle.id, exc)
        return await _void(session, battle)


async def _void(session, battle) -> str:
    # v1: best-effort — mark voided; refund is handled by the wiring (has the operator/refund deps).
    battle.status = "voided"; session.commit()
    return "voided"
```
**Implementer note:** `_void` here only marks the battle; the actual USDC refund (escrow→players) needs the funding deps and is done in the wiring layer (Task 4) when `run_royale` returns `"voided"`. Keep `_void` minimal in the engine.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_royale_engine.py -q` then `cd backend && .venv/bin/pytest -q`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add backend/app/services/royale_engine.py backend/tests/test_royale_engine.py
git commit -m "feat(royale): run_royale multi-round engine (distribute→pull→eliminate→settle, PF ties)"
```

---

### Task 4: Lobby + wiring + endpoint (enable royale end-to-end)

**Files:**
- Modify: `backend/app/services/pack_lobby.py`, `backend/app/services/pack_orchestration.py`, `backend/app/main.py`
- Test: `backend/tests/test_pack_lobby.py`, `backend/tests/test_pack_lobby_api.py`

**Interfaces:**
- Consumes: `royale_buyin`, `collect_buyin`, `distribute_usdc`, `confirm_usdc`, `run_royale`, the existing lobby + wiring.
- Produces: royale-enabled `create_battle`/`join_battle`; `run_royale_live(...)`; endpoint dispatch by `mode`.

- [ ] **Step 1: Write failing tests**

`test_pack_lobby.py` (append): royale create no longer rejected; it computes the buy-in + creates the escrow placeholder; the model stores `mode="royale"`.
```python
def test_create_royale_allowed_and_sets_buyin(session, monkeypatch):
    from app.services import pack_lobby
    b = pack_lobby.create_battle(session, "WC", "wid-c", machine_code="pokemon_50",
                                 price=50_000_000, max_players=4, mode="royale")
    assert b.mode == "royale" and b.status == "lobby"
```
(The buy-in is computed at the endpoint/wiring layer from `royale_buyin(max_players, price)`; the service just stores the battle. If you store the buy-in on the battle, assert it; otherwise assert mode/status.)
Plus an API test in `test_pack_lobby_api.py`: a royale create returns 200 with the computed buy-in; join collects it (monkeypatch `collect_buyin`); fill dispatches `run_royale_live` (monkeypatched, asserted scheduled).

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_pack_lobby.py -k royale tests/test_pack_lobby_api.py -k royale -q`
Expected: FAIL.

- [ ] **Step 3: Implement**

`pack_lobby.py`: in `create_battle`, allow `mode in ("pack","royale")` (drop the hard `ModeNotSupported` for royale; keep it for any other value). Store `mode`. `join_battle` is mode-agnostic (the buy-in collection happens in the endpoint before/after the DB join). `get_battle` already returns `mode`.

`pack_orchestration.py`: add `run_royale_live(session, battle, *, gacha, signer, rpc_url, usdc_mint, operator_wallet_id, operator_address, seed_lamports, price_base, buyin_base)` mirroring `run_pack_battle_live` but: pre-fetch blockhash; build `distribute = lambda esc, p, amt: distribute_usdc(rpc_url, signer, battle.escrow_wallet_id, esc, p, usdc_mint, amt, blockhash)`; `confirm_usdc_cb = lambda p, m: confirm_usdc(rpc_url, p, usdc_mint, m)`; `confirm_in_escrow`/`build_transfer_tx`/`submit_tx`/`prepare_escrow` as in the pack wiring; then `await run_royale(session, battle, ..., distribute=distribute, confirm_usdc=confirm_usdc_cb, price_base=price_base, ...)`. (Import `run_royale`, `distribute_usdc`, `confirm_usdc`.)

`main.py`: in `create_pack_battle`, accept an optional `mode` in the body (default `"pack"`); for `"royale"` compute `buyin = royale_buyin(body.max_players, price)`, create the battle, **create the escrow now** (so buy-ins can be collected), and return the buy-in. In `join_pack_battle`, after the DB join (or for royale specifically), **collect the buy-in** (`collect_buyin(...)` via the operator) into the escrow; on a `filled` royale join, schedule `_run_royale_bg(battle_id)` (parallels `_run_bg`, calling `run_royale_live`). Reuse `_machine_price`; the funds check for royale verifies USDC ≥ buy-in (not price).

**Implementer note:** the escrow for royale must exist at creation. Add a small helper that calls `signer.create_solana_wallet()` and stores `escrow_wallet_id`/`escrow_address` on the battle at royale-create time. The pack flow keeps creating the escrow inside `run_battle`; only royale pre-creates it (for buy-in collection). Document this divergence in a comment.

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_pack_lobby.py tests/test_pack_lobby_api.py -q` then `cd backend && .venv/bin/pytest -q`
Expected: PASS, full suite green.

- [ ] **Step 5: Commit**
```bash
git add backend/app/services/pack_lobby.py backend/app/services/pack_orchestration.py backend/app/main.py backend/tests/test_pack_lobby.py backend/tests/test_pack_lobby_api.py
git commit -m "feat(royale): enable mode=royale end-to-end (buy-in collect, escrow-at-create, run_royale dispatch)"
```

---

## Self-Review
**1. Spec coverage:** buy-in math → T1; generalized transfer + distribute/collect/confirm → T1; models + per-round PF → T2; multi-round engine (distribute→pull→accumulate→eliminate→PF tie→settle, void) → T3; lobby royale + buy-in collection + escrow-at-create + run dispatch → T4. ✓
**2. Placeholders:** T1–T3 carry concrete code. T3's test harness is sketched with an explicit implementer note (the round-indexed fake gacha is fiddly) + the REQUIRED assertions enumerated. T4's lobby/wiring/endpoint steps describe concrete edits referencing the existing `run_pack_battle_live`/`_run_bg` patterns (mirrored, not re-pasted) + the escrow-at-create divergence flagged.
**3. Type consistency:** `build_token_transfer(...,amount,decimals,fee_payer)`, `royale_buyin(n,price_base)->int`, `distribute_usdc`/`collect_buyin`/`confirm_usdc`, `run_royale(...,distribute,confirm_usdc,price_base,...)`, `client_seed_round`, `BattleRound` consistent across T1–T4 and the spec.

## No-goals (carried)
Perfect partial-tournament refund (v1 best-effort); UI (#4); reserved-balance (#3c); cNFT/MPL Core; on-chain VRF; live devnet run.
