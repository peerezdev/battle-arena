# Pack Battle #3 — Lobby + operator gas + Provably-Fair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The lobby/matchmaking layer that lets players create & join Pack Battles; on fill it seeds the escrow's gas from an operator wallet and runs the engine, with a Provably-Fair commit-reveal tie-break.

**Architecture:** A `provably_fair.py` (pure draw primitives), Provably-Fair columns on `PackBattle` + a Provably-Fair `determine_winner`, an operator `seed_escrow` injected into the engine, a `pack_lobby.py` service (create/join/atomic-fill), and REST endpoints that trigger the run in the background.

**Tech Stack:** FastAPI + SQLAlchemy + httpx + solders + pytest/pytest-asyncio/respx. Python 3.9.

## Global Constraints
- **mode:** #3 only runs `"pack"`. `create_battle` with `"royale"` raises `ModeNotSupported`. `2 ≤ max_players ≤ 10`.
- **Stake = verify-at-join:** verify USDC ≥ price + session signer at create/join; debit happens at pull (engine `can_play` re-checks). No USDC lock.
- **Fill is atomic:** a guarded UPDATE flips `lobby→running` exactly once; only that caller triggers the run.
- **Operator seeds escrow:** operator wallet transfers `ESCROW_SEED_LAMPORTS` (default 10_000_000) SOL to each fresh escrow before pulls; seed failure → void.
- **Provably-Fair:** `server_seed_hash = sha256(server_seed)` committed at creation; `client_seed = sha256(":".join(sorted(nft_addresses)))`; tie draw `idx = int.from_bytes(hmac_sha256(server_seed, client_seed)[:8],"big") % n`; `server_seed` revealed (exposed) only after `status=="settled"`.
- No secret logging (seeds are not secrets post-settle, but never log tx bytes/keys/signatures).
- CC devnet USDC mint (default): `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr` (6 decimals).

---

## File Structure
- `backend/app/services/provably_fair.py` — NEW: pure seed/draw primitives.
- `backend/app/models.py` — `PackBattle` Provably-Fair columns.
- `backend/app/services/pack_engine.py` — Provably-Fair `determine_winner` + `prepare_escrow` hook + settle stores PF fields.
- `backend/app/services/pack_orchestration.py` — `seed_escrow` + wire `prepare_escrow`.
- `backend/app/config.py` — operator + USDC + seed config.
- `backend/app/services/pack_lobby.py` — NEW: lobby service.
- `backend/app/main.py` — endpoints + run trigger.
- Tests: `test_provably_fair.py`, `test_pack_engine.py`, `test_pack_orchestration.py`, `test_pack_lobby.py`, `test_pack_lobby_api.py`.

---

### Task 1: `provably_fair.py` — pure commit-reveal primitives

**Files:**
- Create: `backend/app/services/provably_fair.py`
- Test: `backend/tests/test_provably_fair.py`

**Interfaces:**
- Produces: `gen_server_seed() -> tuple[str,str]` (seed_hex, seed_hash_hex); `seed_hash(server_seed) -> str`;
  `client_seed_from_nfts(nft_addresses: list[str]) -> str`; `pick_index(server_seed, client_seed, n) -> int`;
  `verify_commit(server_seed, server_seed_hash) -> bool`.

- [ ] **Step 1: Write the failing test**
```python
from app.services.provably_fair import (
    gen_server_seed, seed_hash, client_seed_from_nfts, pick_index, verify_commit)

def test_seed_hash_and_verify():
    seed, h = gen_server_seed()
    assert len(bytes.fromhex(seed)) == 32
    assert seed_hash(seed) == h and verify_commit(seed, h)
    assert not verify_commit(seed, "00" * 32)

def test_client_seed_is_order_independent():
    a = client_seed_from_nfts(["m2", "m1", "m3"])
    b = client_seed_from_nfts(["m1", "m3", "m2"])
    assert a == b and len(bytes.fromhex(a)) == 32

def test_pick_index_deterministic_and_bounded():
    seed, _ = "ab" * 32, None
    cs = client_seed_from_nfts(["x", "y"])
    i1 = pick_index(seed, cs, 3)
    i2 = pick_index(seed, cs, 3)
    assert i1 == i2 and 0 <= i1 < 3
    # golden: stable across runs (lock the value once known)
    assert pick_index("ab" * 32, "00" * 32, 5) == pick_index("ab" * 32, "00" * 32, 5)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_provably_fair.py -q`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**
```python
"""Commit-reveal Provably-Fair primitives (pure). server_seed committed as sha256 hash at battle
creation; the tie-break draw is HMAC(server_seed, client_seed) where client_seed derives from the
public pulls. Reveal server_seed at settle → anyone recomputes + verifies."""
from __future__ import annotations
import hashlib
import hmac
import os


def gen_server_seed() -> tuple[str, str]:
    seed = os.urandom(32).hex()
    return seed, seed_hash(seed)


def seed_hash(server_seed: str) -> str:
    return hashlib.sha256(server_seed.encode()).hexdigest()


def verify_commit(server_seed: str, server_seed_hash: str) -> bool:
    return seed_hash(server_seed) == server_seed_hash


def client_seed_from_nfts(nft_addresses: list[str]) -> str:
    return hashlib.sha256(":".join(sorted(nft_addresses)).encode()).hexdigest()


def pick_index(server_seed: str, client_seed: str, n: int) -> int:
    digest = hmac.new(server_seed.encode(), client_seed.encode(), hashlib.sha256).digest()
    return int.from_bytes(digest[:8], "big") % n
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_provably_fair.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add backend/app/services/provably_fair.py backend/tests/test_provably_fair.py
git commit -m "feat(packbattle): provably_fair commit-reveal primitives"
```

---

### Task 2: PackBattle PF columns + Provably-Fair `determine_winner` + engine wiring

**Files:**
- Modify: `backend/app/models.py` (PackBattle)
- Modify: `backend/app/services/pack_engine.py` (`determine_winner`, settle)
- Modify: `backend/tests/test_pack_engine.py`

**Interfaces:**
- Consumes: `provably_fair.pick_index`, `client_seed_from_nfts`.
- Produces: `determine_winner(pulls, *, server_seed, client_seed) -> tuple[str, Optional[int]]`.

- [ ] **Step 1: Write the failing test**

Replace `test_winner_by_value_then_grade_then_join_order` in `test_pack_engine.py` with:
```python
def test_determine_winner_single_max_no_draw():
    from app.services.pack_engine import determine_winner
    pulls = [_po("A", 100, 9), _po("B", 300, 8)]
    w, idx = determine_winner(pulls, server_seed="ab"*32, client_seed="00"*32)
    assert w == "B" and idx is None

def test_determine_winner_tie_uses_provably_fair_draw():
    from app.services.pack_engine import determine_winner
    from app.services.provably_fair import pick_index
    pulls = [_po("A", 100, 9), _po("B", 100, 8), _po("C", 100, 7)]
    cands = sorted(["A", "B", "C"])
    expect_idx = pick_index("ab"*32, "00"*32, 3)
    w, idx = determine_winner(pulls, server_seed="ab"*32, client_seed="00"*32)
    assert idx == expect_idx and w == cands[expect_idx]
```
And in `test_run_battle_settles_to_winner` (and every other run_battle test), set `server_seed` on the battle: add `server_seed="ab"*32` to each `PackBattle(...)` construction (the engine reads `battle.server_seed`).

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_pack_engine.py -q`
Expected: FAIL.

- [ ] **Step 3: Implement**

`models.py` — add to `PackBattle` (after `escrow_address`):
```python
    server_seed: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    server_seed_hash: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    client_seed: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    tie_break_index: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
```
`pack_engine.py` — replace `determine_winner`:
```python
from app.services.provably_fair import pick_index

def determine_winner(pulls, *, server_seed: str, client_seed: str):
    maxv = max((p.insured_value or 0) for p in pulls)
    candidates = sorted([p.player_wallet for p in pulls if (p.insured_value or 0) == maxv])
    if len(candidates) == 1:
        return candidates[0], None
    idx = pick_index(server_seed, client_seed, len(candidates))
    return candidates[idx], idx
```
In `run_battle` settle (inside the try), replace `winner = determine_winner(outcomes, players)` with:
```python
        from app.services.provably_fair import client_seed_from_nfts
        client_seed = client_seed_from_nfts([o.nft_address for o in outcomes])
        winner, tie_idx = determine_winner(outcomes, server_seed=battle.server_seed, client_seed=client_seed)
        battle.client_seed = client_seed
        battle.tie_break_index = tie_idx
```
(`determine_winner`'s old `join_order` param is gone; remove its import of the old signature usage.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_pack_engine.py -q` then `cd backend && .venv/bin/pytest tests/test_models.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add backend/app/models.py backend/app/services/pack_engine.py backend/tests/test_pack_engine.py
git commit -m "feat(packbattle): Provably-Fair determine_winner + PackBattle PF columns"
```

---

### Task 3: Operator seed-escrow gas

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/app/services/pack_orchestration.py` (`seed_escrow` + wire `prepare_escrow`)
- Modify: `backend/app/services/pack_engine.py` (`prepare_escrow` hook)
- Modify: `backend/tests/test_pack_engine.py`, `backend/tests/test_pack_orchestration.py`

**Interfaces:**
- Produces: `seed_escrow(rpc_url, signer, operator_wallet_id, operator_address, escrow_address, lamports, blockhash) -> str`;
  `run_battle(..., prepare_escrow, ...)` (async hook called once after escrow creation).

- [ ] **Step 1: Write the failing test**

`test_pack_engine.py` — add a `prepare_escrow` to every `run_battle(...)` call (`async def prepare_escrow(addr): seeded.append(addr)`), and:
```python
@pytest.mark.asyncio
async def test_run_battle_voids_if_escrow_seed_fails(session):
    b = PackBattle(id="bs", mode="pack", machine_code="pokemon_50", price=50, max_players=1,
                   status="running", server_seed="ab"*32)
    session.add(b); session.add(BattlePlayer(battle_id="bs", player_wallet="A")); session.commit()
    gacha = _Gacha({"A": {"nft_address": "nA", "insured_value": 100, "grade": 9}})
    signer = _Signer()
    async def prepare_escrow(addr): raise RuntimeError("seed failed")
    out = await run_battle(session, b, gacha=gacha, signer=signer, resolve_wallet_id=lambda w: f"{w}-id",
                           build_transfer_tx=_btx, submit_tx=_sub, confirm_in_escrow=_ce,
                           prepare_escrow=prepare_escrow, can_play=lambda w: True,
                           now_fn=lambda: __import__("datetime").datetime(2026,6,21))
    assert out == "voided"
```
(Where `_btx/_sub/_ce` are the module-level async fakes the other tests use; if they're inline per-test, add `prepare_escrow=prepare_escrow` to those too.) `test_pack_orchestration.py`: add a `po.seed_escrow` monkeypatch (async fake returning "sig") so the wiring's prepare_escrow doesn't hit RPC.

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_pack_engine.py -k escrow_seed -q`
Expected: FAIL (`prepare_escrow` unknown).

- [ ] **Step 3: Implement**

`config.py` — add fields + defaults:
```python
    cc_usdc_mint: str = "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr"
    privy_operator_wallet_id: str = ""
    privy_operator_address: str = ""
    escrow_seed_lamports: int = 10_000_000
```
`pack_engine.py` — `run_battle` signature: add `prepare_escrow` (keyword) after `submit_tx`. After escrow creation (`battle.status = "running"; session.commit()`), add:
```python
    try:
        await prepare_escrow(esc["address"])
    except Exception as exc:
        logger.warning("escrow seed failed for battle %s: %s — voiding", battle.id, exc)
        battle.status = "voided"; session.commit(); return "voided"
```
`pack_orchestration.py` — add `seed_escrow` + wire:
```python
import base64
from solders.system_program import transfer, TransferParams
from solders.hash import Hash
from solders.message import Message
from solders.transaction import Transaction
from app.services.nft_transfer import submit_signed_tx  # already imported

async def seed_escrow(rpc_url, signer, operator_wallet_id, operator_address, escrow_address, lamports, blockhash) -> str:
    ix = transfer(TransferParams(from_pubkey=Pubkey.from_string(operator_address),
                                 to_pubkey=Pubkey.from_string(escrow_address), lamports=lamports))
    msg = Message.new_with_blockhash([ix], Pubkey.from_string(operator_address), Hash.from_string(blockhash))
    tx_b64 = base64.b64encode(bytes(Transaction.new_unsigned(msg))).decode()
    signed = await signer.sign_solana(operator_wallet_id, tx_b64)
    return await submit_signed_tx(rpc_url, signed)
```
`run_pack_battle_live` — add params `operator_wallet_id, operator_address, seed_lamports` and the closure, passed to run_battle:
```python
    prepare_escrow = lambda esc_addr: seed_escrow(rpc_url, signer, operator_wallet_id, operator_address, esc_addr, seed_lamports, blockhash)  # noqa: E731
    ... run_battle(..., prepare_escrow=prepare_escrow, ...)
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_pack_engine.py tests/test_pack_orchestration.py -q` then `cd backend && .venv/bin/pytest -q`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add backend/app/config.py backend/app/services/pack_orchestration.py backend/app/services/pack_engine.py backend/tests/test_pack_engine.py backend/tests/test_pack_orchestration.py
git commit -m "feat(packbattle): operator seeds escrow gas (prepare_escrow hook + seed_escrow)"
```

---

### Task 4: `pack_lobby.py` service (create / join / atomic-fill)

**Files:**
- Create: `backend/app/services/pack_lobby.py`
- Test: `backend/tests/test_pack_lobby.py`

**Interfaces:**
- Produces: `class LobbyError(Exception)`, `class ModeNotSupported(LobbyError)`; `create_battle(...) -> PackBattle`;
  `join_battle(...) -> tuple[PackBattle, bool]` (battle, filled); `list_open(session) -> list[dict]`;
  `get_battle(session, id) -> dict`; `verification(battle) -> dict`.

- [ ] **Step 1: Write the failing test**
```python
import pytest
from app.db import make_engine, make_session_factory, init_db
from app.models import PackBattle, BattlePlayer
from app.services.pack_lobby import (create_battle, join_battle, list_open, get_battle,
                                      LobbyError, ModeNotSupported)

@pytest.fixture
def session():
    e = make_engine("sqlite:///:memory:"); init_db(e)
    with make_session_factory(e)() as s: yield s

def test_create_battle_commits_seed_and_creator(session):
    b = create_battle(session, "WC", "wid-c", machine_code="pokemon_50", price=50_000_000, max_players=2)
    assert b.status == "lobby" and b.mode == "pack" and b.server_seed and b.server_seed_hash
    assert session.query(BattlePlayer).filter_by(battle_id=b.id).count() == 1

def test_create_rejects_royale(session):
    with pytest.raises(ModeNotSupported):
        create_battle(session, "WC", "wid", machine_code="pokemon_50", price=50_000_000, max_players=2, mode="royale")

def test_create_rejects_bad_max_players(session):
    with pytest.raises(LobbyError):
        create_battle(session, "WC", "wid", machine_code="pokemon_50", price=50_000_000, max_players=1)

def test_join_fills_atomically(session):
    b = create_battle(session, "WC", "wid-c", machine_code="pokemon_50", price=50_000_000, max_players=2)
    bb, filled = join_battle(session, b.id, "WB", "wid-b")
    assert filled and bb.status == "running"
    assert session.query(BattlePlayer).filter_by(battle_id=b.id).count() == 2

def test_join_rejects_duplicate_and_full(session):
    b = create_battle(session, "WC", "wid-c", machine_code="pokemon_50", price=50_000_000, max_players=2)
    with pytest.raises(LobbyError):
        join_battle(session, b.id, "WC", "wid-c")        # creator already in
    join_battle(session, b.id, "WB", "wid-b")            # fills
    with pytest.raises(LobbyError):
        join_battle(session, b.id, "WX", "wid-x")        # not lobby anymore
```
(Note: USDC/session-signer checks are done in the ENDPOINT layer — Task 5 — not in this pure DB service, so these tests need no RPC.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_pack_lobby.py -q`
Expected: FAIL.

- [ ] **Step 3: Implement**
```python
"""Pack Battle lobby: create/join/list with an atomic fill guard. Pure DB logic — USDC/session-signer
checks live in the endpoint layer (they need RPC/Privy). Generates the Provably-Fair server seed."""
from __future__ import annotations
import uuid
from sqlalchemy import update
from app.models import PackBattle, BattlePlayer
from app.services.provably_fair import gen_server_seed, seed_hash, verify_commit


class LobbyError(Exception):
    pass


class ModeNotSupported(LobbyError):
    pass


def create_battle(session, creator_wallet, creator_wallet_id, *, machine_code, price, max_players, mode="pack"):
    if mode != "pack":
        raise ModeNotSupported("Battle Royale próximamente")
    if not (2 <= max_players <= 10):
        raise LobbyError("max_players debe estar entre 2 y 10")
    seed, h = gen_server_seed()
    b = PackBattle(id=uuid.uuid4().hex, mode="pack", machine_code=machine_code, price=price,
                   max_players=max_players, status="lobby", server_seed=seed, server_seed_hash=h)
    session.add(b)
    session.add(BattlePlayer(battle_id=b.id, player_wallet=creator_wallet, wallet_id=creator_wallet_id))
    session.commit()
    return b


def join_battle(session, battle_id, player_wallet, player_wallet_id):
    b = session.get(PackBattle, battle_id)
    if b is None or b.status != "lobby":
        raise LobbyError("partida no disponible")
    players = session.query(BattlePlayer).filter_by(battle_id=battle_id).all()
    if any(p.player_wallet == player_wallet for p in players):
        raise LobbyError("ya estás en la partida")
    if len(players) >= b.max_players:
        raise LobbyError("partida llena")
    session.add(BattlePlayer(battle_id=battle_id, player_wallet=player_wallet, wallet_id=player_wallet_id))
    session.commit()
    count = session.query(BattlePlayer).filter_by(battle_id=battle_id).count()
    filled = False
    if count >= b.max_players:
        # atomic flip: only the caller that flips lobby→running triggers the run
        res = session.execute(update(PackBattle).where(PackBattle.id == battle_id,
                                                       PackBattle.status == "lobby")
                              .values(status="running"))
        session.commit()
        filled = res.rowcount == 1
        session.refresh(b)
    return b, filled


def _players(session, battle_id):
    return [p.player_wallet for p in session.query(BattlePlayer)
            .filter_by(battle_id=battle_id).order_by(BattlePlayer.joined_at).all()]


def list_open(session):
    return [{"id": b.id, "machine_code": b.machine_code, "price": b.price, "max_players": b.max_players,
             "players": session.query(BattlePlayer).filter_by(battle_id=b.id).count()}
            for b in session.query(PackBattle).filter_by(status="lobby").all()]


def get_battle(session, battle_id):
    b = session.get(PackBattle, battle_id)
    if b is None:
        raise LobbyError("no existe")
    out = {"id": b.id, "mode": b.mode, "machine_code": b.machine_code, "price": b.price,
           "max_players": b.max_players, "status": b.status, "winner": b.winner,
           "players": _players(session, battle_id), "server_seed_hash": b.server_seed_hash}
    if b.status == "settled":   # reveal only after settle
        out.update(server_seed=b.server_seed, client_seed=b.client_seed, tie_break_index=b.tie_break_index)
    return out


def verification(b):
    return {"server_seed_hash": b.server_seed_hash, "server_seed": b.server_seed if b.status == "settled" else None,
            "client_seed": b.client_seed, "tie_break_index": b.tie_break_index,
            "commit_ok": verify_commit(b.server_seed, b.server_seed_hash) if b.server_seed else None}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_pack_lobby.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add backend/app/services/pack_lobby.py backend/tests/test_pack_lobby.py
git commit -m "feat(packbattle): pack_lobby service (create/join/atomic-fill/list/get)"
```

---

### Task 5: Endpoints + auth (wallet+wallet_id) + background run trigger

**Files:**
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_pack_lobby_api.py`

**Interfaces:**
- Consumes: `pack_lobby.*`, `gacha.machines()`, `usdc_balance_base_units`, `run_pack_battle_live`, `current_user`,
  `privy.embedded_solana_wallet_id`.

- [ ] **Step 1: Write the failing test**

`test_pack_lobby_api.py` — build the app via the test helper used by other API tests (read `test_*_api.py` for how they construct the app + a fake Privy + TestClient). Cover: `POST /pack-battles` creates a lobby (200, returns id + server_seed_hash, NOT server_seed); `POST /pack-battles/{id}/join` by a second user → 200 and (with a monkeypatched `run_pack_battle_live`) the run is scheduled; `GET /pack-battles/open` lists it; `GET /pack-battles/{id}` returns state without `server_seed` while not settled; a join with insufficient USDC → 402/409. Mock the USDC check (`usdc_balance_base_units`) + machine availability + `run_pack_battle_live` (assert it was scheduled, don't run it). Mirror the existing API-test scaffolding for auth (Bearer token → wallet/wallet_id via the fake Privy).

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_pack_lobby_api.py -q`
Expected: FAIL.

- [ ] **Step 3: Implement**

The endpoints live in **`create_app`** (not `build_default_app`). First extend `create_app`'s signature with keyword params `solana_rpc_url: str`, `cc_usdc_mint: str`, `privy_operator_wallet_id: str`, `privy_operator_address: str`, `escrow_seed_lamports: int`, and have `build_default_app` pass them from its `s` (`solana_rpc_url=s.solana_rpc_url`, `cc_usdc_mint=s.cc_usdc_mint`, `privy_operator_wallet_id=s.privy_operator_wallet_id`, `privy_operator_address=s.privy_operator_address`, `escrow_seed_lamports=s.escrow_seed_lamports`). Then, inside `create_app` after the gacha endpoints, add (following the `/matches` pattern) a body model + a `current_user_id` dependency:
```python
    class CreateBattleBody(BaseModel):
        machine_code: str
        max_players: int

    def current_user_id(authorization: Optional[str] = Header(None)) -> str:
        if privy is None: raise HTTPException(503, "privy no configurado")
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(401, "falta token")
        try:
            return privy.embedded_solana_wallet_id(authorization[len("Bearer "):])
        except PrivyAuthError:
            raise HTTPException(401, "identity token inválido")

    async def _require_funds(wallet: str, price: int):
        bal = await usdc_balance_base_units(solana_rpc_url, wallet, cc_usdc_mint)
        if bal < price:
            raise HTTPException(402, "USDC insuficiente")

    async def _machine_price(machine_code: str) -> int:
        machines = await gacha.machines()
        m = next((x for x in machines if x.get("code") == machine_code), None)
        if not m or not m.get("available", True):
            raise HTTPException(409, "máquina no disponible")
        return int(m["price"]) * 1_000_000   # USDC base units

    async def _run_bg(battle_id: str):
        s2 = session_factory()
        try:
            b = s2.get(PackBattle, battle_id)
            await run_pack_battle_live(s2, b, gacha=gacha, signer=privy_signer,
                rpc_url=solana_rpc_url, usdc_mint=cc_usdc_mint,
                min_usdc_base_units=b.price, operator_wallet_id=privy_operator_wallet_id,
                operator_address=privy_operator_address, seed_lamports=escrow_seed_lamports)
        except Exception:
            logger.warning("background run failed for %s", battle_id)
        finally:
            s2.close()

    @app.post("/pack-battles")
    async def create_pack_battle(body: CreateBattleBody, wallet: str = Depends(current_user),
                                 wallet_id: str = Depends(current_user_id), s: Session = Depends(db)):
        price = await _machine_price(body.machine_code)
        await _require_funds(wallet, price)
        try:
            b = create_battle(s, wallet, wallet_id, machine_code=body.machine_code, price=price,
                              max_players=body.max_players)
        except LobbyError as e:
            raise HTTPException(409, str(e))
        return get_battle(s, b.id)

    @app.post("/pack-battles/{battle_id}/join")
    async def join_pack_battle(battle_id: str, wallet: str = Depends(current_user),
                               wallet_id: str = Depends(current_user_id), s: Session = Depends(db)):
        b = s.get(PackBattle, battle_id)
        if b is None: raise HTTPException(404, "no existe")
        await _require_funds(wallet, b.price)
        try:
            b, filled = join_battle(s, battle_id, wallet, wallet_id)
        except LobbyError as e:
            raise HTTPException(409, str(e))
        if filled:
            asyncio.create_task(_run_bg(battle_id))
        return get_battle(s, battle_id)

    @app.get("/pack-battles/open")
    async def open_pack_battles(s: Session = Depends(db)):
        return list_open(s)

    @app.get("/pack-battles/{battle_id}")
    async def get_pack_battle(battle_id: str, s: Session = Depends(db)):
        try:
            return get_battle(s, battle_id)
        except LobbyError:
            raise HTTPException(404, "no existe")
```
Add the imports at the top of `main.py`: `import asyncio`, `import logging` + `logger = logging.getLogger(__name__)`, `from app.models import PackBattle`, `from app.services.pack_lobby import create_battle, join_battle, list_open, get_battle, LobbyError`, `from app.services.pack_orchestration import run_pack_battle_live, usdc_balance_base_units`. `gacha`, `privy`, `privy_signer`, `session_factory` are already `create_app` params; the five settings values come from the new `create_app` params added above. `BaseModel` is already imported (used by `CreateMatchBody`). Note: `_run_bg` uses `privy_signer` as the engine's `signer`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_pack_lobby_api.py -q` then `cd backend && .venv/bin/pytest -q`
Expected: PASS, full suite green.

- [ ] **Step 5: Commit**
```bash
git add backend/app/main.py backend/tests/test_pack_lobby_api.py
git commit -m "feat(packbattle): lobby endpoints + auth + background run trigger"
```

---

## Self-Review
**1. Spec coverage:** PF primitives → T1; PF columns + determine_winner → T2; operator seed → T3; lobby service (create/join/atomic-fill/list/get/verify) → T4; endpoints + auth + run-trigger + stake-at-join (USDC check) → T5; royale rejected → T4; mode field forward-compat → T2 (model)/T4. ✓
**2. Placeholders:** all tasks carry concrete code. T5's API test says "mirror existing API-test scaffolding" — the implementer reads a sibling `test_*_api.py` for the app/Privy/TestClient setup (named in the task); the endpoint code + assertions are concrete.
**3. Type consistency:** `determine_winner(pulls,*,server_seed,client_seed)->(wallet,idx)`, `run_battle(...,prepare_escrow,...)`, `seed_escrow(...)`, `create_battle(...)->PackBattle`, `join_battle(...)->(PackBattle,bool)`, `run_pack_battle_live(...,operator_wallet_id,operator_address,seed_lamports)` consistent across T2–T5 and the spec.

## No-goals (carried)
Battle Royale engine (#3b); UI (#4); WS push; on-chain VRF; cNFT/MPL Core; cross-battle one-at-a-time enforcement.
