# Pack Battle #2 — Escrow + orchestration engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The backend engine that runs a filled battle server-side — each player pulls (NFT → per-battle escrow), highest `insured_value` wins, all escrow NFTs transfer to the winner — all via the verified delegated-signing path with Privy gas sponsorship.

**Architecture:** New SQLAlchemy models (`PackBattle`/`BattlePlayer`/`BattlePull`); the gacha service gains an `alt_player_address`; `PrivySigner` gains `sponsor` + `create_solana_wallet`; a `pack_engine.run_battle` orchestrates pulls→open→winner→settle with all I/O injected so it is unit-tested with mocks. Live devnet integration is a separate gated task.

**Tech Stack:** FastAPI + SQLAlchemy + httpx + solders + pytest (backend).

## Global Constraints

- One **Privy server-wallet escrow per battle**, owner = our key quorum; created at run start; holds only NFTs (non-turbo).
- Pulls use `altPlayerAddress = escrow` → player never holds the NFT.
- Winner = max `insured_value`; tiebreak `grade`, then earliest `joined_at`.
- **Gas sponsorship**: every tx WE broadcast uses `sponsor=True` (players need only USDC).
- **Abandonment = void, no charge**: a player who can't pull at run time voids the battle; any NFT already pulled is returned to its puller (nobody robbed).
- Engine I/O (gacha, signer, wallet-id resolver, transfer-tx builder) is **injected** → unit-tested with mocks; no live calls in tests.
- Backend only (lobby/endpoints = #3, UI = #4). `PRIVY_*` secrets stay server-side.

---

## File Structure
- `backend/app/models.py` — add `PackBattle`, `BattlePlayer`, `BattlePull`.
- `backend/app/services/gacha.py` — `generate_pack` gains `alt_player_address`.
- `backend/app/services/privy_signer.py` — `sign_and_send_solana(..., sponsor)` + `create_solana_wallet`.
- `backend/app/services/pack_engine.py` — `determine_winner` + `run_battle` (injected I/O).
- `backend/tests/test_pack_engine.py`, `test_gacha_api.py`, `test_privy_signer.py` — tests.

---

### Task 1: Models — `PackBattle`, `BattlePlayer`, `BattlePull`

**Files:**
- Modify: `backend/app/models.py` (append after `GachaPack`)
- Test: `backend/tests/test_models.py`

**Interfaces:**
- Produces: the three ORM models (columns below), used by the engine + #3.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_models.py` (it already builds an in-memory engine via the existing fixtures — mirror them):

```python
def test_pack_battle_models_persist(session):
    from app.models import PackBattle, BattlePlayer, BattlePull
    b = PackBattle(id="b1", mode="pack", machine_code="pokemon_50", price=50, max_players=3, status="lobby")
    session.add(b)
    session.add(BattlePlayer(battle_id="b1", player_wallet="W1"))
    session.add(BattlePull(battle_id="b1", player_wallet="W1", memo="m1"))
    session.commit()
    got = session.get(PackBattle, "b1")
    assert got.status == "lobby" and got.max_players == 3 and got.winner is None
    assert session.query(BattlePull).filter_by(battle_id="b1").one().memo == "m1"
```
(If `test_models.py` has no `session` fixture, use the same in-memory-engine setup the other model tests use — read the file first.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_models.py::test_pack_battle_models_persist -q`
Expected: FAIL (models not defined).

- [ ] **Step 3: Add the models**

Append to `backend/app/models.py`:

```python
class PackBattle(Base):
    __tablename__ = "pack_battles"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    mode: Mapped[str] = mapped_column(String)  # pack|royale
    machine_code: Mapped[str] = mapped_column(String)
    price: Mapped[int] = mapped_column(Integer)  # USDC base units
    max_players: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String, default="lobby", index=True)  # lobby|running|settled|voided
    winner: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    escrow_wallet_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    escrow_address: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    settled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class BattlePlayer(Base):
    __tablename__ = "battle_players"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    battle_id: Mapped[str] = mapped_column(String, index=True)
    player_wallet: Mapped[str] = mapped_column(String, index=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class BattlePull(Base):
    __tablename__ = "battle_pulls"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    battle_id: Mapped[str] = mapped_column(String, index=True)
    player_wallet: Mapped[str] = mapped_column(String, index=True)
    memo: Mapped[str] = mapped_column(String)
    nft_address: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    insured_value: Mapped[Optional[float]] = mapped_column(nullable=True)
    grade: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    rarity: Mapped[Optional[str]] = mapped_column(String, nullable=True)
```
(Add `Float` to the SQLAlchemy import line if `insured_value` needs it: `from sqlalchemy import String, Integer, Boolean, DateTime, Index, func, Float` and type it `Mapped[Optional[float]] = mapped_column(Float, nullable=True)`.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_models.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/tests/test_models.py
git commit -m "feat(packbattle): PackBattle/BattlePlayer/BattlePull models"
```

---

### Task 2: Gacha — `generate_pack` accepts `alt_player_address`

**Files:**
- Modify: `backend/app/services/gacha.py` (`generate_pack` ~line 111-114)
- Test: `backend/tests/test_gacha_api.py`

**Interfaces:**
- Produces: `GachaService.generate_pack(self, player_address, pack_type, alt_player_address: str | None = None) -> {"memo","transaction"}` — forwards `altPlayerAddress` to CC only when set.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_gacha_api.py`:

```python
@respx.mock
@pytest.mark.asyncio
async def test_generate_pack_forwards_alt_player_address():
    from app.services.gacha import GachaService
    route = respx.post(f"{BASE}/api/generatePack").mock(
        return_value=Response(200, json={"memo": "m", "transaction": "T"}))
    svc = GachaService(base_url=BASE, api_key="")
    await svc.generate_pack(player_address="P", pack_type="pokemon_50", alt_player_address="ESCROW")
    sent = json.loads(route.calls.last.request.content)
    assert sent == {"playerAddress": "P", "packType": "pokemon_50", "altPlayerAddress": "ESCROW"}

@respx.mock
@pytest.mark.asyncio
async def test_generate_pack_omits_alt_when_none():
    from app.services.gacha import GachaService
    route = respx.post(f"{BASE}/api/generatePack").mock(
        return_value=Response(200, json={"memo": "m", "transaction": "T"}))
    svc = GachaService(base_url=BASE, api_key="")
    await svc.generate_pack(player_address="P", pack_type="pokemon_50")
    sent = json.loads(route.calls.last.request.content)
    assert "altPlayerAddress" not in sent
```
(These are `@pytest.mark.asyncio`; `test_gacha.py` already uses that pattern.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_gacha_api.py -k alt_player -q`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `backend/app/services/gacha.py`, change `generate_pack`:

```python
    async def generate_pack(self, player_address: str, pack_type: str,
                            alt_player_address: str | None = None) -> dict:
        body = {"playerAddress": player_address, "packType": pack_type}
        if alt_player_address:
            body["altPlayerAddress"] = alt_player_address
        raw = await self._request("POST", "/api/generatePack", json=body)
        return {"memo": raw.get("memo"), "transaction": raw.get("transaction")}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_gacha_api.py -k "alt_player or generate_pack" -q`
Expected: PASS (the existing `gacha_generate` endpoint still passes — it calls `generate_pack(player_address=wallet, pack_type=...)` with no alt, unchanged).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/gacha.py backend/tests/test_gacha_api.py
git commit -m "feat(gacha): generate_pack forwards optional altPlayerAddress"
```

---

### Task 3: PrivySigner — `sponsor` + `create_solana_wallet`

**Files:**
- Modify: `backend/app/services/privy_signer.py`
- Test: `backend/tests/test_privy_signer.py`

**Interfaces:**
- Produces:
  - `PrivySigner.sign_and_send_solana(self, wallet_id, tx_base64, sponsor: bool = False) -> str` (adds `"sponsor": True` to the RPC body when set)
  - `PrivySigner.create_solana_wallet(self) -> {"id": str, "address": str}` (POST `/v1/wallets`, owner = key quorum)

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_privy_signer.py`:

```python
@respx.mock
@pytest.mark.asyncio
async def test_sign_and_send_sponsor_flag():
    pem, _ = _p256_pem()
    route = respx.post("https://api.privy.io/v1/wallets/w1/rpc").mock(
        return_value=Response(200, json={"data": {"hash": "H"}}))
    s = PrivySigner(app_id="a", app_secret="s", auth_key_pem=pem, cluster_caip2="solana:dev")
    await s.sign_and_send_solana("w1", "TX", sponsor=True)
    assert json.loads(route.calls.last.request.content)["sponsor"] is True

@respx.mock
@pytest.mark.asyncio
async def test_create_solana_wallet():
    pem, _ = _p256_pem()
    route = respx.post("https://api.privy.io/v1/wallets").mock(
        return_value=Response(200, json={"id": "wid", "address": "ADDR", "chain_type": "solana"}))
    s = PrivySigner(app_id="a", app_secret="s", auth_key_pem=pem, cluster_caip2="solana:dev",
                    quorum_id="kq1")
    out = await s.create_solana_wallet()
    assert out == {"id": "wid", "address": "ADDR"}
    sent = json.loads(route.calls.last.request.content)
    assert sent["chain_type"] == "solana" and sent["owner_id"] == "kq1"
```
(`_p256_pem` is the helper added in #1's `test_privy_signer.py`.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_privy_signer.py -k "sponsor or create_solana" -q`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `backend/app/services/privy_signer.py`: add a `quorum_id: str = ""` constructor param (stored as `self._quorum_id`). Add `sponsor` to `sign_and_send_solana`:

```python
    async def sign_and_send_solana(self, wallet_id: str, tx_base64: str, sponsor: bool = False) -> str:
        if not self.enabled:
            raise PrivySignerError("privy signer disabled (PRIVY_AUTH_KEY unset)")
        url = f"{self._base}/v1/wallets/{wallet_id}/rpc"
        body = {"method": "signAndSendTransaction", "caip2": self._caip2,
                "params": {"transaction": tx_base64, "encoding": "base64"}}
        if sponsor:
            body["sponsor"] = True
        return await self._post_rpc(url, body, key="data")  # returns data.hash
```
Refactor the existing POST+auth-sig+error logic into a private `async def _post_rpc(self, url, body, key) -> ...` so both methods reuse it; `sign_and_send_solana` returns `data["hash"]`. Add:

```python
    async def create_solana_wallet(self) -> dict:
        url = f"{self._base}/v1/wallets"
        body = {"chain_type": "solana", "owner_id": self._quorum_id}
        data = await self._post_rpc_raw(url, body)
        return {"id": data.get("id"), "address": data.get("address")}
```
(`_post_rpc_raw` does the same auth-signed POST but returns the full JSON; both `_post_rpc` and `_post_rpc_raw` build the `privy-authorization-signature` via `authorization_signature(...)`. Keep the no-logging invariant.) Wire `quorum_id` from a new `PRIVY_QUORUM_ID` setting in `config.py` + `build_default_app` (mirror the other privy settings). **NOTE for impl:** confirm the exact `/v1/wallets` create-body field for the owner (`owner_id` vs `owner` vs a `key_quorum_id`) against the live Privy API in Task 5; the test asserts `owner_id` per the current API reference.

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_privy_signer.py -q`
Expected: PASS (the existing #1 tests still pass — the refactor preserves `sign_and_send_solana`'s output).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/privy_signer.py backend/app/config.py backend/app/main.py backend/tests/test_privy_signer.py
git commit -m "feat(packbattle): PrivySigner sponsor flag + create_solana_wallet (escrow)"
```

---

### Task 4: Engine — `pack_engine.run_battle` (injected I/O, mock-tested)

**Files:**
- Create: `backend/app/services/pack_engine.py`
- Test: `backend/tests/test_pack_engine.py`

**Interfaces:**
- Consumes: `GachaService.generate_pack(...,alt_player_address)`, `open_pack(memo)`; `PrivySigner.create_solana_wallet()`, `sign_and_send_solana(...,sponsor)`; the `PackBattle/BattlePull` models.
- Produces:
  - `determine_winner(pulls: list[PullOutcome], join_order: list[str]) -> str`
  - `async run_battle(session, battle, *, gacha, signer, resolve_wallet_id, build_transfer_tx, can_play, now_fn) -> str` (returns `"settled"` or `"voided"`)
  - `@dataclass PullOutcome(player_wallet, memo, nft_address, insured_value, grade)`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_pack_engine.py`:

```python
import pytest
from app.services.pack_engine import determine_winner, run_battle, PullOutcome
from app.models import PackBattle, BattlePlayer, BattlePull


def _po(w, v, g):
    return PullOutcome(player_wallet=w, memo=f"m-{w}", nft_address=f"nft-{w}", insured_value=v, grade=g)


def test_winner_by_value_then_grade_then_join_order():
    order = ["A", "B", "C"]
    assert determine_winner([_po("A", 100, 9), _po("B", 200, 8), _po("C", 50, 10)], order) == "B"
    assert determine_winner([_po("A", 100, 8), _po("B", 100, 9), _po("C", 100, 7)], order) == "B"  # grade
    assert determine_winner([_po("A", 100, 9), _po("B", 100, 9)], order) == "A"  # earliest join


class _Gacha:
    def __init__(self, opens):  # opens: wallet -> open result dict
        self.opens = opens; self.alt = None; self.pulled = []
    async def generate_pack(self, player_address, pack_type, alt_player_address=None):
        self.alt = alt_player_address; self.pulled.append(player_address)
        return {"memo": f"m-{player_address}", "transaction": f"tx-{player_address}"}
    async def open_pack(self, memo):
        w = memo.split("m-")[1]
        return {"pending": False, **self.opens[w]}


class _Signer:
    def __init__(self): self.sent = []
    async def create_solana_wallet(self): return {"id": "esc-id", "address": "ESC"}
    async def sign_and_send_solana(self, wallet_id, tx, sponsor=False):
        self.sent.append((wallet_id, tx, sponsor)); return f"sig-{len(self.sent)}"


@pytest.mark.asyncio
async def test_run_battle_settles_to_winner(session):
    b = PackBattle(id="b1", mode="pack", machine_code="pokemon_50", price=50, max_players=2, status="running")
    session.add(b)
    session.add_all([BattlePlayer(battle_id="b1", player_wallet="A"),
                     BattlePlayer(battle_id="b1", player_wallet="B")])
    session.commit()
    gacha = _Gacha({"A": {"nft_address": "nA", "insured_value": 100, "grade": 9},
                    "B": {"nft_address": "nB", "insured_value": 300, "grade": 8}})
    signer = _Signer()
    out = await run_battle(session, b, gacha=gacha, signer=signer,
                           resolve_wallet_id=lambda w: f"{w}-id",
                           build_transfer_tx=lambda esc, win, nft: f"xfer-{nft}->{win}",
                           can_play=lambda w: True, now_fn=lambda: __import__("datetime").datetime(2026,6,21))
    assert out == "settled"
    assert b.winner == "B" and b.status == "settled" and b.escrow_address == "ESC"
    assert gacha.alt == "ESC"                       # pulls delivered to escrow
    # all pulls sponsored, plus the settle transfers (escrow→winner), all sponsored
    assert all(s[2] is True for s in signer.sent)
    assert ("esc-id", "xfer-nA->B", True) in signer.sent and ("esc-id", "xfer-nB->B", True) in signer.sent


@pytest.mark.asyncio
async def test_run_battle_voids_when_player_cannot_play(session):
    b = PackBattle(id="b2", mode="pack", machine_code="pokemon_50", price=50, max_players=2, status="running")
    session.add(b)
    session.add_all([BattlePlayer(battle_id="b2", player_wallet="A"),
                     BattlePlayer(battle_id="b2", player_wallet="B")])
    session.commit()
    gacha = _Gacha({"A": {"nft_address": "nA", "insured_value": 100, "grade": 9}})
    signer = _Signer()
    out = await run_battle(session, b, gacha=gacha, signer=signer,
                           resolve_wallet_id=lambda w: f"{w}-id",
                           build_transfer_tx=lambda esc, win, nft: "x",
                           can_play=lambda w: w != "B", now_fn=lambda: __import__("datetime").datetime(2026,6,21))
    assert out == "voided" and b.status == "voided" and b.winner is None
```
(Use the project's `session` fixture; if absent, build an in-memory engine like `test_models.py`.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_pack_engine.py -q`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `pack_engine.py`**

```python
"""Operator-orchestrated Pack Battle / Battle Royale engine. All on-chain I/O is
injected so the orchestration is unit-testable without live calls."""
from __future__ import annotations
from dataclasses import dataclass
from typing import Callable, Optional


@dataclass
class PullOutcome:
    player_wallet: str
    memo: str
    nft_address: str
    insured_value: float
    grade: Optional[int]


def determine_winner(pulls: list[PullOutcome], join_order: list[str]) -> str:
    def key(p: PullOutcome):
        # higher value, then higher grade, then earliest join (smaller index)
        return (p.insured_value or 0, p.grade or 0, -join_order.index(p.player_wallet))
    return max(pulls, key=key).player_wallet


async def run_battle(session, battle, *, gacha, signer, resolve_wallet_id, build_transfer_tx,
                     can_play, now_fn) -> str:
    from app.models import BattlePlayer, BattlePull
    players = [p.player_wallet for p in
               session.query(BattlePlayer).filter_by(battle_id=battle.id).order_by(BattlePlayer.joined_at).all()]

    # Pre-flight: every player must still be able to play (session signer + USDC). Else void, no charge.
    if not all(can_play(w) for w in players):
        battle.status = "voided"; session.commit(); return "voided"

    # Escrow
    esc = await signer.create_solana_wallet()
    battle.escrow_wallet_id = esc["id"]; battle.escrow_address = esc["address"]
    battle.status = "running"; session.commit()

    # Pull each player → escrow (sponsored). On any failure → void + return already-pulled NFTs.
    outcomes: list[PullOutcome] = []
    for w in players:
        try:
            pack = await gacha.generate_pack(player_address=w, pack_type=battle.machine_code,
                                             alt_player_address=esc["address"])
            session.add(BattlePull(battle_id=battle.id, player_wallet=w, memo=pack["memo"]))
            session.commit()
            await signer.sign_and_send_solana(resolve_wallet_id(w), pack["transaction"], sponsor=True)
            res = await gacha.open_pack(pack["memo"])
            if res.get("pending") or not res.get("nft_address"):
                raise RuntimeError("pull did not resolve")
            outcomes.append(PullOutcome(w, pack["memo"], res["nft_address"],
                                        res.get("insured_value") or 0, res.get("grade")))
        except Exception:
            await _void_return(session, battle, signer, esc, outcomes, build_transfer_tx, resolve_wallet_id)
            battle.status = "voided"; session.commit(); return "voided"

    # Winner + settle: all escrow NFTs → winner (sponsored).
    winner = determine_winner(outcomes, players)
    for o in outcomes:
        tx = build_transfer_tx(esc["address"], winner, o.nft_address)
        await signer.sign_and_send_solana(esc["id"], tx, sponsor=True)
    battle.winner = winner; battle.status = "settled"; battle.settled_at = now_fn()
    session.commit()
    return "settled"


async def _void_return(session, battle, signer, esc, outcomes, build_transfer_tx, resolve_wallet_id):
    # Return each already-pulled NFT to its original puller (nobody robbed).
    for o in outcomes:
        tx = build_transfer_tx(esc["address"], o.player_wallet, o.nft_address)
        try:
            await signer.sign_and_send_solana(esc["id"], tx, sponsor=True)
        except Exception:
            pass  # best-effort; logged by the caller/ops
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_pack_engine.py -q`
Expected: PASS (3 tests).

- [ ] **Step 5: Full suite**

Run: `cd backend && .venv/bin/pytest -q`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/pack_engine.py backend/tests/test_pack_engine.py
git commit -m "feat(packbattle): orchestration engine run_battle (escrow→pull→winner→settle, injected I/O)"
```

---

### Task 5 (MANUAL — devnet, gated): live integration

> NOT subagent-executable. Run once the user's Privy **gas tank** is configured and the embedded wallet holds ≥ price USDC. Builds the real `build_transfer_tx` (solders SPL transfer + ATAs) and validates end-to-end.

- [ ] **Step 1: Real `build_transfer_tx`** — implement `backend/app/services/solana_tx.py :: build_nft_transfer(escrow_address, dest_address, mint) -> base64` using `solders` (derive ATAs for `mint` under escrow + dest, an SPL `transfer_checked`/`transfer` of amount 1, create-dest-ATA-if-missing, fee payer = escrow, recent devnet blockhash). Unit-test it builds a decodable tx.
- [ ] **Step 2: CC delivery + sponsored pull** (carries #1 Task 4 Step 2) — one real pull with `alt_player_address` = a created escrow wallet, signed+broadcast via `PrivySigner.sign_and_send_solana(..., sponsor=True)`; confirm (a) the NFT lands in the escrow (DAS/explorer), (b) `open_pack(memo)` resolves, (c) the fee was sponsored (player paid only USDC). Pin the `/v1/wallets` create-owner field + the devnet caip2 here.
- [ ] **Step 3: Full run** — drive `run_battle` against real `gacha`/`PrivySigner`/`build_nft_transfer` for a 2-player battle (two devnet wallets with USDC, both session-signed); confirm both NFTs land with the winner and neither with the loser. Record the result in `docs/ONCHAIN.md`.
- [ ] **Step 4: Decision gate** — pass → proceed to #3 (lobby/endpoints). Fail → diagnose (sponsorship, ATA, delivery) before #3.

---

## Self-Review

**1. Spec coverage:** models → Task 1; `altPlayerAddress` → Task 2; `sponsor`+`create_solana_wallet` → Task 3; `run_battle` (escrow→pull→winner→settle, void+return, injected I/O) → Task 4; live integration + real transfer-tx → Task 5. ✓
**2. Placeholder scan:** Tasks 1–4 have complete code/tests. Task 5 is an explicit manual runbook (live external APIs + paid pull); the `/v1/wallets` owner field + caip2 are pinned there (flagged, not invented). Task 3's `_post_rpc`/`_post_rpc_raw` refactor is described with its contract; the implementer keeps `sign_and_send_solana`'s output stable (the #1 tests guard it).
**3. Type consistency:** `determine_winner`, `PullOutcome`, `run_battle(... gacha, signer, resolve_wallet_id, build_transfer_tx, can_play, now_fn)`, `create_solana_wallet()→{id,address}`, `sign_and_send_solana(...,sponsor)`, `generate_pack(...,alt_player_address)` consistent across tasks + the spec.

## No-goals (carried from spec)
- Lobby/create/join endpoints + matchmaking (#3); battle UI + winner keep/sell (#4); on-chain trustless settlement; turbo; battle ELO.
