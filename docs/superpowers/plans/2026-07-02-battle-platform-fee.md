# Battle Platform Fee Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Charge a configurable platform fee (0.5%/player, capped) over the buyback value of the winner's loot, collected in USDC from the winner's wallet after settle, for Pack Battles and Battle Royale.

**Architecture:** A new `app/services/battle_fees.py` owns the whole feature: a pure base computation (`compute_fee_base_units`, per-card: real `buyback_amount` for auto-sold, `insured_value × instantBuyback%` of the card's pack otherwise) and a resilient collector (`collect_battle_fee`) that transfers `min(fee, winner_balance)` winner → fee wallet using the winner's session signer, guarded by an idempotency flag. Both engines call it right after `settle_cards_to_winner`; the wirings inject two closures (`usdc_balance`, `build_usdc_transfer_tx`). Fee deps default to `None` in the engines, so existing tests and callers are unaffected until the wiring passes them.

**Tech Stack:** Python/FastAPI backend, SQLAlchemy + SQLite (`_ENSURE_COLUMNS` idempotent migration), pytest (async via anyio like existing engine tests). No frontend changes.

## Global Constraints

- Fee formula: `pct_total = min(battle_fee_pct_per_player × n_players, battle_fee_pct_cap)`; `fee = round(base × pct_total)`; `charged = min(fee, winner_usdc_balance)` — never overdraft the winner.
- Config defaults exactly: `battle_fee_pct_per_player: float = 0.005`, `battle_fee_pct_cap: float = 0.03`, `fee_wallet_address: str = ""` (empty → fallback `privy_operator_address`; both empty → skip collection, log).
- Per-card base: auto-sold → its `buyback_amount` (already base units); kept-as-NFT → `insured_value × (instantBuyback / 100) × 1_000_000` (insured is dollars; `instantBuyback` is a percent number like `85`). Machine without `instantBuyback` → NFT cards contribute 0 (log warning); auto-sold always count.
- Pull→pack mapping: `BattlePull.round_number` (1-based) ↔ `BattlePack.sequence`; battles with no `BattlePack` rows (royale, legacy) → `battle.machine_code` for every round.
- Fee collection NEVER blocks or voids a settle: failures after retries leave `fee_charged = False`, log `ERROR`, and the battle settles normally.
- Idempotency: `PackBattle.fee_charged` guard (same pattern as `gimmighouls_awarded`). Voided battles: no fee.
- Money-source invariant: card value comes ONLY from `insured_value` / real `buyback_amount`.
- Existing tests must keep passing: new engine params are keyword-only with `None` defaults.

---

## File Structure

- **Modify `backend/app/config.py`** — 3 new settings.
- **Modify `backend/app/models.py`** — `PackBattle.fee_base_units / fee_pct / fee_charged`.
- **Modify `backend/app/db.py`** — 3 `_ENSURE_COLUMNS` rows.
- **Create `backend/app/services/battle_fees.py`** — `fee_pct_total`, `compute_fee_base_units`, `collect_battle_fee`. One responsibility: compute + collect the platform fee.
- **Modify `backend/app/services/pack_engine.py`** — call `collect_battle_fee` after settle (optional deps).
- **Modify `backend/app/services/royale_engine.py`** — same.
- **Modify `backend/app/services/pack_orchestration.py`** — both wirings pass `usdc_balance` + `build_usdc_transfer_tx`.
- **Create `backend/tests/test_battle_fees.py`** — formula, collection, idempotency, resilience.
- **Modify `backend/tests/test_pack_engine.py` + `backend/tests/test_royale_engine.py`** — engines invoke collection on settle, not on void.

All backend commands run from `backend/` with the venv: `.venv/bin/python -m pytest …`.

---

## Task 1: Config + schema (columns & migration)

**Files:**
- Modify: `backend/app/config.py:28` (after `gimmighoul_per_usdc_gacha`)
- Modify: `backend/app/models.py:105` (after `gimmighouls_awarded`)
- Modify: `backend/app/db.py:21-31` (`_ENSURE_COLUMNS`)
- Test: `backend/tests/test_battle_fees.py` (new file, first tests)

**Interfaces:**
- Produces: `Settings.battle_fee_pct_per_player: float = 0.005`, `Settings.battle_fee_pct_cap: float = 0.03`, `Settings.fee_wallet_address: str = ""`; `PackBattle.fee_base_units: int | None`, `PackBattle.fee_pct: float | None`, `PackBattle.fee_charged: bool = False`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_battle_fees.py`:

```python
"""Platform fee on battles: config, schema, base computation and collection."""
import pytest
from app.config import Settings
from app.models import PackBattle


def test_fee_settings_defaults():
    s = Settings()
    assert s.battle_fee_pct_per_player == 0.005
    assert s.battle_fee_pct_cap == 0.03
    assert s.fee_wallet_address == ""


def test_packbattle_fee_columns_default(Session):
    s = Session()
    b = PackBattle(id="bf1", mode="pack", machine_code="m", price=50_000_000,
                   max_players=2, status="settled")
    s.add(b); s.commit()
    got = s.get(PackBattle, "bf1")
    assert got.fee_charged is False
    assert got.fee_base_units is None
    assert got.fee_pct is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_battle_fees.py -v`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'battle_fee_pct_per_player'` (and/or `fee_charged` missing on the model).

- [ ] **Step 3: Add the settings**

In `backend/app/config.py`, right after the `gimmighoul_per_usdc_gacha` line, add:

```python
    # Platform fee on battles: pct per player over the buyback value of the winner's loot,
    # capped at battle_fee_pct_cap total. Collected in USDC from the winner's wallet after
    # settle. fee_wallet_address empty → falls back to privy_operator_address; both empty →
    # collection is skipped (kill-switch). env: BATTLE_FEE_PCT_PER_PLAYER / BATTLE_FEE_PCT_CAP
    # / FEE_WALLET_ADDRESS
    battle_fee_pct_per_player: float = 0.005
    battle_fee_pct_cap: float = 0.03
    fee_wallet_address: str = ""
```

- [ ] **Step 4: Add the model columns + migration rows**

In `backend/app/models.py`, right after the `gimmighouls_awarded` line inside `PackBattle`, add:

```python
    fee_base_units: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # fee actually charged (USDC base units)
    fee_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)         # total pct applied (post-cap)
    fee_charged: Mapped[bool] = mapped_column(Boolean, default=False)              # idempotency guard
```

In `backend/app/db.py`, extend `_ENSURE_COLUMNS` (after the `pack_battles` rows):

```python
    ("pack_battles", "fee_base_units", "INTEGER"),
    ("pack_battles", "fee_pct", "FLOAT"),
    ("pack_battles", "fee_charged", "BOOLEAN NOT NULL DEFAULT 0"),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_battle_fees.py tests/test_models.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/config.py app/models.py app/db.py tests/test_battle_fees.py
git commit -m "feat(fees): fee settings + PackBattle fee columns with idempotent migration"
```

---

## Task 2: `fee_pct_total` + `compute_fee_base_units`

**Files:**
- Create: `backend/app/services/battle_fees.py`
- Test: `backend/tests/test_battle_fees.py` (append)

**Interfaces:**
- Consumes: Task 1 settings/columns; `BattlePull` (`auto_sold`, `buyback_amount`, `nft_address`, `insured_value`, `round_number`), `BattlePack` (`sequence`, `machine_code`); `gacha.machines() -> list[dict]` with `code` + `instantBuyback` keys (GachaService, 60s-cached).
- Produces:
  - `fee_pct_total(n_players: int) -> float` — `min(rate × n, cap)` from `get_settings()`.
  - `async compute_fee_base_units(session, battle, gacha) -> int` — fee base in USDC base units.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_battle_fees.py`:

```python
from app.models import BattlePull, BattlePack
from app.services.battle_fees import fee_pct_total, compute_fee_base_units


class _MachGacha:
    """gacha.machines() fake."""
    def __init__(self, machines):
        self._machines = machines
    async def machines(self):
        return self._machines


class _BrokenGacha:
    async def machines(self):
        raise RuntimeError("cc down")


def _battle(s, bid, mode="pack", machine="m50", players=2):
    b = PackBattle(id=bid, mode=mode, machine_code=machine, price=50_000_000,
                   max_players=players, status="settled")
    s.add(b); s.commit()
    return b


def test_fee_pct_total_scales_and_caps(monkeypatch):
    import app.services.battle_fees as bf
    monkeypatch.setattr(bf, "get_settings",
                        lambda: Settings(battle_fee_pct_per_player=0.005, battle_fee_pct_cap=0.03))
    assert fee_pct_total(2) == pytest.approx(0.01)   # 0.5% × 2
    assert fee_pct_total(10) == pytest.approx(0.03)  # 5% capped at 3%


@pytest.mark.anyio
async def test_base_matches_user_example_multi_pack(Session):
    """$100 card from the $50 pack (85%) + $200 card from the $250 pack (90%) → $265 base."""
    s = Session()
    b = _battle(s, "bx1")
    s.add(BattlePack(battle_id="bx1", machine_code="m50", price=50_000_000, sequence=1))
    s.add(BattlePack(battle_id="bx1", machine_code="m250", price=250_000_000, sequence=2))
    s.add(BattlePull(battle_id="bx1", player_wallet="W", memo="a", round_number=1,
                     nft_address="n1", insured_value=100.0, auto_sold=False))
    s.add(BattlePull(battle_id="bx1", player_wallet="W", memo="b", round_number=2,
                     nft_address="n2", insured_value=200.0, auto_sold=False))
    s.commit()
    gacha = _MachGacha([{"code": "m50", "instantBuyback": 85},
                        {"code": "m250", "instantBuyback": 90}])
    base = await compute_fee_base_units(s, b, gacha)
    assert base == 265_000_000  # $85 + $180 in base units


@pytest.mark.anyio
async def test_base_mixes_auto_sold_real_amount_and_nft_theoretical(Session):
    s = Session()
    b = _battle(s, "bx2")  # no BattlePack rows → battle.machine_code for every round
    s.add(BattlePull(battle_id="bx2", player_wallet="W", memo="a", round_number=1,
                     nft_address="n1", insured_value=40.0, auto_sold=True,
                     buyback_amount=34_000_000))                       # real: $34
    s.add(BattlePull(battle_id="bx2", player_wallet="W", memo="b", round_number=1,
                     nft_address="n2", insured_value=100.0, auto_sold=False))  # 85% → $85
    s.commit()
    gacha = _MachGacha([{"code": "m50", "instantBuyback": 85}])
    assert await compute_fee_base_units(s, b, gacha) == 119_000_000


@pytest.mark.anyio
async def test_base_machine_without_buyback_pct_drops_nft_cards(Session):
    s = Session()
    b = _battle(s, "bx3")
    s.add(BattlePull(battle_id="bx3", player_wallet="W", memo="a", round_number=1,
                     nft_address="n1", insured_value=100.0, auto_sold=False))   # dropped
    s.add(BattlePull(battle_id="bx3", player_wallet="W", memo="b", round_number=1,
                     nft_address="n2", insured_value=40.0, auto_sold=True,
                     buyback_amount=34_000_000))                                # kept
    s.commit()
    gacha = _MachGacha([{"code": "m50", "instantBuyback": None}])
    assert await compute_fee_base_units(s, b, gacha) == 34_000_000


@pytest.mark.anyio
async def test_base_survives_machines_api_failure(Session):
    s = Session()
    b = _battle(s, "bx4")
    s.add(BattlePull(battle_id="bx4", player_wallet="W", memo="a", round_number=1,
                     nft_address="n1", insured_value=100.0, auto_sold=False))   # dropped (no pcts)
    s.add(BattlePull(battle_id="bx4", player_wallet="W", memo="b", round_number=1,
                     nft_address="n2", insured_value=40.0, auto_sold=True,
                     buyback_amount=34_000_000))
    s.commit()
    assert await compute_fee_base_units(s, b, _BrokenGacha()) == 34_000_000
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_battle_fees.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.battle_fees'`.

- [ ] **Step 3: Implement the module (computation half)**

Create `backend/app/services/battle_fees.py`:

```python
"""Platform fee on battles: pct-per-player (capped) over the buyback value of the winner's
loot, collected in USDC from the winner's wallet after settle. Never blocks a settle."""
from __future__ import annotations
import asyncio
import logging

from app.config import get_settings
from app.models import BattlePull, BattlePack

logger = logging.getLogger(__name__)

USDC = 1_000_000


def fee_pct_total(n_players: int) -> float:
    """Total fee percentage for a battle: rate × players, capped."""
    s = get_settings()
    return min(s.battle_fee_pct_per_player * n_players, s.battle_fee_pct_cap)


async def compute_fee_base_units(session, battle, gacha) -> int:
    """Fee base in USDC base units over ALL the battle's pulls (winner takes the whole loot):
    auto-sold cards count their real buyback_amount; kept-as-NFT cards count
    insured_value × instantBuyback% of the pack they were pulled from (round ↔ pack sequence;
    no BattlePack rows → battle.machine_code). Unknown pct → the NFT card contributes 0."""
    pulls = session.query(BattlePull).filter_by(battle_id=battle.id).all()
    packs = session.query(BattlePack).filter_by(battle_id=battle.id).all()
    code_by_round = {p.sequence: p.machine_code for p in packs}

    try:
        ib_by_code = {m.get("code"): m.get("instantBuyback") for m in await gacha.machines()}
    except Exception as exc:
        logger.warning("fee base: machines fetch failed for battle %s: %s — NFT cards drop out",
                       battle.id, exc)
        ib_by_code = {}

    base = 0
    for p in pulls:
        if p.auto_sold:
            base += p.buyback_amount or 0
            continue
        if not p.nft_address or not p.insured_value:
            continue
        code = code_by_round.get(p.round_number, battle.machine_code)
        ib = ib_by_code.get(code)
        if not ib:
            logger.warning("fee base: no instantBuyback for machine %s (battle %s) — card %s drops out",
                           code, battle.id, p.nft_address)
            continue
        base += int(round(p.insured_value * (ib / 100.0) * USDC))
    return base
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_battle_fees.py -v`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add app/services/battle_fees.py tests/test_battle_fees.py
git commit -m "feat(fees): fee_pct_total + compute_fee_base_units (per-pack buyback base)"
```

---

## Task 3: `collect_battle_fee`

**Files:**
- Modify: `backend/app/services/battle_fees.py` (append)
- Test: `backend/tests/test_battle_fees.py` (append)

**Interfaces:**
- Consumes: Task 2 functions; injected closures mirroring the wiring: `usdc_balance(addr) -> int` (async), `build_usdc_transfer_tx(src, dest, amount) -> str` (async), `signer.sign_solana(wallet_id, tx) -> str` (async), `submit_tx(signed)` (async), `resolve_wallet_id(wallet) -> str` (sync).
- Produces:
  - `async collect_battle_fee(session, battle, winner, n_players, *, gacha, signer, resolve_wallet_id, submit_tx, usdc_balance, build_usdc_transfer_tx, operator_wallet_id="", sleep_fn=None, max_attempts=3, delay=1.0) -> int` — returns USDC base units actually charged (0 if skipped/failed). Never raises. Commits fee columns itself.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_battle_fees.py`:

```python
from app.services.battle_fees import collect_battle_fee


class _Signer:
    def __init__(self):
        self.signed = []
    async def sign_solana(self, wallet_id, tx):
        self.signed.append(wallet_id)
        return f"signed:{tx}"


def _fee_env(monkeypatch, **over):
    import app.services.battle_fees as bf
    defaults = dict(battle_fee_pct_per_player=0.005, battle_fee_pct_cap=0.03,
                    fee_wallet_address="FEEWALLET")
    defaults.update(over)
    monkeypatch.setattr(bf, "get_settings", lambda: Settings(**defaults))


def _collect_kwargs(signer, submitted, balance=1_000_000_000, transfers=None):
    async def usdc_balance(addr):
        return balance
    async def build_usdc_transfer_tx(src, dest, amount):
        if transfers is not None:
            transfers.append((src, dest, amount))
        return f"tx:{src}->{dest}:{amount}"
    async def submit_tx(signed):
        submitted.append(signed)
    return dict(signer=signer, resolve_wallet_id=lambda w: f"{w}-id", submit_tx=submit_tx,
                usdc_balance=usdc_balance, build_usdc_transfer_tx=build_usdc_transfer_tx,
                operator_wallet_id="op-id", sleep_fn=_nosleep, delay=0.0)


async def _nosleep(_):
    return None


def _loot(s, bid, insured=100.0):
    """One kept-NFT card worth `insured` from machine m50 (85%)."""
    s.add(BattlePull(battle_id=bid, player_wallet="WIN", memo="a", round_number=1,
                     nft_address="n1", insured_value=insured, auto_sold=False))
    s.commit()


GACHA85 = _MachGacha([{"code": "m50", "instantBuyback": 85}])


@pytest.mark.anyio
async def test_collect_full_charge_and_persist(Session, monkeypatch):
    _fee_env(monkeypatch)
    s = Session()
    b = _battle(s, "bc1"); _loot(s, "bc1")            # base $85
    signer, submitted, transfers = _Signer(), [], []
    charged = await collect_battle_fee(s, b, "WIN", 2, gacha=GACHA85,
                                       **_collect_kwargs(signer, submitted, transfers=transfers))
    assert charged == 850_000                          # $85 × 1% = $0.85
    assert transfers == [("WIN", "FEEWALLET", 850_000)]
    assert signer.signed == ["WIN-id", "op-id"]        # winner signs, operator pays gas
    assert len(submitted) == 1
    got = s.get(PackBattle, "bc1")
    assert got.fee_charged is True and got.fee_base_units == 850_000
    assert got.fee_pct == pytest.approx(0.01)


@pytest.mark.anyio
async def test_collect_caps_at_winner_balance(Session, monkeypatch):
    _fee_env(monkeypatch)
    s = Session()
    b = _battle(s, "bc2"); _loot(s, "bc2")            # fee would be 850_000
    signer, submitted, transfers = _Signer(), [], []
    charged = await collect_battle_fee(s, b, "WIN", 2, gacha=GACHA85,
                                       **_collect_kwargs(signer, submitted, balance=300_000, transfers=transfers))
    assert charged == 300_000                          # only what the winner holds
    assert transfers == [("WIN", "FEEWALLET", 300_000)]
    assert s.get(PackBattle, "bc2").fee_base_units == 300_000


@pytest.mark.anyio
async def test_collect_zero_balance_marks_charged_no_transfer(Session, monkeypatch):
    _fee_env(monkeypatch)
    s = Session()
    b = _battle(s, "bc3"); _loot(s, "bc3")
    signer, submitted = _Signer(), []
    charged = await collect_battle_fee(s, b, "WIN", 2, gacha=GACHA85,
                                       **_collect_kwargs(signer, submitted, balance=0))
    assert charged == 0 and submitted == []
    got = s.get(PackBattle, "bc3")
    assert got.fee_charged is True and got.fee_base_units == 0


@pytest.mark.anyio
async def test_collect_idempotent_second_call_noop(Session, monkeypatch):
    _fee_env(monkeypatch)
    s = Session()
    b = _battle(s, "bc4"); _loot(s, "bc4")
    signer, submitted = _Signer(), []
    kw = _collect_kwargs(signer, submitted)
    await collect_battle_fee(s, b, "WIN", 2, gacha=GACHA85, **kw)
    again = await collect_battle_fee(s, b, "WIN", 2, gacha=GACHA85, **kw)
    assert again == 0 and len(submitted) == 1          # no double transfer


@pytest.mark.anyio
async def test_collect_transfer_failure_never_raises_flag_stays_false(Session, monkeypatch, caplog):
    _fee_env(monkeypatch)
    s = Session()
    b = _battle(s, "bc5"); _loot(s, "bc5")
    signer = _Signer()
    async def usdc_balance(addr): return 1_000_000_000
    async def build_usdc_transfer_tx(src, dest, amount): return "tx"
    async def submit_tx(signed): raise RuntimeError("rpc down")
    charged = await collect_battle_fee(
        s, b, "WIN", 2, gacha=GACHA85, signer=signer, resolve_wallet_id=lambda w: f"{w}-id",
        submit_tx=submit_tx, usdc_balance=usdc_balance,
        build_usdc_transfer_tx=build_usdc_transfer_tx, operator_wallet_id="op-id",
        sleep_fn=_nosleep, delay=0.0)
    assert charged == 0
    assert s.get(PackBattle, "bc5").fee_charged is False   # retryable later
    assert any(r.levelname == "ERROR" for r in caplog.records)


@pytest.mark.anyio
async def test_collect_skips_when_no_fee_wallet_configured(Session, monkeypatch):
    _fee_env(monkeypatch, fee_wallet_address="", privy_operator_address="")
    s = Session()
    b = _battle(s, "bc6"); _loot(s, "bc6")
    signer, submitted = _Signer(), []
    charged = await collect_battle_fee(s, b, "WIN", 2, gacha=GACHA85,
                                       **_collect_kwargs(signer, submitted))
    assert charged == 0 and submitted == []
    assert s.get(PackBattle, "bc6").fee_charged is False


@pytest.mark.anyio
async def test_collect_rate_zero_is_kill_switch(Session, monkeypatch):
    _fee_env(monkeypatch, battle_fee_pct_per_player=0.0)
    s = Session()
    b = _battle(s, "bc7"); _loot(s, "bc7")
    signer, submitted = _Signer(), []
    charged = await collect_battle_fee(s, b, "WIN", 2, gacha=GACHA85,
                                       **_collect_kwargs(signer, submitted))
    assert charged == 0 and submitted == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_battle_fees.py -v`
Expected: FAIL — `ImportError: cannot import name 'collect_battle_fee'`.

- [ ] **Step 3: Implement the collector**

Append to `backend/app/services/battle_fees.py`:

```python
async def collect_battle_fee(session, battle, winner, n_players, *, gacha, signer,
                             resolve_wallet_id, submit_tx, usdc_balance,
                             build_usdc_transfer_tx, operator_wallet_id="",
                             sleep_fn=None, max_attempts=3, delay=1.0) -> int:
    """Charge the platform fee from the winner's wallet (post-sweep) into the fee wallet.
    charged = min(fee, winner balance); zero balance still flips the idempotency flag.
    NEVER raises and never blocks the settle: exhausted retries → fee_charged stays False
    (retryable) + ERROR log. Returns the base units actually charged."""
    sleep_fn = sleep_fn or asyncio.sleep
    try:
        if battle.fee_charged:
            return 0
        s = get_settings()
        fee_wallet = s.fee_wallet_address or s.privy_operator_address
        if not fee_wallet:
            logger.warning("fee: no fee wallet configured — skipping battle %s", battle.id)
            return 0
        pct = fee_pct_total(n_players)
        if pct <= 0:
            return 0
        base = await compute_fee_base_units(session, battle, gacha)
        fee = int(round(base * pct))
        if fee <= 0:
            battle.fee_charged = True
            battle.fee_base_units = 0
            battle.fee_pct = pct
            session.commit()
            return 0

        balance = await usdc_balance(winner)
        charged = min(fee, balance)
        if charged < fee:
            logger.warning("fee: winner %s balance %s < fee %s in battle %s — charging balance",
                           winner, balance, fee, battle.id)
        if charged <= 0:
            battle.fee_charged = True
            battle.fee_base_units = 0
            battle.fee_pct = pct
            session.commit()
            return 0

        for attempt in range(max_attempts):
            try:
                tx = await build_usdc_transfer_tx(winner, fee_wallet, charged)
                signed = await signer.sign_solana(resolve_wallet_id(winner), tx)
                if operator_wallet_id:
                    signed = await signer.sign_solana(operator_wallet_id, signed)  # operator pays gas
                await submit_tx(signed)
                battle.fee_charged = True
                battle.fee_base_units = charged
                battle.fee_pct = pct
                session.commit()
                logger.info("fee: charged %s from %s in battle %s (pct=%s)",
                            charged, winner, battle.id, pct)
                return charged
            except Exception as exc:
                logger.warning("fee: transfer attempt %s/%s failed in battle %s: %s",
                               attempt + 1, max_attempts, battle.id, exc)
                await sleep_fn(delay)
        logger.error("fee: UNCOLLECTED after %s attempts in battle %s (winner %s, amount %s)",
                     max_attempts, battle.id, winner, charged)
        return 0
    except Exception as exc:  # money path: absolutely never break the caller's settle
        logger.error("fee: unexpected error in battle %s: %s — skipping", battle.id, exc)
        return 0
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_battle_fees.py -v`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add app/services/battle_fees.py tests/test_battle_fees.py
git commit -m "feat(fees): collect_battle_fee — resilient post-settle charge from the winner"
```

---

## Task 4: Engine integration (pack + royale)

**Files:**
- Modify: `backend/app/services/pack_engine.py` (`run_battle` signature + call after `settle_cards_to_winner`, around lines 108 and 188-201)
- Modify: `backend/app/services/royale_engine.py` (`run_royale` signature + call after `settle_cards_to_winner`, around lines 15-23 and 166-185)
- Test: `backend/tests/test_pack_engine.py`, `backend/tests/test_royale_engine.py` (append one test each)

**Interfaces:**
- Consumes: `collect_battle_fee` (Task 3 signature).
- Produces: `run_battle(..., usdc_balance=None, build_usdc_transfer_tx=None)` and `run_royale(..., usdc_balance=None, build_usdc_transfer_tx=None)` — keyword-only, default `None`. Fee collection runs ONLY when both are provided (so every existing test/caller is untouched).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_pack_engine.py` (reuse the file's existing fixtures/fakes — `_Gacha`, signer, session and the kwargs used by the other `run_battle` tests; follow the invocation style of the nearest passing test):

```python
@pytest.mark.anyio
async def test_run_battle_invokes_fee_collection_on_settle(Session, monkeypatch):
    """After settle, the engine calls collect_battle_fee with the winner and player count —
    only when the wiring provided the two fee closures."""
    calls = []
    async def fake_collect(session, battle, winner, n_players, **kw):
        calls.append((battle.id, winner, n_players)); return 0
    import app.services.pack_engine as pe
    monkeypatch.setattr(pe, "collect_battle_fee", fake_collect)

    # Arrange a 2-player battle exactly like the file's happy-path settle test, then:
    async def usdc_balance(addr): return 0
    async def build_usdc_transfer_tx(src, dest, amount): return "tx"
    out = await run_battle(session, b, gacha=gacha, signer=signer,
                           resolve_wallet_id=lambda w: f"{w}-id",
                           build_transfer_tx=build_transfer_tx, submit_tx=submit_tx,
                           prepare_escrow=prepare_escrow, confirm_in_escrow=confirm_in_escrow,
                           can_play=lambda w: True, now_fn=now_fn, sleep_fn=nosleep,
                           usdc_balance=usdc_balance,
                           build_usdc_transfer_tx=build_usdc_transfer_tx)
    assert out == "settled"
    assert len(calls) == 1
    assert calls[0][1] == b.winner and calls[0][2] == 2


@pytest.mark.anyio
async def test_run_battle_no_fee_deps_no_fee_call(Session, monkeypatch):
    """Without the fee closures (legacy callers, existing tests) collection is never invoked."""
    calls = []
    async def fake_collect(*a, **kw):
        calls.append(1); return 0
    import app.services.pack_engine as pe
    monkeypatch.setattr(pe, "collect_battle_fee", fake_collect)
    # run the same happy-path settle WITHOUT usdc_balance/build_usdc_transfer_tx
    assert out == "settled" and calls == []
```

(The implementer adapts the arrange blocks to the file's real fixtures — the assertion contract above is what matters. Same two tests in `tests/test_royale_engine.py` against `run_royale`, asserting `n_players == len(players)` of the royale.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_pack_engine.py tests/test_royale_engine.py -v -k fee`
Expected: FAIL — `run_battle() got an unexpected keyword argument 'usdc_balance'` (and no `collect_battle_fee` attribute on the engine module).

- [ ] **Step 3: Wire the engines**

`backend/app/services/pack_engine.py`:

1. Top imports: add `from app.services.battle_fees import collect_battle_fee`.
2. `run_battle` signature: after `build_usdc_sweep_tx=None, operator_wallet_id=""` add `, usdc_balance=None, build_usdc_transfer_tx=None`.
3. Right AFTER the `await settle_cards_to_winner(...)` call and BEFORE `battle.winner = winner; battle.status = "settled"...`, insert:

```python
    if usdc_balance is not None and build_usdc_transfer_tx is not None:
        await collect_battle_fee(
            session, battle, winner, len(players), gacha=gacha, signer=signer,
            resolve_wallet_id=resolve_wallet_id, submit_tx=submit_tx,
            usdc_balance=usdc_balance, build_usdc_transfer_tx=build_usdc_transfer_tx,
            operator_wallet_id=operator_wallet_id, sleep_fn=sleep_fn,
        )
```

`backend/app/services/royale_engine.py`:

1. Top imports: add `from app.services.battle_fees import collect_battle_fee`.
2. `run_royale` signature: after `escrow_usdc_balance=None, operator_wallet_id=""` add `, usdc_balance=None, build_usdc_transfer_tx=None`.
3. Right AFTER its `await settle_cards_to_winner(...)` call and BEFORE `battle.winner = winner`, insert the same block with `len(players)` (the royale's full player list, captured at the top of `run_royale`).

- [ ] **Step 4: Run the affected suites**

Run: `.venv/bin/python -m pytest tests/test_pack_engine.py tests/test_royale_engine.py tests/test_battle_fees.py -v`
Expected: PASS — new fee tests green AND every pre-existing engine test untouched (fee deps default to `None`).

- [ ] **Step 5: Commit**

```bash
git add app/services/pack_engine.py app/services/royale_engine.py tests/test_pack_engine.py tests/test_royale_engine.py
git commit -m "feat(fees): engines collect the platform fee right after settle (opt-in deps)"
```

---

## Task 5: Wiring (pack_orchestration passes the fee closures)

**Files:**
- Modify: `backend/app/services/pack_orchestration.py` (pack wiring ~lines 249-295; royale wiring ~lines 340-405)
- Test: `backend/tests/test_pack_orchestration.py` (append)

**Interfaces:**
- Consumes: engines' new `usdc_balance` / `build_usdc_transfer_tx` params (Task 4); existing helpers `usdc_balance_base_units(rpc_url, addr, usdc_mint)`, `fetch_latest_blockhash(rpc_url)`, `build_token_transfer(src, dest, mint, bh, amount=…, decimals=6, fee_payer=…)`.
- Produces: both live wirings pass the closures, so fee collection is active in production for pack and royale.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_pack_orchestration.py` (following the file's existing wiring-test style — it already fakes `signer`, RPC helpers and `run_battle`):

```python
@pytest.mark.anyio
async def test_pack_wiring_passes_fee_closures(monkeypatch):
    """The live wiring forwards usdc_balance + build_usdc_transfer_tx into run_battle."""
    seen = {}
    async def fake_run_battle(session, battle, **kw):
        seen["usdc_balance"] = kw.get("usdc_balance")
        seen["build_usdc_transfer_tx"] = kw.get("build_usdc_transfer_tx")
        return "settled"
    import app.services.pack_orchestration as po
    monkeypatch.setattr(po, "run_battle", fake_run_battle)
    # invoke the wiring entrypoint exactly like the file's existing wiring test does
    assert seen["usdc_balance"] is not None
    assert seen["build_usdc_transfer_tx"] is not None
```

(Mirror test for the royale wiring: monkeypatch `po.run_royale`, assert both kwargs are non-None.)

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_pack_orchestration.py -v -k fee_closures`
Expected: FAIL — the kwargs are `None`/absent.

- [ ] **Step 3: Pass the closures in both wirings**

Pack wiring (`pack_orchestration.py`, inside the function that builds closures and calls `run_battle` ~line 249):

```python
    async def usdc_balance(addr):
        return await usdc_balance_base_units(rpc_url, addr, usdc_mint)

    async def build_usdc_transfer_tx(src, dest, amount):
        bh = await fetch_latest_blockhash(rpc_url)
        return build_token_transfer(src, dest, usdc_mint, bh, amount=amount, decimals=6,
                                    fee_payer=operator_address)
```

and extend the `run_battle(...)` call with `usdc_balance=usdc_balance, build_usdc_transfer_tx=build_usdc_transfer_tx`.

Royale wiring: it ALREADY defines `build_usdc_transfer_tx` and `escrow_usdc_balance` (a generic balance-by-address closure). Add `usdc_balance=escrow_usdc_balance, build_usdc_transfer_tx=build_usdc_transfer_tx` to the `run_royale(...)` call — no new closures needed.

- [ ] **Step 4: Run the full backend suite**

Run: `.venv/bin/python -m pytest`
Expected: ALL PASS (was ~260 tests; now + the new fee tests). No regressions anywhere.

- [ ] **Step 5: Commit**

```bash
git add app/services/pack_orchestration.py tests/test_pack_orchestration.py
git commit -m "feat(fees): wire fee closures into pack and royale live settle paths"
```

---

## Self-Review

**1. Spec coverage:** formula + cap → T2/T3; per-pack pct with round↔sequence mapping and legacy fallback → T2; auto-sold real amount vs NFT theoretical → T2; machines-API failure & missing pct degrade gracefully → T2; charge from winner capped at balance, zero-balance marks charged → T3; dedicated fee wallet with operator fallback + both-empty skip → T3; rate-0 kill-switch → T3; idempotency flag → T1 (columns) + T3 (guard); never blocks settle + ERROR log → T3 (outer try + retry exhaustion test); collection after sweep, before settled-commit, both modes, voided never charges → T4 (placement + no-deps test; voided paths return before the settle block); production wiring both modes → T5. UI: none (spec non-goal). ✅
**2. Placeholder scan:** Task 4/5 test steps intentionally delegate the *arrange* blocks to each file's existing fixtures (the files have heavy local fakes; duplicating them here would drift) — the assertion contracts are fully specified. No TBD/TODO anywhere. ✅
**3. Type consistency:** `collect_battle_fee(session, battle, winner, n_players, *, gacha, signer, resolve_wallet_id, submit_tx, usdc_balance, build_usdc_transfer_tx, operator_wallet_id, sleep_fn, max_attempts, delay)` — identical in T3 definition, T3 tests, and T4 engine calls. Engine kwargs `usdc_balance`/`build_usdc_transfer_tx` match T5 wiring names. `fee_base_units`/`fee_pct`/`fee_charged` consistent T1↔T3. ✅
