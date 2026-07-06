# Battle Corner-Case Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ningún jugador pierde dinero ante fallos de Collector Crypt ni reinicios del servidor: reconciliación de pulls sin resolver, resume de Battle Royale que continúa la partida, y fixes menores (cancel race, settle idempotente), todo con tests.

**Architecture:** Tres bloques sobre el backend FastAPI existente: (1) un servicio de reconciliación (`reconcile.py`) que re-consulta memos huérfanos y un flag `BattlePull.refunded` que hace idempotentes los refunds; (2) `resume_royale` en `royale_engine.py` (extrae el loop de ronda a `_play_round` compartido) + wiring `resume_royale_live` + hook de startup; (3) fixes puntuales en `main.py`/`pack_engine.py` y el catálogo de tests de corner cases. Todo el I/O on-chain sigue inyectado como closures (patrón existente) para que los tests no toquen la red.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy (SQLite), pytest + pytest-asyncio. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-07-06-battle-corner-cases-design.md`

## Global Constraints

- Los servicios de refund/reconcile/resume **nunca lanzan** hacia el caller: reintentos acotados con `sleep_fn` inyectable, logs con wallet + battle id + error, sin secretos.
- Comandos de test: `cd backend && python -m pytest <ruta> -v` (mismo runner que la suite existente).
- No cambiar el comportamiento de los happy paths existentes: la suite completa debe seguir verde tras cada task.
- Mensajes de error de API en español (patrón existente); logs en inglés (patrón existente).
- Commits frecuentes, uno por task como mínimo.

---

### Task 1: Columna `BattlePull.refunded` + refunds idempotentes

**Files:**
- Modify: `backend/app/models.py` (clase `BattlePull`, ~línea 137)
- Modify: `backend/app/db.py` (`_ENSURE_COLUMNS`, `init_db`)
- Modify: `backend/app/services/refund.py`
- Test: `backend/tests/test_refund.py` (añadir tests)

**Interfaces:**
- Consumes: modelos y `refund_pack_void` / `refund_royale_void` existentes.
- Produces: `BattlePull.refunded: bool` (default `False`); `refund_pack_void` y `refund_royale_void` saltan pulls con `refunded=True` y marcan `refunded=True` tras cada devolución exitosa (transfer de carta, USDC de auto-sold, o buyback de eliminado). Las pulls auto-sold sin `buyback_amount` y las auto-sold de eliminados en royale se marcan `refunded=True` sin mover fondos (no hay nada que devolver).

- [ ] **Step 1: Tests que fallan — idempotencia de refunds**

Añadir al final de `backend/tests/test_refund.py` (usa la fixture `session` y los fakes ya presentes en ese archivo; si no existen helpers equivalentes, usar estos):

```python
# ── Idempotencia vía BattlePull.refunded ─────────────────────────────────────

def _mk_pack_void(session, bid="pv1"):
    from app.models import PackBattle, BattlePull
    session.add(PackBattle(id=bid, mode="pack", machine_code="m", price=50, max_players=2,
                           status="voided", escrow_wallet_id="eid", escrow_address="ESC"))
    session.add(BattlePull(battle_id=bid, player_wallet="A", memo="mA", nft_address="nftA",
                           insured_value=100, round_number=1))
    session.add(BattlePull(battle_id=bid, player_wallet="B", memo="mB", auto_sold=True,
                           buyback_amount=42_000_000, round_number=1))
    session.commit()
    return session.get(PackBattle, bid)


class _Signer:
    async def sign_solana(self, wallet_id, tx):
        return f"signed-{tx}"


async def _noslp(_):
    return None


@pytest.mark.asyncio
async def test_refund_pack_void_marks_refunded_and_second_call_is_noop(session):
    from app.models import BattlePull
    from app.services.refund import refund_pack_void
    b = _mk_pack_void(session)
    built, usdc = [], []
    async def btx(esc, dest, nft): built.append((dest, nft)); return f"x-{nft}"
    async def utx(src, dest, amt): usdc.append((dest, amt)); return "u-tx"
    async def sub(s): return "sig"
    async def ce(esc, nft): return True

    await refund_pack_void(session, b, escrow_wallet_id="eid", escrow_address="ESC",
                           build_transfer_tx=btx, submit_tx=sub, signer=_Signer(),
                           build_usdc_transfer_tx=utx, confirm_in_escrow=ce, sleep_fn=_noslp)
    assert built == [("A", "nftA")] and usdc == [("B", 42_000_000)]
    pulls = {p.player_wallet: p for p in session.query(BattlePull).filter_by(battle_id="pv1").all()}
    assert pulls["A"].refunded is True and pulls["B"].refunded is True

    # Segunda pasada (barrido): no se re-transfiere nada.
    await refund_pack_void(session, b, escrow_wallet_id="eid", escrow_address="ESC",
                           build_transfer_tx=btx, submit_tx=sub, signer=_Signer(),
                           build_usdc_transfer_tx=utx, confirm_in_escrow=ce, sleep_fn=_noslp)
    assert built == [("A", "nftA")] and usdc == [("B", 42_000_000)]


@pytest.mark.asyncio
async def test_refund_pack_void_autosold_sin_buyback_se_marca_sin_mover_fondos(session):
    from app.models import PackBattle, BattlePull
    from app.services.refund import refund_pack_void
    session.add(PackBattle(id="pv2", mode="pack", machine_code="m", price=50, max_players=2,
                           status="voided", escrow_wallet_id="eid", escrow_address="ESC"))
    session.add(BattlePull(battle_id="pv2", player_wallet="A", memo="mA", auto_sold=True,
                           buyback_amount=None, round_number=1))
    session.commit()
    b = session.get(PackBattle, "pv2")
    moved = []
    async def utx(src, dest, amt): moved.append(amt); return "u"
    async def btx(esc, dest, nft): moved.append(nft); return "x"
    async def sub(s): return "sig"
    async def ce(esc, nft): return True
    await refund_pack_void(session, b, escrow_wallet_id="eid", escrow_address="ESC",
                           build_transfer_tx=btx, submit_tx=sub, signer=_Signer(),
                           build_usdc_transfer_tx=utx, confirm_in_escrow=ce, sleep_fn=_noslp)
    assert moved == []
    p = session.query(BattlePull).filter_by(battle_id="pv2").first()
    assert p.refunded is True


@pytest.mark.asyncio
async def test_refund_pack_void_fallo_no_marca_refunded(session):
    """Si el submit falla todas las veces, refunded queda False (reintentable en el barrido)."""
    from app.models import BattlePull
    from app.services.refund import refund_pack_void
    b = _mk_pack_void(session, bid="pv3")
    async def btx(esc, dest, nft): return f"x-{nft}"
    async def utx(src, dest, amt): return "u-tx"
    async def sub_fail(s): raise RuntimeError("rpc down")
    async def ce(esc, nft): return True
    await refund_pack_void(session, b, escrow_wallet_id="eid", escrow_address="ESC",
                           build_transfer_tx=btx, submit_tx=sub_fail, signer=_Signer(),
                           build_usdc_transfer_tx=utx, confirm_in_escrow=ce,
                           sleep_fn=_noslp, max_attempts=2)
    pulls = session.query(BattlePull).filter_by(battle_id="pv3").all()
    assert all(p.refunded is False for p in pulls)


@pytest.mark.asyncio
async def test_refund_royale_void_marca_refunded_y_es_reentrante(session):
    from app.models import PackBattle, BattlePlayer, BattlePull
    from app.services.refund import refund_royale_void
    session.add(PackBattle(id="rv1", mode="royale", machine_code="m", price=50, max_players=3,
                           status="voided", escrow_wallet_id="eid", escrow_address="ESC"))
    session.add_all([
        BattlePlayer(battle_id="rv1", player_wallet="A"),                      # vivo
        BattlePlayer(battle_id="rv1", player_wallet="B"),                      # vivo
        BattlePlayer(battle_id="rv1", player_wallet="E", eliminated_round=1),  # eliminado
    ])
    session.add_all([
        BattlePull(battle_id="rv1", player_wallet="A", memo="mA", nft_address="nftA", round_number=1),
        BattlePull(battle_id="rv1", player_wallet="B", memo="mB", auto_sold=True,
                   buyback_amount=10_000_000, round_number=1),
        BattlePull(battle_id="rv1", player_wallet="E", memo="mE", nft_address="nftE", round_number=1),
        BattlePull(battle_id="rv1", player_wallet="E", memo="mE2", auto_sold=True,
                   buyback_amount=5_000_000, round_number=2),
    ])
    session.commit()
    b = session.get(PackBattle, "rv1")
    built, usdc, buybacks = [], [], []
    async def btx(esc, dest, nft): built.append((dest, nft)); return f"x-{nft}"
    async def utx(src, dest, amt): usdc.append((dest, amt)); return "u"
    async def sub(s): return "sig"
    async def ce(esc, nft): return True
    async def bb(nft): buybacks.append(nft)
    async def bal(esc): return 0   # sin sobrante → sin split

    kw = dict(escrow_wallet_id="eid", escrow_address="ESC", build_transfer_tx=btx,
              submit_tx=sub, signer=_Signer(), build_usdc_transfer_tx=utx,
              buyback_to_escrow=bb, escrow_usdc_balance=bal, confirm_in_escrow=ce,
              sleep_fn=_noslp)
    await refund_royale_void(session, b, **kw)
    assert built == [("A", "nftA")]
    assert usdc == [("B", 10_000_000)]
    assert buybacks == ["nftE"]
    pulls = session.query(BattlePull).filter_by(battle_id="rv1").all()
    assert all(p.refunded is True for p in pulls)   # incl. auto-sold del eliminado (nada que devolver)

    # Re-ejecución completa (barrido): nada se repite.
    await refund_royale_void(session, b, **kw)
    assert built == [("A", "nftA")] and usdc == [("B", 10_000_000)] and buybacks == ["nftE"]
```

- [ ] **Step 2: Verificar que fallan**

Run: `cd backend && python -m pytest tests/test_refund.py -v -k "refunded or reentrante or sin_buyback or no_marca"`
Expected: FAIL — `AttributeError: 'BattlePull' object has no attribute 'refunded'` (o asserts de marcado).

- [ ] **Step 3: Implementación**

`backend/app/models.py` — en `BattlePull`, tras la línea de `transferred`:

```python
    transferred: Mapped[bool] = mapped_column(Boolean, default=False)
    refunded: Mapped[bool] = mapped_column(Boolean, default=False)   # devolución post-void enviada
    buyback_amount: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
```

`backend/app/db.py` — añadir a `_ENSURE_COLUMNS`:

```python
    ("battle_pulls", "refunded", "BOOLEAN NOT NULL DEFAULT 0"),
```

y en el mismo archivo, backfill one-shot (solo cuando la columna acaba de crearse, para que el barrido de reconciliación no re-refundee batallas históricas):

```python
def _backfill_refunded(engine):
    """One-shot al añadir battle_pulls.refunded: las batallas ya terminadas se dan por
    saldadas (sus refunds ocurrieron antes de existir el flag). Solo se llama cuando la
    columna acaba de crearse — ver init_db."""
    insp = inspect(engine)
    if "battle_pulls" not in set(insp.get_table_names()):
        return
    with engine.begin() as conn:
        conn.execute(text(
            "UPDATE battle_pulls SET refunded = 1 WHERE battle_id IN "
            "(SELECT id FROM pack_battles WHERE status IN ('settled', 'voided', 'cancelled'))"
        ))


def init_db(engine):
    # importa los modelos para registrarlos en Base.metadata antes de create_all
    from . import models  # noqa: F401
    insp = inspect(engine)
    had_refunded = ("battle_pulls" in set(insp.get_table_names())
                    and "refunded" in {c["name"] for c in insp.get_columns("battle_pulls")})
    Base.metadata.create_all(engine)
    _ensure_columns(engine)
    if not had_refunded:
        _backfill_refunded(engine)
    _backfill_gacha_price(engine)
```

`backend/app/services/refund.py` — `refund_pack_void`, reemplazar el cuerpo del bucle:

```python
    pulls = session.query(BattlePull).filter_by(battle_id=battle.id).all()
    for p in pulls:
        if p.refunded:
            continue
        if p.auto_sold:
            if not p.buyback_amount:
                p.refunded = True   # nada que devolver; no re-seleccionar en barridos
                session.commit()
                continue
            ok = await _sign_submit_retry(
                lambda p=p: build_usdc_transfer_tx(escrow_address, p.player_wallet, p.buyback_amount),
                signer=signer, escrow_wallet_id=escrow_wallet_id, submit_tx=submit_tx,
                sleep_fn=sleep_fn, wait_delay=wait_delay, max_attempts=max_attempts,
                ctx=f"pack void usdc {p.player_wallet} in {battle.id}", operator_wallet_id=operator_wallet_id)
        elif p.nft_address:
            async def _build(p=p):
                await _wait_in_escrow(confirm_in_escrow, escrow_address, p.nft_address,
                                      sleep_fn, wait_max_attempts, wait_delay)
                return await build_transfer_tx(escrow_address, p.player_wallet, p.nft_address)
            ok = await _sign_submit_retry(
                _build, signer=signer, escrow_wallet_id=escrow_wallet_id, submit_tx=submit_tx,
                sleep_fn=sleep_fn, wait_delay=wait_delay, max_attempts=max_attempts,
                ctx=f"pack void card {p.nft_address} in {battle.id}")
        else:
            continue   # memo sin resolver: lo cubre la reconciliación, no hay nada que devolver aún
        if ok:
            p.refunded = True
            session.commit()
```

`refund_royale_void` — pasos 1+2 (pulls de vivos): misma estructura (saltar `p.refunded`, capturar `ok = await _sign_submit_retry(...)`, marcar + commit si `ok`; auto-sold sin `buyback_amount` → marcar sin mover). Paso 3 (buybacks de eliminados), reemplazar por:

```python
    # 3: buy back each eliminated player's non-common cards → USDC into the escrow.
    for p in pulls:
        if p.player_wallet not in eliminated or p.refunded:
            continue
        if p.auto_sold or not p.nft_address:
            p.refunded = True   # su USDC/nada quedó en el escrow por diseño; no re-seleccionar
            session.commit()
            continue
        for _ in range(max_attempts):
            try:
                await buyback_to_escrow(p.nft_address)
                p.refunded = True
                session.commit()
                break
            except Exception as exc:
                logger.warning("royale void buyback %s in %s: retry: %s", p.nft_address, battle.id, exc)
                await sleep_fn(wait_delay)
```

El paso 4+5 (split del sobrante) queda como está: lee el balance actual, así que re-ejecutarlo solo reparte dinero nuevo.

- [ ] **Step 4: Verificar que pasan + suite de refund completa**

Run: `cd backend && python -m pytest tests/test_refund.py tests/test_models.py -v`
Expected: PASS (los tests antiguos de refund siguen verdes: no marcaban `refunded` y ahora los fakes exitosos lo marcan, sin afectar sus asserts).

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/app/db.py backend/app/services/refund.py backend/tests/test_refund.py
git commit -m "feat(refund): BattlePull.refunded flag makes void refunds idempotent/re-runnable"
```

---

### Task 2: Servicio `reconcile.py`

**Files:**
- Create: `backend/app/services/reconcile.py`
- Test: `backend/tests/test_reconcile.py` (nuevo)

**Interfaces:**
- Consumes: `gacha.open_pack(memo) -> dict` (mismo contrato que el engine: `{"pending": bool, "nft_address": str, "insured_value": float, "grade": int, "rarity": str, "year": str, "name": str, "auto_sold": bool, "buyback_amount": int}`), `BattlePull` (incl. `refunded` de Task 1).
- Produces:
  - `async def reconcile_unresolved_pulls(session, battle, *, gacha, sleep_fn=None, max_attempts=5, delay=3.0) -> int` — re-consulta cada pull con `memo` sin `nft_address`; persiste los campos si resuelve; devuelve cuántas resolvió; nunca lanza.
  - `def has_pending_refunds(session, battle) -> bool` — `True` si alguna pull del battle tiene `refunded=False`.

- [ ] **Step 1: Tests que fallan**

`backend/tests/test_reconcile.py`:

```python
"""Tests de reconcile_unresolved_pulls / has_pending_refunds."""
import pytest
from app.db import make_engine, make_session_factory, init_db
from app.models import PackBattle, BattlePull


@pytest.fixture
def session():
    e = make_engine("sqlite:///:memory:")
    init_db(e)
    with make_session_factory(e)() as s:
        yield s


def _mk(session, bid="v1", pulls=()):
    session.add(PackBattle(id=bid, mode="pack", machine_code="m", price=50, max_players=2,
                           status="voided", escrow_wallet_id="eid", escrow_address="ESC"))
    for p in pulls:
        session.add(p)
    session.commit()
    return session.get(PackBattle, bid)


class _Gacha:
    """opens: memo -> resultado; los memos que no estén devuelven pending=True siempre."""
    def __init__(self, opens):
        self.opens = opens
        self.calls = []

    async def open_pack(self, memo):
        self.calls.append(memo)
        return self.opens.get(memo, {"pending": True})


async def _noslp(_):
    return None


@pytest.mark.asyncio
async def test_reconcile_resuelve_pull_pendiente_y_persiste_campos(session):
    from app.services.reconcile import reconcile_unresolved_pulls
    b = _mk(session, pulls=[BattlePull(battle_id="v1", player_wallet="A", memo="mA", round_number=1)])
    gacha = _Gacha({"mA": {"pending": False, "nft_address": "nftA", "insured_value": 120,
                           "grade": 9, "rarity": "Epic", "year": "1999", "name": "Charizard",
                           "auto_sold": False}})
    n = await reconcile_unresolved_pulls(session, b, gacha=gacha, sleep_fn=_noslp)
    assert n == 1
    p = session.query(BattlePull).filter_by(battle_id="v1").first()
    assert p.nft_address == "nftA" and p.insured_value == 120 and p.rarity == "Epic"
    assert p.name == "Charizard" and p.auto_sold is False


@pytest.mark.asyncio
async def test_reconcile_pull_que_nunca_resuelve_devuelve_cero_sin_lanzar(session):
    from app.services.reconcile import reconcile_unresolved_pulls
    b = _mk(session, pulls=[BattlePull(battle_id="v1", player_wallet="A", memo="mA", round_number=1)])
    gacha = _Gacha({})   # siempre pending
    n = await reconcile_unresolved_pulls(session, b, gacha=gacha, sleep_fn=_noslp, max_attempts=2)
    assert n == 0
    assert session.query(BattlePull).filter_by(battle_id="v1").first().nft_address is None


@pytest.mark.asyncio
async def test_reconcile_ignora_pulls_ya_resueltas(session):
    from app.services.reconcile import reconcile_unresolved_pulls
    b = _mk(session, pulls=[BattlePull(battle_id="v1", player_wallet="A", memo="mA",
                                       nft_address="nftA", round_number=1)])
    gacha = _Gacha({})
    n = await reconcile_unresolved_pulls(session, b, gacha=gacha, sleep_fn=_noslp)
    assert n == 0 and gacha.calls == []


@pytest.mark.asyncio
async def test_reconcile_gacha_exception_no_lanza(session):
    from app.services.reconcile import reconcile_unresolved_pulls
    b = _mk(session, pulls=[BattlePull(battle_id="v1", player_wallet="A", memo="mA", round_number=1)])
    class _Boom:
        async def open_pack(self, memo):
            raise RuntimeError("cc down")
    n = await reconcile_unresolved_pulls(session, b, gacha=_Boom(), sleep_fn=_noslp)
    assert n == 0


def test_has_pending_refunds(session):
    from app.services.reconcile import has_pending_refunds
    b = _mk(session, pulls=[
        BattlePull(battle_id="v1", player_wallet="A", memo="mA", nft_address="nftA",
                   refunded=True, round_number=1),
        BattlePull(battle_id="v1", player_wallet="B", memo="mB", round_number=1),
    ])
    assert has_pending_refunds(session, b) is True
    session.query(BattlePull).filter_by(player_wallet="B").first().refunded = True
    session.commit()
    assert has_pending_refunds(session, b) is False
```

- [ ] **Step 2: Verificar que fallan**

Run: `cd backend && python -m pytest tests/test_reconcile.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.reconcile'`.

- [ ] **Step 3: Implementación**

`backend/app/services/reconcile.py`:

```python
"""Reconciliación de pulls sin resolver: una pull con memo pero sin nft_address pudo quedar
pagada sin carta (CC resolvió tarde, o crash entre submit y open). Re-consultamos el memo y,
si ya resolvió, persistimos la carta para que el refund de void la devuelva a su dueño.
Nunca lanza (misma filosofía que refund/settle)."""
from __future__ import annotations
import asyncio
import logging

from app.models import BattlePull

logger = logging.getLogger(__name__)


async def reconcile_unresolved_pulls(session, battle, *, gacha, sleep_fn=None,
                                     max_attempts=5, delay=3.0) -> int:
    """Re-poll open_pack(memo) para cada pull sin resolver del battle. Devuelve cuántas
    quedaron resueltas (campos persistidos). Las que sigan pendientes se dejan tal cual
    para el próximo barrido."""
    sleep_fn = sleep_fn or asyncio.sleep
    resolved = 0
    pulls = session.query(BattlePull).filter_by(battle_id=battle.id).all()
    for p in pulls:
        if p.nft_address or not p.memo:
            continue
        try:
            res = await gacha.open_pack(p.memo)
            attempts = 0
            while res.get("pending") and attempts < max_attempts:
                await sleep_fn(delay)
                res = await gacha.open_pack(p.memo)
                attempts += 1
            if res.get("pending") or not res.get("nft_address"):
                logger.warning("reconcile: pull %s in battle %s still unresolved", p.memo, battle.id)
                continue
            p.nft_address = res["nft_address"]
            p.insured_value = res.get("insured_value") or 0
            p.grade = res.get("grade")
            p.rarity = res.get("rarity")
            p.year = res.get("year")
            p.name = res.get("name")
            p.auto_sold = bool(res.get("auto_sold"))
            p.buyback_amount = res.get("buyback_amount")
            session.commit()
            resolved += 1
            logger.info("reconcile: pull %s in battle %s resolved late to %s",
                        p.memo, battle.id, p.nft_address)
        except Exception as exc:
            logger.warning("reconcile: open_pack failed for %s in battle %s: %s",
                           p.memo, battle.id, exc)
    return resolved


def has_pending_refunds(session, battle) -> bool:
    """True si alguna pull del battle sigue sin refund (guía del barrido post-void)."""
    pulls = session.query(BattlePull).filter_by(battle_id=battle.id).all()
    return any(not p.refunded for p in pulls)
```

- [ ] **Step 4: Verificar que pasan**

Run: `cd backend && python -m pytest tests/test_reconcile.py -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/reconcile.py backend/tests/test_reconcile.py
git commit -m "feat(reconcile): late-resolve unresolved pulls so void refunds can return them"
```

---

### Task 3: Wiring — reconciliar antes de refundear + `reconcile_voided_battle_live`

**Files:**
- Modify: `backend/app/services/pack_orchestration.py`
- Test: `backend/tests/test_pack_orchestration.py` (añadir tests)

**Interfaces:**
- Consumes: `reconcile_unresolved_pulls` / `has_pending_refunds` (Task 2), `refund_pack_void` / `refund_royale_void` (Task 1), closures existentes del módulo.
- Produces: `async def reconcile_voided_battle_live(session, battle, *, gacha, signer, rpc_url, usdc_mint, token_program=TOKEN_PROGRAM, operator_wallet_id="", operator_address="") -> None` — barrido idempotente post-void (reconcilia + refundea por modo; early-return si no hay nada pendiente). Los tres paths de void existentes (`run_pack_battle_live`, `resume_pack_battle_live`, `run_royale_live`) reconcilian ANTES del refund.

- [ ] **Step 1: Tests que fallan**

Añadir a `backend/tests/test_pack_orchestration.py` (sigue el patrón de monkeypatch del módulo usado por `test_run_pack_battle_live_invokes_refund_on_void`):

```python
@pytest.mark.asyncio
async def test_void_reconcilia_antes_de_refundear(session, monkeypatch):
    """En el path de void, reconcile_unresolved_pulls corre ANTES que refund_pack_void."""
    import app.services.pack_orchestration as po
    order = []

    async def fake_run(*a, **kw):
        return "voided"
    async def fake_reconcile(session, battle, **kw):
        order.append("reconcile"); return 0
    async def fake_refund(session, battle, **kw):
        order.append("refund")
    monkeypatch.setattr(po, "run_battle", fake_run)
    monkeypatch.setattr(po, "reconcile_unresolved_pulls", fake_reconcile)
    monkeypatch.setattr(po, "refund_pack_void", fake_refund)

    from app.models import PackBattle
    b = PackBattle(id="w1", mode="pack", machine_code="m", price=50, max_players=2,
                   status="running", server_seed="ab" * 32)
    session.add(b); session.commit()

    class _S:
        async def sign_solana(self, wid, tx): return "s"
    out = await po.run_pack_battle_live(session, b, gacha=object(), signer=_S(),
                                        rpc_url="http://rpc", usdc_mint="M" * 32,
                                        min_usdc_base_units=50)
    assert out == "voided"
    assert order == ["reconcile", "refund"]


@pytest.mark.asyncio
async def test_reconcile_voided_battle_live_early_return_sin_pendientes(session, monkeypatch):
    """Con todas las pulls refunded, el barrido no reconcilia ni refundea."""
    import app.services.pack_orchestration as po
    from app.models import PackBattle, BattlePull
    called = []
    async def fake_reconcile(*a, **kw): called.append("reconcile"); return 0
    async def fake_refund(*a, **kw): called.append("refund")
    monkeypatch.setattr(po, "reconcile_unresolved_pulls", fake_reconcile)
    monkeypatch.setattr(po, "refund_pack_void", fake_refund)

    b = PackBattle(id="w2", mode="pack", machine_code="m", price=50, max_players=2,
                   status="voided", escrow_wallet_id="eid", escrow_address="ESC")
    session.add(b)
    session.add(BattlePull(battle_id="w2", player_wallet="A", memo="mA", nft_address="n",
                           refunded=True, round_number=1))
    session.commit()
    await po.reconcile_voided_battle_live(session, b, gacha=object(), signer=object(),
                                          rpc_url="http://rpc", usdc_mint="M" * 32)
    assert called == []


@pytest.mark.asyncio
async def test_reconcile_voided_battle_live_pack_reconcilia_y_refundea(session, monkeypatch):
    import app.services.pack_orchestration as po
    from app.models import PackBattle, BattlePull
    order = []
    async def fake_reconcile(session, battle, **kw): order.append("reconcile"); return 1
    async def fake_refund(session, battle, **kw): order.append("refund")
    monkeypatch.setattr(po, "reconcile_unresolved_pulls", fake_reconcile)
    monkeypatch.setattr(po, "refund_pack_void", fake_refund)

    b = PackBattle(id="w3", mode="pack", machine_code="m", price=50, max_players=2,
                   status="voided", escrow_wallet_id="eid", escrow_address="ESC")
    session.add(b)
    session.add(BattlePull(battle_id="w3", player_wallet="A", memo="mA", round_number=1))
    session.commit()
    await po.reconcile_voided_battle_live(session, b, gacha=object(), signer=object(),
                                          rpc_url="http://rpc", usdc_mint="M" * 32)
    assert order == ["reconcile", "refund"]


@pytest.mark.asyncio
async def test_reconcile_voided_battle_live_royale_usa_refund_royale(session, monkeypatch):
    import app.services.pack_orchestration as po
    from app.models import PackBattle, BattlePull
    order = []
    async def fake_reconcile(session, battle, **kw): order.append("reconcile"); return 0
    async def fake_refund_royale(session, battle, **kw): order.append("refund_royale")
    monkeypatch.setattr(po, "reconcile_unresolved_pulls", fake_reconcile)
    monkeypatch.setattr(po, "refund_royale_void", fake_refund_royale)

    b = PackBattle(id="w4", mode="royale", machine_code="m", price=50, max_players=5,
                   status="voided", escrow_wallet_id="eid", escrow_address="ESC")
    session.add(b)
    session.add(BattlePull(battle_id="w4", player_wallet="A", memo="mA", round_number=1))
    session.commit()
    await po.reconcile_voided_battle_live(session, b, gacha=object(), signer=object(),
                                          rpc_url="http://rpc", usdc_mint="M" * 32)
    assert order == ["reconcile", "refund_royale"]
```

- [ ] **Step 2: Verificar que fallan**

Run: `cd backend && python -m pytest tests/test_pack_orchestration.py -v -k "reconcil"`
Expected: FAIL — `AttributeError: module ... has no attribute 'reconcile_unresolved_pulls'` / `'reconcile_voided_battle_live'`.

- [ ] **Step 3: Implementación**

En `backend/app/services/pack_orchestration.py`:

1. Imports (arriba, junto a los de refund):

```python
import logging

from app.services.refund import refund_pack_void, refund_royale_void
from app.services.reconcile import reconcile_unresolved_pulls, has_pending_refunds

logger = logging.getLogger(__name__)
```

2. En `run_pack_battle_live`, `resume_pack_battle_live` y `run_royale_live`, justo antes de su `await refund_..._void(...)` del path `voided`, insertar:

```python
    if result == "voided":
        await reconcile_unresolved_pulls(session, battle, gacha=gacha)
        await refund_pack_void(   # (o refund_royale_void en run_royale_live, sin otros cambios)
            ...
        )
```

3. Nueva función al final del módulo (reutiliza las mismas closures que los paths live):

```python
async def reconcile_voided_battle_live(session, battle, *, gacha, signer, rpc_url: str,
                                       usdc_mint: str, token_program: str = TOKEN_PROGRAM,
                                       operator_wallet_id: str = "", operator_address: str = "") -> None:
    """Barrido post-void (startup / tarea diferida): re-poll de memos sin resolver + refund de lo
    pendiente. Idempotente vía BattlePull.refunded; early-return si no queda nada. Nunca lanza."""
    try:
        if not battle.escrow_address or not has_pending_refunds(session, battle):
            return
        await reconcile_unresolved_pulls(session, battle, gacha=gacha)

        async def build_transfer_tx(esc, dest, nft):
            bh = await fetch_latest_blockhash(rpc_url)
            return await build_transfer(rpc_url, esc, dest, nft, bh)

        submit_tx = lambda signed: submit_signed_tx(rpc_url, signed)  # noqa: E731
        confirm_in_escrow = lambda esc, mint: nft_in_owner(rpc_url, esc, mint)  # noqa: E731

        async def build_usdc_transfer_tx(src, dest, amount):
            bh = await fetch_latest_blockhash(rpc_url)
            return build_token_transfer(src, dest, usdc_mint, bh, amount=amount, decimals=6,
                                        fee_payer=operator_address)

        if battle.mode == "royale":
            async def buyback_to_escrow(nft):
                bb = await gacha.buyback(battle.escrow_address, nft)
                txb = bb.get("serialized_transaction")
                if not txb:
                    return
                signed = await signer.sign_solana(battle.escrow_wallet_id, txb)
                await gacha.submit_tx(signed)

            async def escrow_usdc_balance(esc_addr):
                return await usdc_balance_base_units(rpc_url, esc_addr, usdc_mint)

            await refund_royale_void(
                session, battle, escrow_wallet_id=battle.escrow_wallet_id,
                escrow_address=battle.escrow_address, build_transfer_tx=build_transfer_tx,
                submit_tx=submit_tx, signer=signer, build_usdc_transfer_tx=build_usdc_transfer_tx,
                buyback_to_escrow=buyback_to_escrow, escrow_usdc_balance=escrow_usdc_balance,
                confirm_in_escrow=confirm_in_escrow, operator_wallet_id=operator_wallet_id,
            )
        else:
            await refund_pack_void(
                session, battle, escrow_wallet_id=battle.escrow_wallet_id,
                escrow_address=battle.escrow_address, build_transfer_tx=build_transfer_tx,
                submit_tx=submit_tx, signer=signer, build_usdc_transfer_tx=build_usdc_transfer_tx,
                confirm_in_escrow=confirm_in_escrow, operator_wallet_id=operator_wallet_id,
            )
    except Exception:
        logger.exception("reconcile sweep failed for battle %s", battle.id)
```

Nota: los tests monkeypatchean `po.refund_pack_void` / `po.refund_royale_void` / `po.reconcile_unresolved_pulls`, así que los paths de void deben llamarlos como atributos de módulo (`refund_pack_void(...)` con el import a nivel de módulo mostrado arriba — que es como ya está importado hoy, verificar que no se importan dentro de la función).

- [ ] **Step 4: Verificar**

Run: `cd backend && python -m pytest tests/test_pack_orchestration.py -v`
Expected: PASS completo (los existentes + 4 nuevos).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/pack_orchestration.py backend/tests/test_pack_orchestration.py
git commit -m "feat(orchestration): reconcile unresolved pulls before void refunds + voided-battle sweep helper"
```

---

### Task 4: `main.py` — barrido de startup + reconciliación diferida tras void en caliente

**Files:**
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_pack_lobby_api.py` (añadir tests)

**Interfaces:**
- Consumes: `reconcile_voided_battle_live` (Task 3).
- Produces: (1) `_run_bg` / `_run_royale_bg` capturan el resultado y, si es `"voided"`, programan `_reconcile_voided_later(battle_id)` (sleep 300s → sesión fresca → `reconcile_voided_battle_live`); (2) `_resume_orphaned_battles` añade un barrido sobre batallas `voided` que lanza `reconcile_voided_battle_live` por cada una en un task.

- [ ] **Step 1: Tests que fallan**

Añadir a `backend/tests/test_pack_lobby_api.py` (usar los helpers del archivo: forma de construir la app con `create_app`, `client_priv`, monkeypatch de `app.main`):

```python
def test_startup_sweep_reconcilia_batallas_voided(monkeypatch):
    """Al arrancar, cada batalla voided pasa por reconcile_voided_battle_live."""
    import app.main as m
    from app.models import PackBattle, BattlePull

    swept = []
    async def fake_sweep(session, battle, **kw):
        swept.append(battle.id)
    monkeypatch.setattr(m, "reconcile_voided_battle_live", fake_sweep)

    # Construir la app igual que los tests de resume/startup existentes en este archivo
    # (session_factory en memoria + privy_signer y gacha fakes), sembrando antes:
    #   - battle "vd1" voided con una pull sin refund
    #   - battle "ok1" settled (no debe barrerse)
    session_factory, app_, client = _mk_app_with_db(monkeypatch)   # helper del archivo o equivalente
    with session_factory() as s:
        s.add(PackBattle(id="vd1", mode="pack", machine_code="m", price=50, max_players=2,
                         status="voided", escrow_wallet_id="eid", escrow_address="ESC"))
        s.add(BattlePull(battle_id="vd1", player_wallet="A", memo="mA", round_number=1))
        s.add(PackBattle(id="ok1", mode="pack", machine_code="m", price=50, max_players=2,
                         status="settled"))
        s.commit()
    with client:   # TestClient context → dispara startup y ejecuta los tasks pendientes
        pass
    assert swept == ["vd1"]


def test_run_bg_voided_programa_reconciliacion_diferida(monkeypatch):
    """_run_bg con resultado voided programa _reconcile_voided_later(battle_id)."""
    import app.main as m
    scheduled = []
    async def fake_run_live(session, battle, **kw):
        return "voided"
    monkeypatch.setattr(m, "run_pack_battle_live", fake_run_live)
    # capturar la tarea diferida sin esperar los 300s: monkeypatch del delay a 0 vía parámetro
    ...
```

Nota de implementación del test: para no dormir 300s, `_reconcile_voided_later` acepta `delay_s` y `_run_bg` lo programa con el default; el test llama `await m_app._reconcile_voided_later("vd1", delay_s=0)` directamente (la función se expone para test vía el truco existente del archivo para funciones internas, o se prueba indirectamente: monkeypatch de `asyncio.sleep` no es necesario si el test invoca el helper con `delay_s=0` y assertea que `reconcile_voided_battle_live` fue llamado con la batalla). Si las funciones internas de `create_app` no son accesibles, testear solo el startup sweep (test anterior) y el wiring del task con un assert sobre `asyncio.create_task` monkeypatcheado — seguir el patrón que ya usa este archivo para `test_second_player_join_schedules_run`.

- [ ] **Step 2: Verificar que fallan**

Run: `cd backend && python -m pytest tests/test_pack_lobby_api.py -v -k "sweep or diferida"`
Expected: FAIL — `AttributeError: module 'app.main' has no attribute 'reconcile_voided_battle_live'`.

- [ ] **Step 3: Implementación**

En `backend/app/main.py`:

1. Import: añadir `reconcile_voided_battle_live` y (para Task 7) `resume_royale_live` al import de `.services.pack_orchestration`.

2. Dentro de `create_app`, junto a `_run_bg`:

```python
    _RECONCILE_DELAY_S = 300   # reintento de reconciliación tras un void en caliente

    async def _reconcile_voided_later(battle_id: str, delay_s: float = _RECONCILE_DELAY_S):
        """Tras un void en caliente puede quedar una pull pagada sin resolver (CC lento). Reintenta
        la reconciliación + refund con sesión fresca cuando CC haya tenido tiempo de resolver."""
        try:
            await asyncio.sleep(delay_s)
            s3 = session_factory()
            try:
                b = s3.get(PackBattle, battle_id)
                if b is not None and b.status == "voided":
                    await reconcile_voided_battle_live(
                        s3, b, gacha=gacha, signer=privy_signer, rpc_url=solana_rpc_url,
                        usdc_mint=cc_usdc_mint, operator_wallet_id=privy_operator_wallet_id,
                        operator_address=privy_operator_address)
            finally:
                s3.close()
        except Exception:
            logger.exception("deferred reconcile failed for %s", battle_id)
```

3. `_run_bg`: capturar el resultado y programar la diferida:

```python
            result = await run_pack_battle_live(...)   # llamada existente, ahora asignada
            if result == "voided":
                asyncio.create_task(_reconcile_voided_later(battle_id))
```

Igual en `_run_royale_bg` con `run_royale_live`.

4. En `_resume_orphaned_battles`, tras el bucle de `running`, añadir el barrido:

```python
        # Barrido de reconciliación: batallas voided con refunds/pulls pendientes.
        try:
            with session_factory() as s1:
                voided_ids = [b.id for b in s1.query(PackBattle).filter_by(status="voided").all()]
        except Exception:
            logger.warning("resume: could not query voided battles for reconcile sweep")
            voided_ids = []

        async def _sweep_one(battle_id):
            s2 = session_factory()
            try:
                b = s2.get(PackBattle, battle_id)
                if b is not None:
                    await reconcile_voided_battle_live(
                        s2, b, gacha=gacha, signer=privy_signer, rpc_url=solana_rpc_url,
                        usdc_mint=cc_usdc_mint, operator_wallet_id=privy_operator_wallet_id,
                        operator_address=privy_operator_address)
            except Exception:
                logger.warning("reconcile sweep failed for %s", battle_id)
            finally:
                s2.close()

        for bid in voided_ids:
            asyncio.create_task(_sweep_one(battle_id=bid))
```

(`reconcile_voided_battle_live` ya hace early-return para batallas sin nada pendiente, así que barrer todos los `voided` es barato: 1 query por batalla.)

- [ ] **Step 4: Verificar**

Run: `cd backend && python -m pytest tests/test_pack_lobby_api.py -v`
Expected: PASS completo.

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py backend/tests/test_pack_lobby_api.py
git commit -m "feat(main): startup reconcile sweep + deferred reconcile after hot voids"
```

---

### Task 5: Refactor `royale_engine` — extraer `_play_round` y `_settle_and_finish` (sin cambio de comportamiento)

**Files:**
- Modify: `backend/app/services/royale_engine.py`
- Test: los existentes `backend/tests/test_royale_engine.py` (sin tests nuevos: refactor guardado por la suite)

**Interfaces:**
- Consumes: cuerpo actual de `run_royale`.
- Produces (a nivel de módulo, usados por `resume_royale` en Task 6):
  - `async def _play_round(session, battle, *, esc_addr, remaining, accumulated, round_number, gacha, signer, resolve_wallet_id, distribute, confirm_usdc, price_base, sleep_fn, max_attempts, delay, skip_existing=False, fund_guard=False) -> None` — juega UNA ronda completa (fondeo+pull por jugador en orden `remaining`, eliminación, persistencia de `BattleRound`/`eliminated_round`/`accumulated_value`). Muta `remaining` (quita al eliminado) y `accumulated` in place. `skip_existing=True`: los jugadores con pull **resuelta** ya persistida en `round_number` no re-tiran (su `insured_value` ya está en `accumulated`); sus nfts entran en `round_nfts` en orden de `remaining`. `fund_guard=True`: antes de `distribute`, si `confirm_usdc(w, price_base)` ya es True se salta el distribute (el pre-crash llegó).
  - `async def _settle_and_finish(session, battle, *, winner, players, esc, gacha, signer, resolve_wallet_id, build_transfer_tx, submit_tx, confirm_in_escrow, build_usdc_sweep_tx, usdc_balance, build_usdc_transfer_tx, operator_wallet_id, now_fn, sleep_fn, max_attempts, delay) -> str` — settle + fee + `settled` + loyalty (el bloque actual desde `settle_cards_to_winner` hasta `return "settled"`).

- [ ] **Step 1: Refactor**

Mover el cuerpo del `for w in remaining:` + bloque de eliminación de `run_royale` a `_play_round` (código idéntico salvo los dos flags):

```python
async def _play_round(session, battle, *, esc_addr, remaining, accumulated, round_number,
                      gacha, signer, resolve_wallet_id, distribute, confirm_usdc,
                      price_base, sleep_fn, max_attempts, delay,
                      skip_existing=False, fund_guard=False) -> None:
    round_nfts = []
    existing = {}
    if skip_existing:
        existing = {p.player_wallet: p for p in
                    session.query(BattlePull).filter_by(battle_id=battle.id,
                                                        round_number=round_number).all()
                    if p.nft_address}
    for w in remaining:
        prev = existing.get(w)
        if prev is not None:
            round_nfts.append(prev.nft_address)   # tiró antes del restart; ya cuenta en accumulated
            continue
        # fund_guard: si el distribute pre-crash llegó, no re-fondear (doble fondeo drenaría el
        # pool y haría fallar rondas futuras). Carrera residual (distribute en vuelo que aterriza
        # tras el check) → pool corto → void limpio más adelante; aceptado en el spec.
        if not (fund_guard and await confirm_usdc(w, price_base)):
            await distribute(esc_addr, w, price_base)
        for _ in range(max_attempts):
            if await confirm_usdc(w, price_base):
                break
            await sleep_fn(delay)
        else:
            raise RuntimeError(f"usdc not delivered to {w}")
        pack = await gacha.generate_pack(player_address=w, pack_type=battle.machine_code,
                                         alt_player_address=esc_addr, turbo=True)
        pull = BattlePull(battle_id=battle.id, player_wallet=w, memo=pack["memo"],
                          round_number=round_number)
        session.add(pull)
        session.commit()
        signed = await signer.sign_solana(resolve_wallet_id(w), pack["transaction"])
        sub = await gacha.submit_tx(signed)
        if not sub.get("signature"):
            raise RuntimeError("pull submit failed")
        res = await gacha.open_pack(pack["memo"])
        attempts = 0
        while res.get("pending") and attempts < max_attempts:
            await sleep_fn(delay)
            res = await gacha.open_pack(pack["memo"])
            attempts += 1
        if res.get("pending") or not res.get("nft_address"):
            raise RuntimeError("pull did not resolve")
        pull.nft_address = res["nft_address"]
        pull.insured_value = res.get("insured_value") or 0
        pull.grade = res.get("grade")
        pull.rarity = res.get("rarity")
        pull.year = res.get("year")
        pull.name = res.get("name")
        pull.auto_sold = bool(res.get("auto_sold"))
        pull.buyback_amount = res.get("buyback_amount")
        session.commit()
        accumulated[w] += res.get("insured_value") or 0
        round_nfts.append(res["nft_address"])

    # Eliminate the player with the lowest accumulated insured_value
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
```

Y el tramo final de settle a `_settle_and_finish` (código idéntico al bloque actual desde `winner = remaining[0]`, parametrizando `winner`, `players`, `esc`). `run_royale` queda: setup escrow + funding check + `while len(remaining) > 1: round_number += 1; await _play_round(...)` + `return await _settle_and_finish(...)`, dentro del mismo `try/except → _void` actual.

- [ ] **Step 2: Verificar cero regresiones**

Run: `cd backend && python -m pytest tests/test_royale_engine.py tests/test_pack_orchestration.py -v`
Expected: PASS completo, sin tocar ningún test.

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/royale_engine.py
git commit -m "refactor(royale): extract _play_round/_settle_and_finish for the upcoming resume path"
```

---

### Task 6: `resume_royale` — el engine continúa una royale huérfana

**Files:**
- Modify: `backend/app/services/royale_engine.py`
- Test: `backend/tests/test_royale_resume.py` (nuevo)

**Interfaces:**
- Consumes: `_play_round`, `_settle_and_finish`, `_void` (Task 5), `reconcile_unresolved_pulls` (Task 2).
- Produces: `async def resume_royale(session, battle, *, gacha, signer, resolve_wallet_id, distribute, confirm_usdc, confirm_in_escrow, build_transfer_tx, submit_tx, price_base, now_fn, sleep_fn=None, max_attempts=20, delay=3.0, build_usdc_sweep_tx=None, operator_wallet_id="", usdc_balance=None, build_usdc_transfer_tx=None, reconcile_max_attempts=5) -> str` — devuelve `"settled"` o `"voided"`. Sin `prepare_escrow` (el re-seed condicional de gas vive en el wiring, Task 7).

- [ ] **Step 1: Tests que fallan**

`backend/tests/test_royale_resume.py`:

```python
"""resume_royale: retomar una royale huérfana en 'running' tras un restart del backend."""
import pytest
from app.db import make_engine, make_session_factory, init_db
from app.models import PackBattle, BattlePlayer, BattlePull, BattleRound
from app.services.royale_engine import resume_royale


@pytest.fixture
def session():
    e = make_engine("sqlite:///:memory:")
    init_db(e)
    with make_session_factory(e)() as s:
        yield s


class _Gacha:
    """values: (wallet, n) -> insured_value, n = nº de pull POST-RESUME de esa wallet (1-indexed).
    opens_by_memo: memo -> resultado para open_pack de memos pre-sembrados (reconciliación)."""
    def __init__(self, values, opens_by_memo=None):
        self.values = values
        self.opens_by_memo = opens_by_memo or {}
        self.pull_counts = {}
        self.generated = []

    async def generate_pack(self, player_address, pack_type, alt_player_address=None, turbo=False):
        self.generated.append(player_address)
        return {"memo": f"m-{player_address}", "transaction": f"tx-{player_address}"}

    async def open_pack(self, memo):
        if memo in self.opens_by_memo:
            return self.opens_by_memo[memo]
        wallet = memo.split("m-", 1)[1]
        n = self.pull_counts.get(wallet, 0) + 1
        self.pull_counts[wallet] = n
        return {"pending": False, "nft_address": f"nft-{wallet}-{n}",
                "insured_value": self.values.get((wallet, n), 0), "grade": 9}

    async def submit_tx(self, signed):
        return {"signature": "ccsig"}


class _Signer:
    async def sign_solana(self, wallet_id, tx):
        return f"sig-{tx}"


async def _noslp(_):
    return None


def _mk(session, bid, players, server_seed="ab" * 32):
    session.add(PackBattle(id=bid, mode="royale", machine_code="pokemon_50", price=50_000_000,
                           max_players=len(players), status="running", server_seed=server_seed,
                           escrow_wallet_id="eid", escrow_address="ESC"))
    for w in players:
        session.add(BattlePlayer(battle_id=bid, player_wallet=w))
    session.commit()
    return session.get(PackBattle, bid)


def _fund_fakes(prefunded=()):
    """distribute/confirm_usdc con balances simulados: confirm devuelve True si la wallet
    fue fondeada (distribute) o venía pre-fondeada (el distribute pre-crash aterrizó)."""
    balances = {w: True for w in prefunded}
    dists = []

    async def distribute(esc, w, amt):
        balances[w] = True
        dists.append(w)

    async def confirm_usdc(w, amt):
        return balances.get(w, False)

    return distribute, confirm_usdc, dists


def _std(session, bid, gacha, distribute, confirm_usdc, **over):
    kw = dict(gacha=gacha, signer=_Signer(), resolve_wallet_id=lambda w: f"{w}-id",
              distribute=distribute, confirm_usdc=confirm_usdc,
              confirm_in_escrow=_ce, build_transfer_tx=_btx, submit_tx=_sub,
              price_base=50_000_000, now_fn=lambda: __import__("datetime").datetime(2026, 7, 6),
              sleep_fn=_noslp, max_attempts=2, reconcile_max_attempts=1)
    kw.update(over)
    return resume_royale(session, session.get(PackBattle, bid), **kw)


async def _ce(esc, nft): return True
async def _btx(esc, dest, nft): return f"x-{nft}"
async def _sub(s): return "sig"


# Estado pre-sembrado común: 3 jugadores A/B/C, ronda 1 COMPLETA (A eliminado con 10;
# B=20, C=30) y BattleRound persistida.
def _seed_round1_complete(session, bid="rr1"):
    b = _mk(session, bid, ["A", "B", "C"])
    session.add_all([
        BattlePull(battle_id=bid, player_wallet="A", memo="pm-A", nft_address="nft-A-pre",
                   insured_value=10, round_number=1),
        BattlePull(battle_id=bid, player_wallet="B", memo="pm-B", nft_address="nft-B-pre",
                   insured_value=20, round_number=1),
        BattlePull(battle_id=bid, player_wallet="C", memo="pm-C", nft_address="nft-C-pre",
                   insured_value=30, round_number=1),
        BattleRound(battle_id=bid, round_number=1, client_seed="", eliminated_wallet="A"),
    ])
    ba = session.query(BattlePlayer).filter_by(battle_id=bid, player_wallet="A").first()
    ba.eliminated_round = 1
    session.commit()
    return b


@pytest.mark.asyncio
async def test_resume_entre_rondas_continua_y_settlea(session):
    """Restart tras completar la ronda 1 → resume juega la ronda 2 y gana C."""
    _seed_round1_complete(session)
    # Post-resume: B tira 1 vez (5 → 25), C tira 1 vez (6 → 36) → B eliminado, C gana.
    gacha = _Gacha({("B", 1): 5, ("C", 1): 6})
    distribute, confirm_usdc, dists = _fund_fakes()
    out = await _std(session, "rr1", gacha, distribute, confirm_usdc)
    assert out == "settled"
    b = session.get(PackBattle, "rr1")
    assert b.winner == "C" and b.status == "settled"
    rounds = session.query(BattleRound).filter_by(battle_id="rr1").order_by(BattleRound.round_number).all()
    assert [r.eliminated_wallet for r in rounds] == ["A", "B"]
    assert "A" not in gacha.generated            # el eliminado no vuelve a tirar
    assert session.query(BattlePull).filter_by(battle_id="rr1").count() == 5  # 3 pre + 2 nuevas


@pytest.mark.asyncio
async def test_resume_a_mitad_de_ronda_no_repite_pulls(session):
    """Crash a mitad de la ronda 1: A ya tiró (resuelta), B y C no. Nadie re-tira."""
    b = _mk(session, "rr2", ["A", "B", "C"])
    session.add(BattlePull(battle_id="rr2", player_wallet="A", memo="pm-A",
                           nft_address="nft-A-pre", insured_value=10, round_number=1))
    session.commit()
    # B y C tiran en el resume: B=20, C=30 → A (10) eliminado en ronda 1.
    # Ronda 2: B tira de nuevo (5 → 25), C (6 → 36) → B fuera, C gana.
    gacha = _Gacha({("B", 1): 20, ("C", 1): 30, ("B", 2): 5, ("C", 2): 6})
    distribute, confirm_usdc, dists = _fund_fakes()
    out = await _std(session, "rr2", gacha, distribute, confirm_usdc)
    assert out == "settled"
    assert session.get(PackBattle, "rr2").winner == "C"
    # A no re-tiró en la ronda 1 (su pull pre-sembrada cuenta):
    assert gacha.generated.count("A") == 0
    assert session.query(BattlePull).filter_by(battle_id="rr2", player_wallet="A").count() == 1


@pytest.mark.asyncio
async def test_resume_guard_anti_doble_fondeo(session):
    """En la ronda interrumpida, un jugador ya fondeado (distribute pre-crash aterrizó)
    no recibe un segundo distribute; el resto sí se fondea."""
    _mk(session, "rr3", ["A", "B"])
    gacha = _Gacha({("A", 1): 10, ("B", 1): 20})
    distribute, confirm_usdc, dists = _fund_fakes(prefunded=("A",))
    out = await _std(session, "rr3", gacha, distribute, confirm_usdc)
    assert out == "settled"
    assert "A" not in dists and "B" in dists


@pytest.mark.asyncio
async def test_resume_reconcilia_pull_sin_resolver_y_continua(session):
    """La pull interrumpida de A resuelve al re-poll → se completa y la partida sigue."""
    b = _mk(session, "rr4", ["A", "B"])
    session.add(BattlePull(battle_id="rr4", player_wallet="A", memo="pm-A", round_number=1))
    session.commit()
    gacha = _Gacha({("B", 1): 20},
                   opens_by_memo={"pm-A": {"pending": False, "nft_address": "nft-A-late",
                                           "insured_value": 10, "grade": 9}})
    distribute, confirm_usdc, dists = _fund_fakes()
    out = await _std(session, "rr4", gacha, distribute, confirm_usdc)
    assert out == "settled"
    assert session.get(PackBattle, "rr4").winner == "B"   # A=10 < B=20
    pa = session.query(BattlePull).filter_by(battle_id="rr4", player_wallet="A").first()
    assert pa.nft_address == "nft-A-late" and pa.insured_value == 10
    assert gacha.generated.count("A") == 0                # reconciliada, no re-tirada


@pytest.mark.asyncio
async def test_resume_pull_irrecuperable_hace_void(session):
    """La pull interrumpida nunca resuelve → void (el wiring refundea después)."""
    b = _mk(session, "rr5", ["A", "B"])
    session.add(BattlePull(battle_id="rr5", player_wallet="A", memo="pm-A", round_number=1))
    session.commit()
    gacha = _Gacha({}, opens_by_memo={"pm-A": {"pending": True}})
    distribute, confirm_usdc, dists = _fund_fakes()
    out = await _std(session, "rr5", gacha, distribute, confirm_usdc)
    assert out == "voided"
    assert session.get(PackBattle, "rr5").status == "voided"


@pytest.mark.asyncio
async def test_resume_sin_escrow_hace_void(session):
    b = _mk(session, "rr6", ["A", "B"])
    b.escrow_wallet_id = None
    b.escrow_address = None
    session.commit()
    gacha = _Gacha({})
    distribute, confirm_usdc, dists = _fund_fakes()
    out = await _std(session, "rr6", gacha, distribute, confirm_usdc)
    assert out == "voided"


@pytest.mark.asyncio
async def test_resume_escrow_drenado_hace_void(session):
    """confirm_usdc nunca llega a True para un jugador sin fondear → void limpio."""
    _mk(session, "rr7", ["A", "B"])
    gacha = _Gacha({})
    async def distribute(esc, w, amt): pass          # el pool no tiene fondos: nunca llega
    async def confirm_usdc(w, amt): return False
    out = await _std(session, "rr7", gacha, distribute, confirm_usdc)
    assert out == "voided"
```

- [ ] **Step 2: Verificar que fallan**

Run: `cd backend && python -m pytest tests/test_royale_resume.py -v`
Expected: FAIL — `ImportError: cannot import name 'resume_royale'`.

- [ ] **Step 3: Implementación**

En `backend/app/services/royale_engine.py` (tras `run_royale`):

```python
async def resume_royale(session, battle, *, gacha, signer, resolve_wallet_id,
                        distribute, confirm_usdc, confirm_in_escrow,
                        build_transfer_tx, submit_tx, price_base, now_fn,
                        sleep_fn=None, max_attempts=20, delay=3.0,
                        build_usdc_sweep_tx=None, operator_wallet_id="",
                        usdc_balance=None, build_usdc_transfer_tx=None,
                        reconcile_max_attempts=5) -> str:
    """Retoma una royale huérfana en 'running' (un restart mató el runner). Reconstruye
    remaining/accumulated/ronda desde la DB y CONTINÚA la partida: en la ronda interrumpida,
    quien ya tiró no repite; una pull a medio abrir se reconcilia (re-poll del memo) y, si es
    irrecuperable, se anula (el wiring refundea). No re-cobra buy-ins ni re-tira nada."""
    sleep_fn = sleep_fn or asyncio.sleep

    if not battle.escrow_wallet_id or not battle.escrow_address:
        logger.warning("resume royale %s: no escrow — voiding", battle.id)
        return await _void(session, battle)
    esc = {"id": battle.escrow_wallet_id, "address": battle.escrow_address}

    players = [p.player_wallet for p in
               session.query(BattlePlayer).filter_by(battle_id=battle.id)
               .order_by(BattlePlayer.joined_at).all()]
    eliminated = {p.player_wallet for p in
                  session.query(BattlePlayer).filter_by(battle_id=battle.id).all()
                  if p.eliminated_round is not None}
    remaining = [w for w in players if w not in eliminated]
    if not remaining:
        logger.warning("resume royale %s: no remaining players — voiding", battle.id)
        return await _void(session, battle)

    # Ronda interrumpida: reconciliar pulls a medio abrir ANTES de reconstruir acumulados.
    pulls = session.query(BattlePull).filter_by(battle_id=battle.id).all()
    if any(p.memo and not p.nft_address for p in pulls):
        from app.services.reconcile import reconcile_unresolved_pulls
        await reconcile_unresolved_pulls(session, battle, gacha=gacha, sleep_fn=sleep_fn,
                                         max_attempts=reconcile_max_attempts, delay=delay)
        pulls = session.query(BattlePull).filter_by(battle_id=battle.id).all()
        if any(p.memo and not p.nft_address for p in pulls):
            logger.warning("resume royale %s: unresolved pull(s) — voiding", battle.id)
            return await _void(session, battle)

    accumulated = {w: 0.0 for w in players}
    for p in pulls:
        accumulated[p.player_wallet] = accumulated.get(p.player_wallet, 0.0) + (p.insured_value or 0)

    last = (session.query(BattleRound).filter_by(battle_id=battle.id)
            .order_by(BattleRound.round_number.desc()).first())
    round_number = last.round_number if last else 0

    try:
        first = True   # solo la ronda interrumpida reusa pulls existentes y aplica el fund-guard
        while len(remaining) > 1:
            round_number += 1
            await _play_round(session, battle, esc_addr=esc["address"], remaining=remaining,
                              accumulated=accumulated, round_number=round_number,
                              gacha=gacha, signer=signer, resolve_wallet_id=resolve_wallet_id,
                              distribute=distribute, confirm_usdc=confirm_usdc,
                              price_base=price_base, sleep_fn=sleep_fn,
                              max_attempts=max_attempts, delay=delay,
                              skip_existing=first, fund_guard=first)
            first = False
        return await _settle_and_finish(session, battle, winner=remaining[0], players=players,
                                        esc=esc, gacha=gacha, signer=signer,
                                        resolve_wallet_id=resolve_wallet_id,
                                        build_transfer_tx=build_transfer_tx, submit_tx=submit_tx,
                                        confirm_in_escrow=confirm_in_escrow,
                                        build_usdc_sweep_tx=build_usdc_sweep_tx,
                                        usdc_balance=usdc_balance,
                                        build_usdc_transfer_tx=build_usdc_transfer_tx,
                                        operator_wallet_id=operator_wallet_id, now_fn=now_fn,
                                        sleep_fn=sleep_fn, max_attempts=max_attempts, delay=delay)
    except Exception as exc:
        logger.warning("royale resume failed %s: %s — voiding", battle.id, exc)
        return await _void(session, battle)
```

(Los nombres exactos de los parámetros de `_settle_and_finish` deben coincidir con los definidos en Task 5.)

- [ ] **Step 4: Verificar**

Run: `cd backend && python -m pytest tests/test_royale_resume.py tests/test_royale_engine.py -v`
Expected: PASS (7 nuevos + los existentes).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/royale_engine.py backend/tests/test_royale_resume.py
git commit -m "feat(royale): resume_royale continues an orphaned royale after a backend restart"
```

---

### Task 7: `resume_royale_live` + hook de startup

**Files:**
- Modify: `backend/app/services/pack_orchestration.py`
- Modify: `backend/app/main.py` (`_resume_orphaned_battles`)
- Test: `backend/tests/test_pack_orchestration.py` y `backend/tests/test_pack_lobby_api.py`

**Interfaces:**
- Consumes: `resume_royale` (Task 6), `reconcile_unresolved_pulls`, `refund_royale_void`, closures existentes de `run_royale_live`, `sol_balance`, `seed_and_confirm_sol`.
- Produces: `async def resume_royale_live(session, battle, *, gacha, signer, rpc_url, usdc_mint, operator_wallet_id="", operator_address="", seed_lamports=10_000_000, price_base: int) -> str` — mismas closures que `run_royale_live`; re-siembra gas SOL solo si el escrow quedó a 0; si el resume devuelve `"voided"`, reconcilia + `refund_royale_void`. El startup de `main.py` la lanza para cada royale huérfana (sustituye el warning).

- [ ] **Step 1: Tests que fallan**

En `backend/tests/test_pack_orchestration.py`:

```python
@pytest.mark.asyncio
async def test_resume_royale_live_invoca_refund_en_void(session, monkeypatch):
    import app.services.pack_orchestration as po
    order = []
    async def fake_resume(*a, **kw): return "voided"
    async def fake_reconcile(*a, **kw): order.append("reconcile"); return 0
    async def fake_refund(*a, **kw): order.append("refund")
    monkeypatch.setattr(po, "resume_royale", fake_resume)
    monkeypatch.setattr(po, "reconcile_unresolved_pulls", fake_reconcile)
    monkeypatch.setattr(po, "refund_royale_void", fake_refund)
    async def fake_sol_balance(rpc, addr): return 1   # escrow con gas → sin re-seed
    monkeypatch.setattr(po, "sol_balance", fake_sol_balance)

    from app.models import PackBattle
    b = PackBattle(id="rl1", mode="royale", machine_code="m", price=50, max_players=5,
                   status="running", server_seed="ab" * 32,
                   escrow_wallet_id="eid", escrow_address="ESC")
    session.add(b); session.commit()
    class _S:
        async def sign_solana(self, wid, tx): return "s"
    out = await po.resume_royale_live(session, b, gacha=object(), signer=_S(),
                                      rpc_url="http://rpc", usdc_mint="M" * 32, price_base=50)
    assert out == "voided" and order == ["reconcile", "refund"]


@pytest.mark.asyncio
async def test_resume_royale_live_reseed_solo_si_escrow_sin_gas(session, monkeypatch):
    import app.services.pack_orchestration as po
    seeded = []
    async def fake_resume(*a, **kw): return "settled"
    monkeypatch.setattr(po, "resume_royale", fake_resume)
    async def fake_sol_balance(rpc, addr): return 0
    monkeypatch.setattr(po, "sol_balance", fake_sol_balance)
    async def fake_seed(*a, **kw): seeded.append(True); return "sig"
    monkeypatch.setattr(po, "seed_and_confirm_sol", fake_seed)

    from app.models import PackBattle
    b = PackBattle(id="rl2", mode="royale", machine_code="m", price=50, max_players=5,
                   status="running", server_seed="ab" * 32,
                   escrow_wallet_id="eid", escrow_address="ESC")
    session.add(b); session.commit()
    out = await po.resume_royale_live(session, b, gacha=object(), signer=object(),
                                      rpc_url="http://rpc", usdc_mint="M" * 32, price_base=50)
    assert out == "settled" and seeded == [True]
```

En `backend/tests/test_pack_lobby_api.py` (patrón del test de startup existente):

```python
def test_startup_resume_lanza_resume_royale_para_huerfanas(monkeypatch):
    """Una royale en 'running' al arrancar dispara resume_royale_live (ya no solo un warning)."""
    import app.main as m
    resumed = []
    async def fake_resume_live(session, battle, **kw):
        resumed.append(battle.id); return "settled"
    monkeypatch.setattr(m, "resume_royale_live", fake_resume_live)
    session_factory, app_, client = _mk_app_with_db(monkeypatch)   # helper/patrón del archivo
    from app.models import PackBattle
    with session_factory() as s:
        s.add(PackBattle(id="ro1", mode="royale", machine_code="m", price=50, max_players=5,
                         status="running", server_seed="ab" * 32,
                         escrow_wallet_id="eid", escrow_address="ESC"))
        s.commit()
    with client:
        pass
    assert resumed == ["ro1"]
```

- [ ] **Step 2: Verificar que fallan**

Run: `cd backend && python -m pytest tests/test_pack_orchestration.py tests/test_pack_lobby_api.py -v -k "resume_royale or huerfanas"`
Expected: FAIL — `resume_royale_live` no existe / el startup solo loguea el warning.

- [ ] **Step 3: Implementación**

`backend/app/services/pack_orchestration.py` — import `resume_royale` junto a `run_royale` y nueva función (misma estructura de closures que `run_royale_live`):

```python
async def resume_royale_live(session, battle, *, gacha, signer, rpc_url: str, usdc_mint: str,
                             operator_wallet_id: str = "", operator_address: str = "",
                             seed_lamports: int = 10_000_000, price_base: int) -> str:
    """Wiring del resume de royale: mismas closures on-chain que run_royale_live, pero
    sin re-cobrar buy-ins ni re-crear escrow. Re-siembra gas SOL solo si el escrow quedó
    a 0 (p. ej. nunca llegó a sembrarse antes del crash)."""
    from app.models import BattlePlayer

    players = (session.query(BattlePlayer).filter_by(battle_id=battle.id)
               .order_by(BattlePlayer.joined_at).all())
    wallet_to_privy_id = {p.player_wallet: p.wallet_id for p in players}

    def resolve_wallet_id(wallet: str):
        return wallet_to_privy_id.get(wallet)

    async def distribute(esc_addr: str, player_addr: str, amt: int) -> str:
        bh = await fetch_latest_blockhash(rpc_url)
        return await distribute_usdc(
            rpc_url, signer, battle.escrow_wallet_id, esc_addr, player_addr, usdc_mint, amt, bh,
            operator_wallet_id=operator_wallet_id, operator_address=operator_address)

    async def confirm_usdc_cb(player_addr: str, min_base_units: int) -> bool:
        return await confirm_usdc(rpc_url, player_addr, usdc_mint, min_base_units)

    async def build_transfer_tx(esc, dest, mint):
        bh = await fetch_latest_blockhash(rpc_url)
        return await build_transfer(rpc_url, esc, dest, mint, bh)

    submit_tx = lambda signed: submit_signed_tx(rpc_url, signed)  # noqa: E731
    confirm_in_escrow = lambda esc, mint: nft_in_owner(rpc_url, esc, mint)  # noqa: E731

    async def build_usdc_sweep_tx(esc_addr, winner_addr):
        bal = await usdc_balance_base_units(rpc_url, esc_addr, usdc_mint)
        if bal <= 0:
            return None
        bh = await fetch_latest_blockhash(rpc_url)
        return build_token_transfer(esc_addr, winner_addr, usdc_mint, bh, amount=bal,
                                    decimals=6, fee_payer=operator_address)

    async def build_usdc_transfer_tx(src, dest, amount):
        bh = await fetch_latest_blockhash(rpc_url)
        return build_token_transfer(src, dest, usdc_mint, bh, amount=amount, decimals=6,
                                    fee_payer=operator_address)

    async def buyback_to_escrow(nft):
        bb = await gacha.buyback(battle.escrow_address, nft)
        txb = bb.get("serialized_transaction")
        if not txb:
            return
        signed = await signer.sign_solana(battle.escrow_wallet_id, txb)
        await gacha.submit_tx(signed)

    async def escrow_usdc_balance(esc_addr):
        return await usdc_balance_base_units(rpc_url, esc_addr, usdc_mint)

    def now_fn():
        return datetime.now(timezone.utc)

    # Gas del escrow: re-sembrar SOLO si quedó a 0 (re-sembrar siempre quemaría lamports).
    try:
        if await sol_balance(rpc_url, battle.escrow_address) <= 0:
            await seed_and_confirm_sol(rpc_url, signer, operator_wallet_id, operator_address,
                                       battle.escrow_address, seed_lamports)
    except Exception as exc:
        logger.warning("resume royale %s: gas re-seed failed: %s (continuing; first distribute "
                       "will void cleanly if the escrow is unusable)", battle.id, exc)

    result = await resume_royale(
        session, battle, gacha=gacha, signer=signer, resolve_wallet_id=resolve_wallet_id,
        distribute=distribute, confirm_usdc=confirm_usdc_cb, confirm_in_escrow=confirm_in_escrow,
        build_transfer_tx=build_transfer_tx, submit_tx=submit_tx, price_base=price_base,
        now_fn=now_fn, build_usdc_sweep_tx=build_usdc_sweep_tx,
        operator_wallet_id=operator_wallet_id, usdc_balance=escrow_usdc_balance,
        build_usdc_transfer_tx=build_usdc_transfer_tx,
    )
    if result == "voided":
        await reconcile_unresolved_pulls(session, battle, gacha=gacha)
        await refund_royale_void(
            session, battle, escrow_wallet_id=battle.escrow_wallet_id,
            escrow_address=battle.escrow_address, build_transfer_tx=build_transfer_tx,
            submit_tx=submit_tx, signer=signer, build_usdc_transfer_tx=build_usdc_transfer_tx,
            buyback_to_escrow=buyback_to_escrow, escrow_usdc_balance=escrow_usdc_balance,
            confirm_in_escrow=confirm_in_escrow, operator_wallet_id=operator_wallet_id,
        )
    return result
```

`backend/app/main.py` — en `_resume_orphaned_battles`, sustituir la rama del warning:

```python
        for bid, mode in running:
            async def _resume_one(battle_id=bid, battle_mode=mode):
                s2 = session_factory()
                try:
                    b = s2.get(PackBattle, battle_id)
                    if b is None or b.status != "running":
                        return
                    logger.warning("resume: finishing orphaned %s battle %s", battle_mode, battle_id)
                    if battle_mode == "royale":
                        await resume_royale_live(
                            s2, b, gacha=gacha, signer=privy_signer, rpc_url=solana_rpc_url,
                            usdc_mint=cc_usdc_mint, operator_wallet_id=privy_operator_wallet_id,
                            operator_address=privy_operator_address,
                            seed_lamports=escrow_seed_lamports, price_base=b.price)
                    else:
                        await resume_pack_battle_live(
                            s2, b, gacha=gacha, signer=privy_signer, rpc_url=solana_rpc_url,
                            usdc_mint=cc_usdc_mint, operator_wallet_id=privy_operator_wallet_id,
                            operator_address=privy_operator_address)
                    asyncio.create_task(_broadcast_battle_drops(battle_id))
                except Exception:
                    logger.warning("resume: failed to finish orphaned battle %s", battle_id)
                finally:
                    release_reservations(s2, battle_id)
                    s2.close()

            asyncio.create_task(_resume_one())
```

(e importar `resume_royale_live` en el import de `pack_orchestration` de `main.py`).

- [ ] **Step 4: Verificar**

Run: `cd backend && python -m pytest tests/test_pack_orchestration.py tests/test_pack_lobby_api.py -v`
Expected: PASS completo.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/pack_orchestration.py backend/app/main.py backend/tests/test_pack_orchestration.py backend/tests/test_pack_lobby_api.py
git commit -m "feat(royale): wire resume_royale_live into startup so orphaned royales finish"
```

---

### Task 8: Fix carrera cancel-vs-join

**Files:**
- Modify: `backend/app/main.py` (`cancel_pack_battle`, ~línea 1066)
- Test: `backend/tests/test_pack_lobby_api.py`

**Interfaces:**
- Consumes: endpoint existente.
- Produces: el snapshot de `players` a refundear se toma DESPUÉS de `cancel_battle` (post-flip `lobby→cancelled`).

- [ ] **Step 1: Test que falla**

```python
def test_cancel_refundea_al_jugador_que_entro_durante_el_cancel(monkeypatch):
    """Simula el interleaving: un jugador se une DESPUÉS del (viejo) snapshot pero ANTES del flip.
    Con el fix, el snapshot es post-flip y ese jugador queda incluido en los refunds."""
    import app.main as m
    from app.services.pack_lobby import cancel_battle as real_cancel
    from app.models import BattlePlayer

    late_added = {}
    def cancel_and_sneak_join(s, battle_id, wallet):
        # el "otro request" inserta su BattlePlayer justo antes del flip
        if not late_added.get(battle_id):
            s.add(BattlePlayer(battle_id=battle_id, player_wallet="LATE_JOINER", wallet_id="late-id"))
            s.commit()
            late_added[battle_id] = True
        return real_cancel(s, battle_id, wallet)
    monkeypatch.setattr(m, "cancel_battle", cancel_and_sneak_join)

    refunds = []
    async def fake_refund_buyin(rpc, signer, ewid, eaddr, owid, oaddr, player, mint, amount, bh):
        refunds.append(player); return "sig"
    monkeypatch.setattr(m, "refund_buyin", fake_refund_buyin)
    async def fake_bh(rpc): return "B" * 32
    monkeypatch.setattr(m, "fetch_latest_blockhash", fake_bh)

    # Crear una royale en lobby con creador CREATOR (sembrar directo en DB, patrón del archivo)
    # y llamar POST /pack-battles/{id}/cancel autenticado como CREATOR.
    ...
    assert "LATE_JOINER" in refunds and "CREATOR" in refunds
```

(Completar la siembra/llamada con el patrón exacto de `test_royale_cancel_refunds_buyins`, que ya construye este escenario sin el late joiner.)

- [ ] **Step 2: Verificar que falla**

Run: `cd backend && python -m pytest tests/test_pack_lobby_api.py -v -k "entro_durante"`
Expected: FAIL — `"LATE_JOINER" in refunds` es False (el snapshot viejo no lo incluye).

- [ ] **Step 3: Implementación**

En `cancel_pack_battle` (`backend/app/main.py`), mover el snapshot de jugadores a después del cancel:

```python
        b = s.get(PackBattle, battle_id)
        if b is None:
            raise HTTPException(404, "no existe")
        is_royale = b.mode == "royale"
        escrow_wallet_id = b.escrow_wallet_id
        escrow_address = b.escrow_address
        try:
            cancel_battle(s, battle_id, wallet)   # validates creator + lobby, sets cancelled
        except LobbyError as e:
            raise HTTPException(409, str(e))
        # Snapshot POST-flip: un join que se coló antes del flip queda incluido en los refunds;
        # uno posterior falla en join_battle (status != lobby) y se auto-refundea por su path.
        players = [p.player_wallet for p in s.query(BattlePlayer).filter_by(battle_id=battle_id).all()]
```

- [ ] **Step 4: Verificar**

Run: `cd backend && python -m pytest tests/test_pack_lobby_api.py -v`
Expected: PASS completo (incluido `test_royale_cancel_refunds_buyins` existente).

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py backend/tests/test_pack_lobby_api.py
git commit -m "fix(cancel): snapshot players after the lobby->cancelled flip so a racing join gets refunded"
```

---

### Task 9: Settle idempotente + catálogo de corner cases de Pack Battle

**Files:**
- Modify: `backend/app/services/pack_engine.py` (`settle_cards_to_winner`)
- Test: `backend/tests/test_pack_engine.py` (añadir tests)

**Interfaces:**
- Consumes: engine existente.
- Produces: `settle_cards_to_winner` salta pulls con `transferred=True` (idempotencia del settle en un resume tras settle parcial).

- [ ] **Step 1: Tests que fallan**

Añadir a `backend/tests/test_pack_engine.py` (reutiliza `_Gacha`, `_Signer`, `_btx`, `_sub`, `_ce`, `_noslp` del archivo):

```python
@pytest.mark.asyncio
async def test_settle_salta_cartas_ya_transferidas(session):
    """Resume tras settle parcial: una pull con transferred=True no se re-transfiere."""
    from app.services.pack_engine import settle_cards_to_winner
    b = PackBattle(id="s1", mode="pack", machine_code="m", price=50, max_players=2,
                   status="running", server_seed="ab" * 32,
                   escrow_wallet_id="eid", escrow_address="ESC")
    session.add(b)
    session.add_all([
        BattlePull(battle_id="s1", player_wallet="A", memo="mA", nft_address="nA",
                   insured_value=100, transferred=True, round_number=1),
        BattlePull(battle_id="s1", player_wallet="B", memo="mB", nft_address="nB",
                   insured_value=300, round_number=1),
    ])
    session.commit()
    built = []
    async def btx(esc, dest, nft): built.append(nft); return f"x-{nft}"
    await settle_cards_to_winner(session, b, escrow_wallet_id="eid", escrow_address="ESC",
                                 winner="B", build_transfer_tx=btx, submit_tx=_sub,
                                 signer=_Signer(), confirm_in_escrow=_ce,
                                 build_usdc_sweep_tx=None, sleep_fn=_noslp,
                                 wait_max_attempts=1, wait_delay=0)
    assert built == ["nB"]


@pytest.mark.asyncio
async def test_run_battle_empate_sin_server_seed_hace_void(session):
    """Empate con server_seed None → determine_winner lanza → voided (no crash)."""
    b = PackBattle(id="s2", mode="pack", machine_code="m", price=50, max_players=2,
                   status="running", server_seed=None)
    session.add(b)
    session.add_all([BattlePlayer(battle_id="s2", player_wallet="A"),
                     BattlePlayer(battle_id="s2", player_wallet="B")])
    session.commit()
    gacha = _Gacha({"A": {"nft_address": "nA", "insured_value": 100, "grade": 9},
                    "B": {"nft_address": "nB", "insured_value": 100, "grade": 8}})
    async def prep(addr): pass
    out = await run_battle(session, b, gacha=gacha, signer=_Signer(),
                           resolve_wallet_id=lambda w: f"{w}-id",
                           build_transfer_tx=_btx, submit_tx=_sub, confirm_in_escrow=_ce,
                           prepare_escrow=prep, can_play=lambda w: True,
                           now_fn=lambda: __import__("datetime").datetime(2026, 7, 6),
                           sleep_fn=_noslp)
    assert out == "voided" and b.status == "voided"


@pytest.mark.asyncio
async def test_run_battle_todo_autosold_settlea_sin_transferir_cartas(session):
    """Todos los pulls auto-sold → ganador por insured_value, cero transfers, sweep al ganador."""
    b = PackBattle(id="s3", mode="pack", machine_code="m", price=50, max_players=2,
                   status="running", server_seed="ab" * 32)
    session.add(b)
    session.add_all([BattlePlayer(battle_id="s3", player_wallet="A"),
                     BattlePlayer(battle_id="s3", player_wallet="B")])
    session.commit()
    gacha = _Gacha({"A": {"nft_address": "nA", "insured_value": 40, "grade": None,
                          "auto_sold": True, "buyback_amount": 30_000_000},
                    "B": {"nft_address": "nB", "insured_value": 60, "grade": None,
                          "auto_sold": True, "buyback_amount": 45_000_000}})
    built, sweeps = [], []
    async def btx(esc, dest, nft): built.append(nft); return "x"
    async def sweep(esc, winner): sweeps.append(winner); return "sweep-tx"
    async def prep(addr): pass
    out = await run_battle(session, b, gacha=gacha, signer=_Signer(),
                           resolve_wallet_id=lambda w: f"{w}-id",
                           build_transfer_tx=btx, submit_tx=_sub, confirm_in_escrow=_ce,
                           prepare_escrow=prep, can_play=lambda w: True,
                           now_fn=lambda: __import__("datetime").datetime(2026, 7, 6),
                           sleep_fn=_noslp, build_usdc_sweep_tx=sweep)
    assert out == "settled" and b.winner == "B"
    assert built == [] and sweeps == ["B"]


@pytest.mark.asyncio
async def test_resume_pack_sin_escrow_hace_void_sin_crash(session):
    """Restart entre el fill y la creación del escrow: running, sin escrow, sin pulls → void."""
    from app.services.pack_engine import resume_pack_battle
    b = PackBattle(id="s4", mode="pack", machine_code="m", price=50, max_players=2,
                   status="running", server_seed="ab" * 32)
    session.add(b)
    session.add_all([BattlePlayer(battle_id="s4", player_wallet="A"),
                     BattlePlayer(battle_id="s4", player_wallet="B")])
    session.commit()
    out = await resume_pack_battle(session, b, gacha=object(), signer=_Signer(),
                                   resolve_wallet_id=lambda w: None, build_transfer_tx=_btx,
                                   submit_tx=_sub, confirm_in_escrow=_ce,
                                   now_fn=lambda: __import__("datetime").datetime(2026, 7, 6),
                                   sleep_fn=_noslp)
    assert out == "voided" and b.status == "voided"


@pytest.mark.asyncio
async def test_void_a_mitad_de_bundle_y_refund_devuelve_lo_ya_sacado(session):
    """Bundle de 2 cajas; la caja 2 de B nunca abre → voided. El refund posterior devuelve
    a cada puller sus cartas YA resueltas (integración run_battle + refund_pack_void)."""
    from app.models import BattlePack
    from app.services.refund import refund_pack_void
    b = PackBattle(id="s5", mode="pack", machine_code="m1", price=100, max_players=2,
                   status="running", server_seed="ab" * 32)
    session.add(b)
    session.add_all([BattlePlayer(battle_id="s5", player_wallet="A"),
                     BattlePlayer(battle_id="s5", player_wallet="B"),
                     BattlePack(battle_id="s5", machine_code="m1", price=50, sequence=1),
                     BattlePack(battle_id="s5", machine_code="m2", price=50, sequence=2)])
    session.commit()

    class _FailingGacha(_Gacha):
        """La 4ª pull (B, caja 2) queda pending para siempre."""
        def __init__(self, opens):
            super().__init__(opens); self.count = 0
        async def open_pack(self, memo):
            self.count += 1
            if self.count >= 4:
                return {"pending": True}
            return await super().open_pack(memo)

    gacha = _FailingGacha({"A": {"nft_address": "nA", "insured_value": 100, "grade": 9},
                           "B": {"nft_address": "nB", "insured_value": 300, "grade": 8}})
    async def prep(addr): pass
    out = await run_battle(session, b, gacha=gacha, signer=_Signer(),
                           resolve_wallet_id=lambda w: f"{w}-id",
                           build_transfer_tx=_btx, submit_tx=_sub, confirm_in_escrow=_ce,
                           prepare_escrow=prep, can_play=lambda w: True,
                           now_fn=lambda: __import__("datetime").datetime(2026, 7, 6),
                           sleep_fn=_noslp, open_max_attempts=1, open_delay=0)
    assert out == "voided"

    built = []
    async def btx(esc, dest, nft): built.append((dest, nft)); return "x"
    async def utx(src, dest, amt): return "u"
    await refund_pack_void(session, b, escrow_wallet_id=b.escrow_wallet_id,
                           escrow_address=b.escrow_address, build_transfer_tx=btx,
                           submit_tx=_sub, signer=_Signer(), build_usdc_transfer_tx=utx,
                           confirm_in_escrow=_ce, sleep_fn=_noslp)
    # Nota: _Gacha usa memo "m-{wallet}", así que la pull de la caja 2 de A comparte memo con
    # la de la caja 1; lo relevante: cada carta RESUELTA vuelve a su dueño y nada más.
    resolved = [(p.player_wallet, p.nft_address) for p in
                session.query(BattlePull).filter_by(battle_id="s5").all() if p.nft_address]
    assert set(built) == {(w, n) for w, n in resolved}
```

- [ ] **Step 2: Verificar que fallan**

Run: `cd backend && python -m pytest tests/test_pack_engine.py -v -k "salta_cartas or empate_sin or autosold_settlea or sin_escrow_hace or mitad_de_bundle"`
Expected: `test_settle_salta_cartas_ya_transferidas` FAIL (re-transfiere `nA`); el resto puede pasar ya (pinnean comportamiento existente) — confirmar cuáles fallan y cuáles documentan.

- [ ] **Step 3: Implementación**

En `settle_cards_to_winner` (`backend/app/services/pack_engine.py`), en el bucle de pulls:

```python
    for p in pulls:
        if p.auto_sold or not p.nft_address or p.transferred:
            continue
```

(Un resume tras settle parcial ya no re-envía cartas que salieron del escrow; el flag lo puso el settle original.)

- [ ] **Step 4: Verificar**

Run: `cd backend && python -m pytest tests/test_pack_engine.py -v`
Expected: PASS completo.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/pack_engine.py backend/tests/test_pack_engine.py
git commit -m "fix(settle): skip already-transferred cards + pin pack-battle corner cases"
```

---

### Task 10: Verificación final

- [ ] **Step 1: Suite completa**

Run: `cd backend && python -m pytest -q`
Expected: PASS completo (0 failed). Si algo falla, arreglar antes de continuar.

- [ ] **Step 2: Arranque en frío contra la DB de dev**

La migración de `battle_pulls.refunded` es automática vía `_ensure_columns` + backfill one-shot en `init_db`. Verificarla:

```bash
cd backend && python -c "
from app.db import make_engine, init_db
from sqlalchemy import text
e = make_engine('sqlite:///../battlearena.db')
init_db(e)
with e.connect() as c:
    cols = [r[1] for r in c.execute(text('PRAGMA table_info(battle_pulls)')).fetchall()]
    assert 'refunded' in cols, cols
    print('refunded OK;', c.execute(text('SELECT COUNT(*) FROM battle_pulls WHERE refunded=1')).scalar_one(), 'pulls históricas marcadas')
"
```

Expected: `refunded OK; N pulls históricas marcadas` (N = pulls de batallas settled/voided/cancelled existentes).

- [ ] **Step 3: Commit final (si quedó algo suelto) y cierre**

```bash
git status   # limpio salvo cambios ya commiteados
```

Al terminar, usar la skill superpowers:finishing-a-development-branch para decidir integración.

---

## Self-review del plan (hecho)

- **Cobertura del spec:** Bloque 1 → Tasks 1–4; Bloque 2 → Tasks 5–7; Bloque 3 → Tasks 8–9; verificación → Task 10. El caso "royale voided deja de contar en locked_royale" ya está cubierto por `test_royale_locked_ignores_settled_voided_and_pack` (existente) — sin task.
- **Placeholders:** los dos `...` en tests de Tasks 4 y 8 son huecos deliberados que el implementador rellena con el patrón nombrado del mismo archivo (`test_second_player_join_schedules_run`, `test_royale_cancel_refunds_buyins`) porque dependen de helpers internos de ese archivo; el comportamiento a assertar está completamente especificado.
- **Consistencia de tipos/nombres:** `reconcile_unresolved_pulls` / `has_pending_refunds` / `reconcile_voided_battle_live` / `resume_royale` / `resume_royale_live` / `_play_round` / `_settle_and_finish` / `BattlePull.refunded` usados con la misma firma en todas las tasks.
