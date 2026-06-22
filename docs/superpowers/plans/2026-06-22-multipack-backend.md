# Pack battle multi-pack — backend (#4e-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the single-box pack battle to a bundle of 1–10 boxes — each player opens the same bundle, highest summed insured value wins all — while keeping the single-box case identical.

**Architecture:** A new `BattlePack` child table holds the ordered bundle; `create_battle`/`POST /pack-battles` accept a `packs` bundle and set `PackBattle.price` to the total; `run_battle` pulls round-by-round over the bundle and `determine_winner` is generalized to compare per-player totals. Settle, void-refund, and PF tie-break are reused unchanged.

**Tech Stack:** Backend FastAPI + SQLAlchemy (pytest, in-memory SQLite). Run tests from `backend/` with `.venv/bin/pytest`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-22-multipack-backend-design.md`.
- **Tests** run from `backend/` with `.venv/bin/pytest`.
- **Prices are USDC base units** (`_machine_price = int(machine.price) * 1_000_000`). Bundle total = Σ per-box prices. `PackBattle.price` becomes the bundle total.
- **Bundle:** 1–10 boxes (`count >= 1` each); any number of machines. Out of range → HTTP 422; unavailable machine → 409; insufficient funds → 402.
- **Winner = highest summed `insured_value`** per player (winner takes all). Tie on the total → `pick_index(server_seed, client_seed, n_tied)` among tied wallets — ONE draw at the end (not per-round).
- **Back-compat:** a legacy `{machine_code}` create (no `packs`) → a 1-box bundle; an engine run with no `BattlePack` rows → a 1-box bundle of `battle.machine_code`. Single-box behavior must stay identical (regression tests green).
- **Reuse unchanged:** `settle_cards_to_winner`, `refund_pack_void`, `client_seed_from_nfts`, the join flow (reserves `b.price` = the total).
- **Out of scope (do NOT build):** the multi-pack create UI (#4e-2); royale changes; per-round PF; multi-pack for royale.

---

### Task 1: Generalize `determine_winner` to compare per-player totals

**Files:**
- Modify: `backend/app/services/pack_engine.py` (`determine_winner`, ~line 25)
- Test: `backend/tests/test_pack_engine.py`

**Interfaces:**
- Produces: `determine_winner(pulls: list[PullOutcome], *, server_seed: str, client_seed: str) -> tuple[str, Optional[int]]` — now aggregates `insured_value` by `player_wallet`, picks the max total, PF tie-break among tied wallets. Consumed by `run_battle` (Task 4, unchanged call site).

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_pack_engine.py` (the `_po(w, v, g)` helper already exists):

```python
def test_determine_winner_by_total_across_multiple_pulls():
    from app.services.pack_engine import determine_winner
    # A: 50+50+50 = 150 ; B: 300+10+10 = 320 → B wins on the TOTAL (not the single max)
    pulls = [_po("A", 50, 9), _po("A", 50, 9), _po("A", 50, 9),
             _po("B", 300, 8), _po("B", 10, 8), _po("B", 10, 8)]
    w, idx = determine_winner(pulls, server_seed="ab"*32, client_seed="00"*32)
    assert w == "B" and idx is None


def test_determine_winner_tie_on_total_uses_pf_draw():
    from app.services.pack_engine import determine_winner
    from app.services.provably_fair import pick_index
    # A: 100+100 = 200 ; B: 150+50 = 200 → tie on the total → PF among ["A","B"]
    pulls = [_po("A", 100, 9), _po("A", 100, 9), _po("B", 150, 8), _po("B", 50, 8)]
    expect_idx = pick_index("ab"*32, "00"*32, 2)
    w, idx = determine_winner(pulls, server_seed="ab"*32, client_seed="00"*32)
    assert idx == expect_idx and w == sorted(["A", "B"])[expect_idx]
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `backend/`): `.venv/bin/pytest tests/test_pack_engine.py::test_determine_winner_by_total_across_multiple_pulls tests/test_pack_engine.py::test_determine_winner_tie_on_total_uses_pf_draw -v`
Expected: FAIL — the current `determine_winner` compares single pulls (B's 300 is the max single value), so it picks B for the wrong reason in test 1 and mis-handles the tie-on-total in test 2.

- [ ] **Step 3: Generalize the implementation**

In `backend/app/services/pack_engine.py`, replace `determine_winner`:

```python
def determine_winner(pulls: list[PullOutcome], *, server_seed: str, client_seed: str) -> tuple[str, Optional[int]]:
    # Sum insured_value per player; highest TOTAL wins. (Single-box battles have one pull
    # per player, so the total == that pull's value — identical to the prior behavior.)
    totals: dict[str, float] = {}
    for p in pulls:
        totals[p.player_wallet] = totals.get(p.player_wallet, 0.0) + (p.insured_value or 0)
    maxv = max(totals.values())
    candidates = sorted([w for w, t in totals.items() if t == maxv])
    if len(candidates) == 1:
        return candidates[0], None
    if not server_seed:   # a tie needs the Provably-Fair seed (set at lobby creation)
        raise ValueError("server_seed must be set before a tie-break draw")
    idx = pick_index(server_seed, client_seed, len(candidates))
    return candidates[idx], idx
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `backend/`): `.venv/bin/pytest tests/test_pack_engine.py -v`
Expected: PASS — the 2 new tests + the existing `test_determine_winner_single_max_no_draw` and `test_determine_winner_tie_uses_provably_fair_draw` (single pull per player → total == value → identical).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/pack_engine.py backend/tests/test_pack_engine.py
git commit -m "feat(be): determine_winner compares per-player totals (multi-pack) (#4e-1)"
```

---

### Task 2: `BattlePack` model + `create_battle` bundle + `get_battle` exposes packs

**Files:**
- Modify: `backend/app/models.py` (add `BattlePack`)
- Modify: `backend/app/services/pack_lobby.py` (`create_battle`, `get_battle`)
- Test: `backend/tests/test_pack_lobby.py`

**Interfaces:**
- Consumes: `_machine_price` is the caller's concern (Task 3); `create_battle` receives prices directly.
- Produces:
  - `BattlePack{ id, battle_id, machine_code, price, sequence }`.
  - `create_battle(session, creator_wallet, creator_wallet_id, *, machine_code, price, max_players, mode="pack", packs: list[tuple[str, int]] | None = None)` — when `packs` is None it stores `[(machine_code, price)]`; inserts a `BattlePack` per entry with `sequence` 1..N.
  - `get_battle(...)` gains `packs: [ { machine_code, sequence, price } ]` (ordered; `[]` for legacy battles).

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_pack_lobby.py`:

```python
def test_create_battle_with_bundle_persists_packs_and_total(session):
    from app.models import BattlePack
    b = create_battle(session, "WC", "wid-c", machine_code="m25", price=125_000_000,
                      max_players=2, mode="pack",
                      packs=[("m25", 25_000_000), ("m50", 50_000_000), ("m50", 50_000_000)])
    rows = session.query(BattlePack).filter_by(battle_id=b.id).order_by(BattlePack.sequence).all()
    assert [(r.machine_code, r.price, r.sequence) for r in rows] == [
        ("m25", 25_000_000, 1), ("m50", 50_000_000, 2), ("m50", 50_000_000, 3)]
    view = get_battle(session, b.id)
    assert view["packs"] == [
        {"machine_code": "m25", "sequence": 1, "price": 25_000_000},
        {"machine_code": "m50", "sequence": 2, "price": 50_000_000},
        {"machine_code": "m50", "sequence": 3, "price": 50_000_000}]


def test_create_battle_without_packs_is_single_box_bundle(session):
    from app.models import BattlePack
    b = create_battle(session, "WC", "wid-c", machine_code="m50", price=50_000_000, max_players=2)
    rows = session.query(BattlePack).filter_by(battle_id=b.id).all()
    assert [(r.machine_code, r.price, r.sequence) for r in rows] == [("m50", 50_000_000, 1)]
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `backend/`): `.venv/bin/pytest tests/test_pack_lobby.py::test_create_battle_with_bundle_persists_packs_and_total tests/test_pack_lobby.py::test_create_battle_without_packs_is_single_box_bundle -v`
Expected: FAIL — `ImportError`/`AttributeError` for `BattlePack`, and `create_battle` doesn't accept `packs`.

- [ ] **Step 3: Add the `BattlePack` model**

In `backend/app/models.py`, after `class BattlePull` (so it sits with the other battle tables), add:

```python
class BattlePack(Base):
    __tablename__ = "battle_packs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    battle_id: Mapped[str] = mapped_column(String, index=True)
    machine_code: Mapped[str] = mapped_column(String)
    price: Mapped[int] = mapped_column(Integer)   # USDC base units, per box
    sequence: Mapped[int] = mapped_column(Integer)  # 1..N order within the bundle
```

- [ ] **Step 4: Extend `create_battle` + `get_battle`**

In `backend/app/services/pack_lobby.py`, import `BattlePack` (add to the existing `from app.models import ...` line) and change `create_battle`:

```python
def create_battle(session, creator_wallet, creator_wallet_id, *, machine_code, price, max_players,
                  mode="pack", packs: list[tuple[str, int]] | None = None):
    if mode not in ("pack", "royale"):
        raise ModeNotSupported(f"Modo '{mode}' no soportado")
    if not (2 <= max_players <= 10):
        raise LobbyError("max_players debe estar entre 2 y 10")
    seed, h = gen_server_seed()
    b = PackBattle(id=uuid.uuid4().hex, mode=mode, machine_code=machine_code, price=price,
                   max_players=max_players, status="lobby", server_seed=seed, server_seed_hash=h,
                   creator_wallet=creator_wallet)
    session.add(b)
    session.add(BattlePlayer(battle_id=b.id, player_wallet=creator_wallet, wallet_id=creator_wallet_id))
    if mode == "pack":   # the bundle is a pack-mode concept; royale opens its machine per round
        for i, (mc, pr) in enumerate(packs or [(machine_code, price)], start=1):
            session.add(BattlePack(battle_id=b.id, machine_code=mc, price=pr, sequence=i))
    session.commit()
    return b
```

(So a royale battle has no `BattlePack` rows and `get_battle.packs == []` for it; the new tests use the default `mode="pack"`.)

Add a `_packs` helper and include it in `get_battle`'s `out` dict (next to `players`/`rounds`):

```python
def _packs(session, battle_id):
    return [{"machine_code": p.machine_code, "sequence": p.sequence, "price": p.price}
            for p in session.query(BattlePack).filter_by(battle_id=battle_id)
            .order_by(BattlePack.sequence).all()]
```
In `get_battle`, add `"packs": _packs(session, battle_id),` to the `out` dict.

- [ ] **Step 5: Run tests to verify they pass**

Run (from `backend/`): `.venv/bin/pytest tests/test_pack_lobby.py -v`
Expected: PASS (the 2 new tests + existing `pack_lobby` tests — `create_battle`'s extra `BattlePack` insert and the new `packs` key don't break them; the existing `get_battle` tests don't assert the absence of `packs`).

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/app/services/pack_lobby.py backend/tests/test_pack_lobby.py
git commit -m "feat(be): BattlePack model + create_battle bundle + get_battle packs (#4e-1)"
```

---

### Task 3: `POST /pack-battles` accepts a `packs` bundle

**Files:**
- Modify: `backend/app/main.py` (`CreateBattleBody`, `create_pack_battle` pack branch)
- Test: `backend/tests/test_pack_lobby_api.py`

**Interfaces:**
- Consumes: `create_battle(..., packs=...)` (Task 2); `_machine_price`, `_require_available`, `reserve`, `get_battle` (existing).
- Produces: `CreateBattleBody` gains `packs: list[PackSel] | None` (`PackSel{ machine_code: str, count: int }`); `machine_code` becomes optional. Pack create builds a 1–10-box bundle, reserves the total, persists it.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_pack_lobby_api.py` (uses the existing `client_priv` fixture, `_auth_headers`, `WALLET_A`/`WALLET_ID_A`, and the balance/machines monkeypatch pattern):

```python
def test_create_multipack_bundle(client_priv, monkeypatch):
    c, priv = client_priv

    async def _high_balance(*args, **kwargs):
        return 1_000_000_000

    async def _machines():
        return [{"code": "m25", "price": 25, "available": True},
                {"code": "m50", "price": 50, "available": True}]

    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_balance)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())
    hdrs = _auth_headers(priv, WALLET_A, WALLET_ID_A)

    r = c.post("/pack-battles", json={"max_players": 2,
               "packs": [{"machine_code": "m25", "count": 1}, {"machine_code": "m50", "count": 2}]},
               headers=hdrs)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["price"] == 125_000_000   # 25 + 50 + 50, base units
    assert body["packs"] == [
        {"machine_code": "m25", "sequence": 1, "price": 25_000_000},
        {"machine_code": "m50", "sequence": 2, "price": 50_000_000},
        {"machine_code": "m50", "sequence": 3, "price": 50_000_000}]
    # the creator reserved the total
    assert c.get("/users/me/balance", headers=hdrs).json() == {"reserved": 125_000_000}


def test_create_multipack_rejects_over_ten_boxes(client_priv, monkeypatch):
    c, priv = client_priv

    async def _high_balance(*args, **kwargs):
        return 1_000_000_000

    async def _machines():
        return [{"code": "m25", "price": 25, "available": True}]

    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_balance)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())
    hdrs = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    r = c.post("/pack-battles", json={"max_players": 2, "packs": [{"machine_code": "m25", "count": 11}]},
               headers=hdrs)
    assert r.status_code == 422, r.text


def test_create_legacy_single_machine_still_works(client_priv, monkeypatch):
    c, priv = client_priv

    async def _high_balance(*args, **kwargs):
        return 1_000_000_000

    async def _machines():
        return [{"code": "m50", "price": 50, "available": True}]

    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_balance)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())
    hdrs = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    r = c.post("/pack-battles", json={"machine_code": "m50", "max_players": 2}, headers=hdrs)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["price"] == 50_000_000
    assert body["packs"] == [{"machine_code": "m50", "sequence": 1, "price": 50_000_000}]
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `backend/`): `.venv/bin/pytest tests/test_pack_lobby_api.py::test_create_multipack_bundle tests/test_pack_lobby_api.py::test_create_multipack_rejects_over_ten_boxes tests/test_pack_lobby_api.py::test_create_legacy_single_machine_still_works -v`
Expected: FAIL — `CreateBattleBody` rejects `packs` / the bundle isn't built; `packs` missing from the response.

- [ ] **Step 3: Implement the body + pack branch**

In `backend/app/main.py`, replace `CreateBattleBody` (the `class CreateBattleBody(BaseModel)` block):

```python
class PackSel(BaseModel):
    machine_code: str
    count: int

class CreateBattleBody(BaseModel):
    machine_code: Optional[str] = None     # legacy single-pack / royale
    max_players: int
    mode: str = "pack"
    packs: Optional[list[PackSel]] = None  # multi-pack bundle (pack mode only)
```
(`Optional` is already imported in `main.py`.)

In `create_pack_battle`, replace the **pack branch** (`# Default: pack mode` … through the `reserve` + `return get_battle(...)`). The royale branch is unchanged; only the pack branch builds a bundle:

```python
        # Default: pack mode — build the bundle (1..10 boxes), reserve the total
        if body.packs:
            for sel in body.packs:
                if sel.count < 1:
                    raise HTTPException(422, "cada count debe ser >= 1")
            bundle: list[tuple[str, int]] = []
            for sel in body.packs:
                ppx = await _machine_price(sel.machine_code)   # 409 if unavailable
                bundle += [(sel.machine_code, ppx)] * sel.count
        else:
            if not body.machine_code:
                raise HTTPException(422, "machine_code o packs requerido")
            bundle = [(body.machine_code, await _machine_price(body.machine_code))]
        if not (1 <= len(bundle) <= 10):
            raise HTTPException(422, "el bundle debe tener entre 1 y 10 cajas")
        total = sum(pr for _, pr in bundle)
        await _require_available(wallet, total, s)
        try:
            b = create_battle(s, wallet, wallet_id, machine_code=bundle[0][0], price=total,
                              max_players=body.max_players, mode=mode, packs=bundle)
        except LobbyError as e:
            raise HTTPException(409, str(e))
        reserve(s, wallet, b.id, total)
        return get_battle(s, b.id)
```

REQUIRED guard on the top-of-function `price`: `create_pack_battle` starts with `price = await _machine_price(body.machine_code)` (the royale branch uses it). A pack create that sends only `packs` (no `machine_code`) would make that call fail. Change that line to:

```python
        price = await _machine_price(body.machine_code) if body.machine_code else 0
```

Royale always sends `machine_code`, so it still gets a real `price`; the pack branch ignores the top-level `price` and computes the bundle itself.

- [ ] **Step 4: Run tests to verify they pass**

Run (from `backend/`): `.venv/bin/pytest tests/test_pack_lobby_api.py -v`
Expected: PASS — the 3 new tests + all existing API tests (the existing single-machine create tests exercise the legacy path; royale create tests still pass).

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py backend/tests/test_pack_lobby_api.py
git commit -m "feat(be): POST /pack-battles accepts a packs bundle (1-10 boxes) (#4e-1)"
```

---

### Task 4: `run_battle` pulls round-by-round over the bundle

**Files:**
- Modify: `backend/app/services/pack_engine.py` (`run_battle` pull loop)
- Test: `backend/tests/test_pack_engine.py`

**Interfaces:**
- Consumes: `BattlePack` (Task 2), `determine_winner` (Task 1, by-total).
- Produces: `run_battle` reads the `BattlePack` bundle (ordered) and pulls **round by round** (`for k, machine in enumerate(bundle, 1): for w in players:`), persisting each `BattlePull` with `round_number=k`. Legacy battles with no `BattlePack` rows → a 1-box bundle of `battle.machine_code` (identical to today).

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_pack_engine.py` (a multi-pack-aware gacha mock that gives each box a distinct memo/value):

```python
class _MultiGacha:
    """opens: {(wallet, round): {nft_address, insured_value, grade}}. memo encodes wallet+round."""
    def __init__(self, opens):
        self.opens = opens; self.counts = {}; self.alt = None
    async def generate_pack(self, player_address, pack_type, alt_player_address=None, turbo=False):
        self.alt = alt_player_address
        k = self.counts.get(player_address, 0) + 1
        self.counts[player_address] = k
        memo = f"m-{player_address}-{k}"
        return {"memo": memo, "transaction": f"tx-{memo}"}
    async def open_pack(self, memo):
        _, w, k = memo.split("-")
        return {"pending": False, **self.opens[(w, int(k))]}
    async def submit_tx(self, signed_transaction):
        return {"signature": "ccsig", "confirmation_status": "confirmed"}


@pytest.mark.asyncio
async def test_run_battle_multipack_winner_by_total(session):
    from app.models import BattlePack
    b = PackBattle(id="mp", mode="pack", machine_code="m25", price=125_000_000, max_players=2,
                   status="running", server_seed="ab"*32)
    session.add(b)
    session.add_all([BattlePlayer(battle_id="mp", player_wallet="A"),
                     BattlePlayer(battle_id="mp", player_wallet="B")])
    session.add_all([BattlePack(battle_id="mp", machine_code="m25", price=25_000_000, sequence=1),
                     BattlePack(battle_id="mp", machine_code="m50", price=50_000_000, sequence=2),
                     BattlePack(battle_id="mp", machine_code="m50", price=50_000_000, sequence=3)])
    session.commit()
    # A: 50+50+50 = 150 ; B: 300+10+10 = 320 → B wins on the total
    gacha = _MultiGacha({
        ("A", 1): {"nft_address": "nA1", "insured_value": 50, "grade": 9},
        ("A", 2): {"nft_address": "nA2", "insured_value": 50, "grade": 9},
        ("A", 3): {"nft_address": "nA3", "insured_value": 50, "grade": 9},
        ("B", 1): {"nft_address": "nB1", "insured_value": 300, "grade": 8},
        ("B", 2): {"nft_address": "nB2", "insured_value": 10, "grade": 8},
        ("B", 3): {"nft_address": "nB3", "insured_value": 10, "grade": 8}})
    built = []
    async def build_transfer_tx(esc, dest, mint):
        built.append((dest, mint)); return f"xfer-{mint}->{dest}"
    async def submit_tx(signed): return "ccsig"
    async def confirm_in_escrow(esc, nft): return True
    async def prepare_escrow(addr): return None
    out = await run_battle(session, b, gacha=gacha, signer=_Signer(),
                           resolve_wallet_id=lambda w: f"{w}-id",
                           build_transfer_tx=build_transfer_tx, submit_tx=submit_tx,
                           confirm_in_escrow=confirm_in_escrow, prepare_escrow=prepare_escrow,
                           can_play=lambda w: True,
                           now_fn=lambda: __import__("datetime").datetime(2026, 6, 21))
    assert out == "settled" and b.winner == "B"
    rows = session.query(BattlePull).filter_by(battle_id="mp").all()
    assert len(rows) == 6
    assert sorted(r.round_number for r in rows) == [1, 1, 2, 2, 3, 3]
    # all six NFTs settled to the winner B
    assert {m for _, m in built} == {"nA1", "nA2", "nA3", "nB1", "nB2", "nB3"}
    assert all(d == "B" for d, _ in built)
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `.venv/bin/pytest tests/test_pack_engine.py::test_run_battle_multipack_winner_by_total -v`
Expected: FAIL — the current `run_battle` pulls once per player from `battle.machine_code` (2 pulls, all `round_number=1`), so the count/round/winner assertions fail.

- [ ] **Step 3: Generalize the pull loop**

In `backend/app/services/pack_engine.py` `run_battle`, add `BattlePack` to the local import (`from app.models import BattlePlayer, BattlePull, BattlePack`) and replace the single pull loop (`for w in players:` … building `outcomes`) with a round-by-round loop over the bundle:

```python
    # Bundle: ordered BattlePack rows (legacy battles → a 1-box bundle of machine_code)
    packs = session.query(BattlePack).filter_by(battle_id=battle.id).order_by(BattlePack.sequence).all()
    bundle = [p.machine_code for p in packs] or [battle.machine_code]

    outcomes: list[PullOutcome] = []
    for k, machine_code in enumerate(bundle, start=1):
        for w in players:
            try:
                pack = await gacha.generate_pack(player_address=w, pack_type=machine_code,
                                                 alt_player_address=esc["address"], turbo=True)
                pull = BattlePull(battle_id=battle.id, player_wallet=w, memo=pack["memo"], round_number=k)
                session.add(pull); session.commit()
                signed = await signer.sign_solana(resolve_wallet_id(w), pack["transaction"])
                sub = await gacha.submit_tx(signed)
                if not sub.get("signature"):
                    raise RuntimeError("pull submit returned no signature")
                res = await gacha.open_pack(pack["memo"])
                attempts = 0
                while res.get("pending") and attempts < open_max_attempts:
                    await sleep_fn(open_delay)
                    res = await gacha.open_pack(pack["memo"])
                    attempts += 1
                if res.get("pending") or not res.get("nft_address"):
                    raise RuntimeError("pull did not resolve")
                pull.nft_address = res["nft_address"]
                pull.insured_value = res.get("insured_value") or 0
                pull.grade = res.get("grade")
                pull.rarity = res.get("rarity")
                pull.auto_sold = bool(res.get("auto_sold"))
                pull.buyback_amount = res.get("buyback_amount")
                session.commit()
                outcomes.append(PullOutcome(w, pack["memo"], res["nft_address"],
                                            res.get("insured_value") or 0, res.get("grade"),
                                            auto_sold=bool(res.get("auto_sold"))))
            except Exception as exc:
                logger.warning("pull failed for %s in battle %s: %s — voiding", w, battle.id, exc)
                battle.status = "voided"; session.commit(); return "voided"
```

Everything after the pull loop (`determine_winner`, `client_seed`, `settle_cards_to_winner`, winner/settled) is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run (from `backend/`): `.venv/bin/pytest tests/test_pack_engine.py -v`
Expected: PASS — the new multi-pack test + all existing `run_battle` single-box tests (those battles have no `BattlePack` rows → the `or [battle.machine_code]` fallback → one pull per player, `round_number=1`, identical outcome).

Then the broader regression for the engine's consumers:
Run: `.venv/bin/pytest tests/test_pack_orchestration.py tests/test_refund.py -q`
Expected: PASS (settle + void-refund still operate over all `BattlePull` rows).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/pack_engine.py backend/tests/test_pack_engine.py
git commit -m "feat(be): run_battle pulls round-by-round over the bundle (multi-pack) (#4e-1)"
```

---

## Final whole-branch review

After Task 4, run the full backend suite (`backend/`: `.venv/bin/pytest`) and request a whole-branch review before merging to `master`. Update `.superpowers/sdd/progress.md` with the #4e-1 sub-project entry. Note for the reviewer: the single-box path must stay behavior-identical (regression tests green); `settle_cards_to_winner`/`refund_pack_void` were intentionally reused unchanged; and the multi-pack create UI is the next sub-project (#4e-2). Carry-over to #4e-2: the create UI builds the `packs` bundle, and `get_battle.packs` lets the reveal/result show the bundle composition.
