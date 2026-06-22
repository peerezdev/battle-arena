# Void refunds (#3d) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a battle voids mid-run, refund fairly — Pack Battle returns each puller their own pull (card, or the auto-sold common's USDC); Battle Royale returns alive players their own pulls and splits the liquidated leftover (eliminated players' cards bought back + undistributed pool) equally among the alive.

**Architecture:** Persist `buyback_amount` per pull. Add a resilient `refund.py` (injected I/O, mirrors `settle_cards_to_winner`: bounded retries, never raises). The engines just mark `voided` and return; the live wiring (`run_pack_battle_live`/`run_royale_live`) invokes the matching refund on a `"voided"` result. The pack engine's inline `_void_return` is removed (its job moves to `refund_pack_void`).

**Tech Stack:** Python 3.9, FastAPI, SQLAlchemy, solders, pytest. Run from `backend/` with `PYTHONPATH=. .venv/bin/pytest`.

## Global Constraints

- **Pack void:** each puller gets their own pull back — the non-common card (`escrow → puller`), or the auto-sold common's `buyback_amount` USDC (`escrow → puller`). No pool, no elimination. A puller with no completed pull gets nothing (their reservation was already released by #3c).
- **Royale void:** alive players (`eliminated_round IS NULL`) get their own pulls (non-common cards + auto-sold commons' USDC); each eliminated player's non-common cards are **bought back** (escrow → CC → USDC to escrow); the resulting **leftover** escrow USDC is split **equally** among alive players (`share = leftover // n_alive`; integer remainder stays in escrow). Eliminated players get nothing; the operator nets zero.
- Refunds are **resilient**: bounded retries (default 3), never raise, log only wallet/battle id/mint/error (never tx bytes/keys/signatures).
- The engines mark `voided` + return `"voided"`; the **wiring** invokes the refund. The pack engine no longer does inline `_void_return`.
- Card value source remains `insuredValue`; no value-source change.

---

### Task 1: Persist BattlePull.buyback_amount

**Files:**
- Modify: `backend/app/models.py` (BattlePull), `backend/app/services/pack_engine.py:146-151` (pull persist), `backend/app/services/royale_engine.py:103-108` (pull persist)
- Test: `backend/tests/test_models.py`, `backend/tests/test_pack_engine.py`, `backend/tests/test_royale_engine.py`

**Interfaces:**
- Produces: `BattlePull.buyback_amount: Optional[int]` (USDC base units, the auto-sell payout); populated in both engines from `open_pack`'s `buyback_amount`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_models.py`:

```python
def test_battle_pull_buyback_amount_defaults_none():
    from app.db import make_engine, make_session_factory, init_db
    from app.models import BattlePull
    engine = make_engine("sqlite:///:memory:"); init_db(engine)
    Session = make_session_factory(engine)
    with Session() as s:
        p = BattlePull(battle_id="b1", player_wallet="A", memo="m1")
        s.add(p); s.commit()
        row = s.query(BattlePull).first()
        assert row.buyback_amount is None
        row.buyback_amount = 42_500_000; s.commit()
        assert s.query(BattlePull).first().buyback_amount == 42_500_000
```

In `backend/tests/test_pack_engine.py`, the existing `test_run_battle_turbo_autosold_common_not_transferred` builds an `auto_sold` open result for player A. Extend that test: add `"buyback_amount": 42_500_000` to A's open dict, and after the existing assertions add:

```python
    assert a_pull.buyback_amount == 42_500_000
```

In `backend/tests/test_royale_engine.py`, the existing `test_run_royale_turbo_persists_rarity_and_resilient_settle` builds an `auto_sold` open for player A. Add `"buyback_amount": 42_500_000` to A's open dict, and after the existing assertions add:

```python
    assert a_pull.buyback_amount == 42_500_000
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_models.py::test_battle_pull_buyback_amount_defaults_none -v`
Expected: FAIL with `AttributeError: 'BattlePull' object has no attribute 'buyback_amount'`.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/models.py`, in `class BattlePull`, after `transferred`:

```python
    buyback_amount: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
```

In `backend/app/services/pack_engine.py`, in the pull-persist block (after `pull.auto_sold = ...`, before `session.commit()` at ~line 151):

```python
            pull.buyback_amount = res.get("buyback_amount")
```

In `backend/app/services/royale_engine.py`, in the pull-persist block (after `pull.auto_sold = ...`, before `session.commit()` at ~line 108):

```python
                pull.buyback_amount = res.get("buyback_amount")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_models.py tests/test_pack_engine.py tests/test_royale_engine.py -v`
Expected: PASS.

- [ ] **Step 5: Run full suite + commit**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest -q`
Expected: all green.

```bash
git add backend/app/models.py backend/app/services/pack_engine.py backend/app/services/royale_engine.py backend/tests/test_models.py backend/tests/test_pack_engine.py backend/tests/test_royale_engine.py
git commit -m "feat(models): BattlePull.buyback_amount + persist in both engines"
```

---

### Task 2: refund.py — `_sign_submit_retry` + `refund_pack_void`

**Files:**
- Create: `backend/app/services/refund.py`
- Test: `backend/tests/test_refund.py`

**Interfaces:**
- Consumes: `_wait_in_escrow` (pack_engine), `UnsupportedNftStandard` (nft_transfer), `BattlePull.buyback_amount/auto_sold/nft_address` (Task 1).
- Produces:
  - `async _sign_submit_retry(build_tx, *, signer, escrow_wallet_id, submit_tx, sleep_fn, wait_delay, max_attempts, ctx) -> bool` (build→sign→submit with retries; `False`/no-retry on `UnsupportedNftStandard`; never raises)
  - `async refund_pack_void(session, battle, *, escrow_wallet_id, escrow_address, build_transfer_tx, submit_tx, signer, build_usdc_transfer_tx, confirm_in_escrow, sleep_fn=None, wait_max_attempts=20, wait_delay=3.0, max_attempts=3) -> None`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_refund.py`:

```python
import pytest
from app.db import make_engine, make_session_factory, init_db
from app.models import PackBattle, BattlePull
from app.services.refund import refund_pack_void


@pytest.fixture
def session():
    engine = make_engine("sqlite:///:memory:"); init_db(engine)
    Session = make_session_factory(engine)
    with Session() as s:
        yield s


class _Signer:
    async def sign_solana(self, wallet_id, tx): return f"signed-{tx}"


async def _noslp(_): return None
async def _ce(esc, nft): return True


def _battle(session, pulls):
    b = PackBattle(id="b1", mode="pack", machine_code="m", price=50, max_players=4, status="voided")
    session.add(b)
    for w, nft, auto, bb in pulls:
        session.add(BattlePull(battle_id="b1", player_wallet=w, memo=f"m-{w}",
                               nft_address=nft, auto_sold=auto, buyback_amount=bb))
    session.commit()
    return b


@pytest.mark.asyncio
async def test_refund_pack_void_returns_cards_and_usdc_to_pullers(session):
    # A: non-common card → returned to A. B: auto-sold common → 42 USDC to B. C: no pull → nothing.
    b = _battle(session, [("A", "nftA", False, None), ("B", "nftB", True, 42_000_000), ("C", None, False, None)])
    cards, usdc = [], []
    async def btx(esc, dest, nft): cards.append((dest, nft)); return f"tx-{nft}"
    async def usdctx(src, dest, amt): usdc.append((dest, amt)); return f"u-{dest}"
    async def sub(signed): return "sig"
    await refund_pack_void(session, b, escrow_wallet_id="eid", escrow_address="ESC",
        build_transfer_tx=btx, submit_tx=sub, signer=_Signer(), build_usdc_transfer_tx=usdctx,
        confirm_in_escrow=_ce, sleep_fn=_noslp, wait_max_attempts=1, wait_delay=0)
    assert cards == [("A", "nftA")]
    assert usdc == [("B", 42_000_000)]


@pytest.mark.asyncio
async def test_refund_pack_void_noop_without_escrow(session):
    b = _battle(session, [("A", "nftA", False, None)])
    cards = []
    async def btx(esc, dest, nft): cards.append((dest, nft)); return "x"
    async def usdctx(src, dest, amt): return "u"
    async def sub(signed): return "sig"
    await refund_pack_void(session, b, escrow_wallet_id=None, escrow_address=None,
        build_transfer_tx=btx, submit_tx=sub, signer=_Signer(), build_usdc_transfer_tx=usdctx,
        confirm_in_escrow=_ce, sleep_fn=_noslp, wait_max_attempts=1, wait_delay=0)
    assert cards == []   # no escrow → nothing refunded
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_refund.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.refund'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/app/services/refund.py`:

```python
"""Resilient void refunds (injected I/O, mirrors settle_cards_to_winner: bounded retries, never raises).
Called by the wiring when a run returns 'voided'. Logs no secrets."""
from __future__ import annotations
import asyncio
import logging

from app.services.pack_engine import _wait_in_escrow
from app.services.nft_transfer import UnsupportedNftStandard

logger = logging.getLogger(__name__)


async def _sign_submit_retry(build_tx, *, signer, escrow_wallet_id, submit_tx,
                             sleep_fn, wait_delay, max_attempts, ctx) -> bool:
    """build_tx() → sign(escrow) → submit, with bounded retries. UnsupportedNftStandard → give up (no
    retry). Never raises. Returns True on success."""
    for _ in range(max_attempts):
        try:
            tx = await build_tx()
            signed = await signer.sign_solana(escrow_wallet_id, tx)
            await submit_tx(signed)
            return True
        except UnsupportedNftStandard as exc:
            logger.warning("%s: unsupported — flagging: %s", ctx, exc)
            return False
        except Exception as exc:
            logger.warning("%s: retry: %s", ctx, exc)
            await sleep_fn(wait_delay)
    return False


async def refund_pack_void(session, battle, *, escrow_wallet_id, escrow_address,
                           build_transfer_tx, submit_tx, signer, build_usdc_transfer_tx,
                           confirm_in_escrow, sleep_fn=None, wait_max_attempts=20,
                           wait_delay=3.0, max_attempts=3) -> None:
    """Pack Battle void refund: return each puller their own pull — the non-common card, or the
    auto-sold common's buyback_amount USDC. No-op if there is no escrow (pre-flight void). Never raises."""
    sleep_fn = sleep_fn or asyncio.sleep
    if not escrow_address:
        return
    from app.models import BattlePull
    pulls = session.query(BattlePull).filter_by(battle_id=battle.id).all()
    for p in pulls:
        if p.auto_sold:
            if not p.buyback_amount:
                continue
            await _sign_submit_retry(
                lambda p=p: build_usdc_transfer_tx(escrow_address, p.player_wallet, p.buyback_amount),
                signer=signer, escrow_wallet_id=escrow_wallet_id, submit_tx=submit_tx,
                sleep_fn=sleep_fn, wait_delay=wait_delay, max_attempts=max_attempts,
                ctx=f"pack void usdc {p.player_wallet} in {battle.id}")
        elif p.nft_address:
            async def _build(p=p):
                await _wait_in_escrow(confirm_in_escrow, escrow_address, p.nft_address,
                                      sleep_fn, wait_max_attempts, wait_delay)
                return await build_transfer_tx(escrow_address, p.player_wallet, p.nft_address)
            await _sign_submit_retry(
                _build, signer=signer, escrow_wallet_id=escrow_wallet_id, submit_tx=submit_tx,
                sleep_fn=sleep_fn, wait_delay=wait_delay, max_attempts=max_attempts,
                ctx=f"pack void card {p.nft_address} in {battle.id}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_refund.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/refund.py backend/tests/test_refund.py
git commit -m "feat(refund): resilient refund_pack_void (return each puller their own pull)"
```

---

### Task 3: refund.py — `refund_royale_void`

**Files:**
- Modify: `backend/app/services/refund.py`
- Test: `backend/tests/test_refund.py`

**Interfaces:**
- Consumes: `_sign_submit_retry`, `_wait_in_escrow`, `BattlePlayer.eliminated_round`, `BattlePull` (Task 1).
- Produces: `async refund_royale_void(session, battle, *, escrow_wallet_id, escrow_address, build_transfer_tx, submit_tx, signer, build_usdc_transfer_tx, buyback_to_escrow, escrow_usdc_balance, confirm_in_escrow, sleep_fn=None, wait_max_attempts=20, wait_delay=3.0, max_attempts=3) -> None`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_refund.py`:

```python
from app.models import BattlePlayer, BattleRound  # noqa: E402
from app.services.refund import refund_royale_void  # noqa: E402


@pytest.mark.asyncio
async def test_refund_royale_void_alive_get_pulls_eliminated_bought_back_leftover_split(session):
    # 3-player royale; C eliminated round 1. A & B alive.
    # Pulls: A r1 non-common nftA1; A r2 auto-sold common (bb=42); B r1 non-common nftB1;
    #        C r1 non-common nftC1 (eliminated → bought back).
    b = PackBattle(id="r1", mode="royale", machine_code="m", price=50, max_players=3, status="voided")
    session.add(b)
    session.add_all([
        BattlePlayer(battle_id="r1", player_wallet="A", eliminated_round=None),
        BattlePlayer(battle_id="r1", player_wallet="B", eliminated_round=None),
        BattlePlayer(battle_id="r1", player_wallet="C", eliminated_round=1),
    ])
    session.add_all([
        BattlePull(battle_id="r1", player_wallet="A", memo="mA1", round_number=1, nft_address="nftA1", auto_sold=False),
        BattlePull(battle_id="r1", player_wallet="A", memo="mA2", round_number=2, nft_address="nftA2", auto_sold=True, buyback_amount=42_000_000),
        BattlePull(battle_id="r1", player_wallet="B", memo="mB1", round_number=1, nft_address="nftB1", auto_sold=False),
        BattlePull(battle_id="r1", player_wallet="C", memo="mC1", round_number=1, nft_address="nftC1", auto_sold=False),
    ])
    session.commit()

    cards, usdc, bought = [], [], []
    async def btx(esc, dest, nft): cards.append((dest, nft)); return f"tx-{nft}"
    async def usdctx(src, dest, amt): usdc.append((dest, amt)); return f"u-{dest}-{amt}"
    async def sub(signed): return "sig"
    async def buyback(nft): bought.append(nft)
    async def esc_bal(esc): return 300_000_000  # leftover after alive refunds + buybacks (mocked)

    await refund_royale_void(session, b, escrow_wallet_id="eid", escrow_address="ESC",
        build_transfer_tx=btx, submit_tx=sub, signer=_Signer(), build_usdc_transfer_tx=usdctx,
        buyback_to_escrow=buyback, escrow_usdc_balance=esc_bal, confirm_in_escrow=_ce,
        sleep_fn=_noslp, wait_max_attempts=1, wait_delay=0)

    # Alive cards returned to their owners (A's nftA1, B's nftB1); C's card NOT returned to C.
    assert sorted(cards) == [("A", "nftA1"), ("B", "nftB1")]
    # C's eliminated card was bought back.
    assert bought == ["nftC1"]
    # A's auto-sold common refunded (42), then leftover 300 split equally → 150 each alive.
    assert ("A", 42_000_000) in usdc
    assert usdc.count(("A", 150_000_000)) == 1 and usdc.count(("B", 150_000_000)) == 1
    # C gets nothing.
    assert all(dest != "C" for dest, _ in usdc)
    assert all(dest != "C" for dest, _ in cards)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_refund.py::test_refund_royale_void_alive_get_pulls_eliminated_bought_back_leftover_split -v`
Expected: FAIL with `ImportError: cannot import name 'refund_royale_void'`.

- [ ] **Step 3: Write minimal implementation**

Append to `backend/app/services/refund.py`:

```python
async def refund_royale_void(session, battle, *, escrow_wallet_id, escrow_address,
                             build_transfer_tx, submit_tx, signer, build_usdc_transfer_tx,
                             buyback_to_escrow, escrow_usdc_balance, confirm_in_escrow,
                             sleep_fn=None, wait_max_attempts=20, wait_delay=3.0, max_attempts=3) -> None:
    """Battle Royale void refund: alive players (eliminated_round IS NULL) get their own pulls (non-common
    cards + auto-sold commons' USDC); each eliminated player's non-common cards are bought back; the leftover
    escrow USDC is split equally among the alive. Eliminated get nothing. No-op if no escrow. Never raises."""
    sleep_fn = sleep_fn or asyncio.sleep
    if not escrow_address:
        return
    from app.models import BattlePull, BattlePlayer
    players = session.query(BattlePlayer).filter_by(battle_id=battle.id).all()
    alive = sorted({p.player_wallet for p in players if p.eliminated_round is None})
    eliminated = {p.player_wallet for p in players if p.eliminated_round is not None}
    pulls = session.query(BattlePull).filter_by(battle_id=battle.id).all()

    # 1+2: return alive players' own pulls (cards + auto-sold commons' USDC).
    for p in pulls:
        if p.player_wallet not in alive:
            continue
        if p.auto_sold:
            if p.buyback_amount:
                await _sign_submit_retry(
                    lambda p=p: build_usdc_transfer_tx(escrow_address, p.player_wallet, p.buyback_amount),
                    signer=signer, escrow_wallet_id=escrow_wallet_id, submit_tx=submit_tx,
                    sleep_fn=sleep_fn, wait_delay=wait_delay, max_attempts=max_attempts,
                    ctx=f"royale void usdc {p.player_wallet} in {battle.id}")
        elif p.nft_address:
            async def _build(p=p):
                await _wait_in_escrow(confirm_in_escrow, escrow_address, p.nft_address,
                                      sleep_fn, wait_max_attempts, wait_delay)
                return await build_transfer_tx(escrow_address, p.player_wallet, p.nft_address)
            await _sign_submit_retry(
                _build, signer=signer, escrow_wallet_id=escrow_wallet_id, submit_tx=submit_tx,
                sleep_fn=sleep_fn, wait_delay=wait_delay, max_attempts=max_attempts,
                ctx=f"royale void card {p.nft_address} in {battle.id}")

    # 3: buy back each eliminated player's non-common cards → USDC into the escrow.
    for p in pulls:
        if p.player_wallet in eliminated and not p.auto_sold and p.nft_address:
            for _ in range(max_attempts):
                try:
                    await buyback_to_escrow(p.nft_address)
                    break
                except Exception as exc:
                    logger.warning("royale void buyback %s in %s: retry: %s", p.nft_address, battle.id, exc)
                    await sleep_fn(wait_delay)

    # 4+5: split the leftover escrow USDC equally among the alive.
    if not alive:
        return
    leftover = await escrow_usdc_balance(escrow_address)
    share = leftover // len(alive)
    if share <= 0:
        return
    for w in alive:
        await _sign_submit_retry(
            lambda w=w: build_usdc_transfer_tx(escrow_address, w, share),
            signer=signer, escrow_wallet_id=escrow_wallet_id, submit_tx=submit_tx,
            sleep_fn=sleep_fn, wait_delay=wait_delay, max_attempts=max_attempts,
            ctx=f"royale void leftover {w} in {battle.id}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_refund.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/refund.py backend/tests/test_refund.py
git commit -m "feat(refund): refund_royale_void (alive get pulls; eliminated bought back; leftover split equally)"
```

---

### Task 4: Wire refunds into the void path; drop inline `_void_return`

**Files:**
- Modify: `backend/app/services/pack_engine.py` (remove `_void_return` calls + function), `backend/app/services/pack_orchestration.py` (`run_pack_battle_live`, `run_royale_live`)
- Test: `backend/tests/test_pack_orchestration.py`

**Interfaces:**
- Consumes: `refund_pack_void`, `refund_royale_void` (Tasks 2/3).
- Produces: both live runners invoke the matching refund on a `"voided"` result, providing `build_usdc_transfer_tx` (+ royale `buyback_to_escrow`, `escrow_usdc_balance`) closures. `run_battle` no longer calls `_void_return` (function removed).

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_pack_orchestration.py`:

```python
@pytest.mark.asyncio
async def test_run_pack_battle_live_invokes_refund_on_void(session, monkeypatch):
    """A 'voided' result from run_battle triggers refund_pack_void with the live closures."""
    import app.services.pack_orchestration as po
    from app.models import PackBattle, BattlePlayer
    b = PackBattle(id="b-void-refund", mode="pack", machine_code="pokemon_50", price=50,
                   max_players=2, status="lobby", escrow_wallet_id="eid", escrow_address="ESC")
    session.add(b)
    session.add_all([BattlePlayer(battle_id="b-void-refund", player_wallet=WALLET_A, wallet_id=WALLET_ID_A),
                     BattlePlayer(battle_id="b-void-refund", player_wallet=WALLET_B, wallet_id=WALLET_ID_B)])
    session.commit()

    called = {}
    async def _fake_run(session, battle, **kwargs):
        return "voided"
    async def _fake_refund(session, battle, **kwargs):
        called["escrow_address"] = kwargs.get("escrow_address")
        called["has_usdc_closure"] = kwargs.get("build_usdc_transfer_tx") is not None
    monkeypatch.setattr(po, "run_battle", _fake_run)
    monkeypatch.setattr(po, "refund_pack_void", _fake_refund)
    async def _bal(*a, **k): return 0
    monkeypatch.setattr(po, "usdc_balance_base_units", _bal)

    out = await po.run_pack_battle_live(session, b, gacha=None, signer=None, rpc_url="x",
        usdc_mint="Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr", min_usdc_base_units=0)
    assert out == "voided"
    assert called.get("escrow_address") == "ESC"
    assert called.get("has_usdc_closure") is True


@pytest.mark.asyncio
async def test_run_pack_battle_live_no_refund_on_settled(session, monkeypatch):
    import app.services.pack_orchestration as po
    from app.models import PackBattle, BattlePlayer
    b = PackBattle(id="b-settled", mode="pack", machine_code="pokemon_50", price=50,
                   max_players=2, status="lobby")
    session.add(b)
    session.add(BattlePlayer(battle_id="b-settled", player_wallet=WALLET_A, wallet_id=WALLET_ID_A))
    session.commit()
    refunded = []
    async def _fake_run(session, battle, **kwargs): return "settled"
    async def _fake_refund(session, battle, **kwargs): refunded.append(battle.id)
    monkeypatch.setattr(po, "run_battle", _fake_run)
    monkeypatch.setattr(po, "refund_pack_void", _fake_refund)
    async def _bal(*a, **k): return 0
    monkeypatch.setattr(po, "usdc_balance_base_units", _bal)
    out = await po.run_pack_battle_live(session, b, gacha=None, signer=None, rpc_url="x",
        usdc_mint="Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr", min_usdc_base_units=0)
    assert out == "settled" and refunded == []   # no refund on settle
```

(`session` fixture: if `test_pack_orchestration.py` lacks one, mirror the in-memory `Session`/`session` fixture used by the other engine tests.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_pack_orchestration.py -k refund_on_void -v`
Expected: FAIL — `run_pack_battle_live` returns the engine result directly without calling `refund_pack_void` (AttributeError on `po.refund_pack_void` monkeypatch target, or `called` empty).

- [ ] **Step 3: Write minimal implementation**

In `backend/app/services/pack_orchestration.py`, add the import:

```python
from app.services.refund import refund_pack_void, refund_royale_void
```

In `run_pack_battle_live`, add the USDC-transfer closure near the other closures:

```python
    async def build_usdc_transfer_tx(src, dest, amount):
        bh = await fetch_latest_blockhash(rpc_url)
        return build_token_transfer(src, dest, usdc_mint, bh, amount=amount, decimals=6)
```

Replace the final `return await run_battle(...)` so the result is captured and a void triggers the refund:

```python
    result = await run_battle(
        session, battle, gacha=gacha, signer=signer, resolve_wallet_id=resolve_wallet_id,
        build_transfer_tx=build_transfer_tx, submit_tx=submit_tx, prepare_escrow=prepare_escrow,
        confirm_in_escrow=confirm_in_escrow, can_play=can_play, now_fn=now_fn, sponsor=sponsor,
        build_usdc_sweep_tx=build_usdc_sweep_tx,
    )
    if result == "voided":
        await refund_pack_void(
            session, battle, escrow_wallet_id=battle.escrow_wallet_id, escrow_address=battle.escrow_address,
            build_transfer_tx=build_transfer_tx, submit_tx=submit_tx, signer=signer,
            build_usdc_transfer_tx=build_usdc_transfer_tx, confirm_in_escrow=confirm_in_escrow,
        )
    return result
```

In `run_royale_live`, add the closures (USDC transfer, buyback-to-escrow, escrow balance):

```python
    async def build_usdc_transfer_tx(src, dest, amount):
        bh = await fetch_latest_blockhash(rpc_url)
        return build_token_transfer(src, dest, usdc_mint, bh, amount=amount, decimals=6)

    async def buyback_to_escrow(nft):
        bb = await gacha.buyback(battle.escrow_address, nft)
        txb = bb.get("serialized_transaction")
        if not txb:
            return
        signed = await signer.sign_solana(battle.escrow_wallet_id, txb)
        await gacha.submit_tx(signed)   # CC is fee-payer + co-signer → submit via CC

    async def escrow_usdc_balance(esc_addr):
        return await usdc_balance_base_units(rpc_url, esc_addr, usdc_mint)
```

And capture the royale result + refund on void (replace the final `return await run_royale(...)`):

```python
    result = await run_royale(
        session, battle, gacha=gacha, signer=signer, resolve_wallet_id=resolve_wallet_id,
        distribute=distribute, confirm_usdc=confirm_usdc_cb, confirm_in_escrow=confirm_in_escrow,
        build_transfer_tx=build_transfer_tx, submit_tx=submit_tx, prepare_escrow=prepare_escrow,
        price_base=price_base, now_fn=now_fn, build_usdc_sweep_tx=build_usdc_sweep_tx,
    )
    if result == "voided":
        await refund_royale_void(
            session, battle, escrow_wallet_id=battle.escrow_wallet_id, escrow_address=battle.escrow_address,
            build_transfer_tx=build_transfer_tx, submit_tx=submit_tx, signer=signer,
            build_usdc_transfer_tx=build_usdc_transfer_tx, buyback_to_escrow=buyback_to_escrow,
            escrow_usdc_balance=escrow_usdc_balance, confirm_in_escrow=confirm_in_escrow,
        )
    return result
```

In `backend/app/services/pack_engine.py`, remove the inline refund: delete the two `await _void_return(signer, esc, outcomes, build_transfer_tx, submit_tx)` lines (in the pull-failure and winner-determination void paths), leaving each as `battle.status = "voided"; session.commit(); return "voided"`. Then delete the `_void_return` function definition entirely (its job is now `refund_pack_void`, invoked by the wiring).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_pack_orchestration.py tests/test_pack_engine.py tests/test_royale_engine.py -v`
Expected: PASS (new wiring tests + existing engine tests; the engine void tests assert only `"voided"` status, which still holds without `_void_return`).

- [ ] **Step 5: Run full suite + commit**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest -q`
Expected: all green.

```bash
git add backend/app/services/pack_engine.py backend/app/services/pack_orchestration.py backend/tests/test_pack_orchestration.py
git commit -m "feat(wiring): invoke void refunds on voided; drop pack engine inline _void_return"
```

---

## Self-Review

**1. Spec coverage (#3d):**
- Persist `buyback_amount` → Task 1. ✓
- `refund_pack_void` (each puller their own pull: card / auto-sold USDC) → Task 2. ✓
- `refund_royale_void` (alive get pulls; eliminated cards bought back; leftover split equally; eliminated nothing) → Task 3. ✓
- Resilient (retries, never raise, no-secrets logging) → `_sign_submit_retry` + the loops (Tasks 2/3). ✓
- Engines mark voided + return; wiring invokes refund; pack `_void_return` removed → Task 4. ✓

**2. Placeholder scan:** No TBD/TODO; complete code in every step; tests assert real behavior (which cards/USDC moved, equal split, no-op-without-escrow, settle-does-not-refund). `_sign_submit_retry` is extracted to avoid duplicating the build→sign→submit→retry block across both refunds.

**3. Type consistency:** `refund_pack_void(...)` and `refund_royale_void(...)` signatures match their wiring call sites in Task 4; `_sign_submit_retry(build_tx, *, signer, escrow_wallet_id, submit_tx, sleep_fn, wait_delay, max_attempts, ctx)` used consistently; `build_usdc_transfer_tx(src, dest, amount)`, `buyback_to_escrow(nft)`, `escrow_usdc_balance(esc_addr)` closures match what the refund functions consume. `BattlePull.buyback_amount` (Task 1) consumed in Tasks 2/3.

## No-goals (this plan)
Withdrawal endpoint; multi-worker concurrency; partial-tournament accounting beyond the agreed alive-split policy; reservation TTL. Reservation release on void is already handled by #3c (the wiring's `finally`).
