# Tiradas de gacha conducidas por servidor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover la ejecución de las tiradas de gacha del navegador al servidor, de modo que el jugador pueda cerrar la pestaña y las tiradas se completen igual, con el USDC validado y reservado en backend.

**Architecture:** `POST /gacha/pull` valida (máquina encendida, saldo disponible, signer configurado), crea un `GachaPull` más una fila de `Reservation` por sobre, y lanza un worker en `asyncio.create_task`. El worker ejecuta cada sobre (generate → sign → submit → open), libera una fila de reserva en cuanto el pago cuaja on-chain, y libera el resto en un `finally`. El cliente consulta `GET /gacha/pull/{id}` en bucle.

**Tech Stack:** Backend FastAPI + SQLAlchemy 2.0 (`Mapped`/`mapped_column`), pytest + respx. Frontend React 19 + Vite, vitest.

## Global Constraints

- Ejecutar pytest siempre con el venv del proyecto: `backend/.venv/bin/python -m pytest`.
- Ejecutar vitest desde la raíz: `npx vitest run`.
- El throttle `_gacha_throttle` se aplica a **iniciar** tiradas (`POST /gacha/pull`), **nunca** al endpoint de estado, que se pollea por diseño.
- Las reservas de gacha usan `battle_id = f"gacha:{pull_id}"`. No se cambia el esquema de `Reservation`.
- Los importes de USDC son enteros en *base units* (1 USDC = 1_000_000).
- `turbo` en gacha lo **elige el usuario** (viaja en el body). Las batallas usan `turbo=True` hardcodeado; no tocar `pack_engine.py` ni `royale_engine.py`.
- La delegación **ya se exige hoy** (`useWallet.ts:129`). No es un requisito nuevo.
- Commits: mensaje en español, terminando con `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **NUNCA** usar `git add -A`. Añadir solo los ficheros de la tarea.
- El repo tiene trabajo sin commitear ajeno a este plan (`src/wallet/useUsdcBalance.ts`, `backend/app/config.py`, `vite.config.ts`, `scripts/`, `.run/`). No incluirlo en ningún commit.

---

## File Structure

| Fichero | Responsabilidad |
|---|---|
| `backend/app/models.py` | Nuevo `GachaPull`; `GachaPack.pull_id` |
| `backend/app/db.py` | Migración idempotente de la columna `pull_id` |
| `backend/app/services/reservations.py` | Nueva `release_one_reservation` |
| `backend/app/main.py` | `PullBody`, `_pull_ref`, `_persist_opened_pack`, `POST /gacha/pull`, `_run_pull_bg`, `GET /gacha/pull/{id}`, resume de arranque, borrado de `/gacha/yolo` |
| `backend/tests/test_reservations.py` | Tests de `release_one_reservation` |
| `backend/tests/test_gacha_pull.py` | Tests del endpoint, worker, estado y resume |
| `src/onchain/gachaClient.ts` | `startPull`, `fetchPull`; borrar `generateYoloPacks` |
| `src/ui/screens/gacha/GachaVault.tsx` | `handleYolo` pasa a arrancar+pollear |

---

### Task 1: `release_one_reservation`

**Files:**
- Modify: `backend/app/services/reservations.py`
- Test: `backend/tests/test_reservations.py`

**Interfaces:**
- Consumes: `Reservation` de `app.models`.
- Produces: `release_one_reservation(session, battle_id: str) -> int` — marca `released` la fila activa **más antigua** de ese `battle_id` y devuelve su `amount`; `0` si no quedaban activas.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/test_reservations.py`:

```python
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from app.db import init_db, make_session_factory
from app.models import Reservation
from app.services.reservations import (
    release_one_reservation,
    release_reservations,
    reserved_total,
)


def _session():
    engine = create_engine("sqlite:///:memory:",
                           connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    init_db(engine)
    return make_session_factory(engine)()


def test_release_one_releases_oldest_and_returns_amount():
    """Una tirada de gacha guarda una fila por sobre; liberar 'un sobre' es liberar UNA fila."""
    s = _session()
    for _ in range(3):
        s.add(Reservation(wallet="W", battle_id="gacha:p1", amount=10_000_000, status="active"))
    s.commit()
    assert reserved_total(s, "W") == 30_000_000

    assert release_one_reservation(s, "gacha:p1") == 10_000_000
    assert reserved_total(s, "W") == 20_000_000


def test_release_one_without_active_rows_returns_zero():
    """Sobre un ref_id sin filas activas devuelve 0 en vez de reventar."""
    s = _session()
    assert release_one_reservation(s, "gacha:nope") == 0


def test_release_one_leaves_other_refs_untouched():
    """No debe tocar las reservas de otras tiradas ni de batallas."""
    s = _session()
    s.add(Reservation(wallet="W", battle_id="gacha:p1", amount=10_000_000, status="active"))
    s.add(Reservation(wallet="W", battle_id="battle-77", amount=50_000_000, status="active"))
    s.commit()

    release_one_reservation(s, "gacha:p1")
    assert reserved_total(s, "W") == 50_000_000


def test_release_reservations_clears_the_remainder():
    """El finally del worker libera de golpe lo que quede sin gastar."""
    s = _session()
    for _ in range(4):
        s.add(Reservation(wallet="W", battle_id="gacha:p1", amount=10_000_000, status="active"))
    s.commit()

    release_one_reservation(s, "gacha:p1")
    assert release_reservations(s, "gacha:p1") == 3
    assert reserved_total(s, "W") == 0
```

- [ ] **Step 2: Ejecutar el test y ver que falla**

Run: `cd backend && .venv/bin/python -m pytest tests/test_reservations.py -q`
Expected: FAIL con `ImportError: cannot import name 'release_one_reservation'`

- [ ] **Step 3: Implementar**

En `backend/app/services/reservations.py`, añadir al final del fichero:

```python
def release_one_reservation(session, battle_id: str) -> int:
    """Release the OLDEST active reservation row for `battle_id`; return its amount (0 if none).

    A server-driven gacha pull holds ONE row per pack, so a pack's hold can be released the
    instant its payment lands on-chain — without this, the on-chain balance (already reduced)
    and the still-full reservation would double-count and show a negative available balance.
    Releasing a partial AMOUNT isn't possible with this schema: `release_reservations` flips
    every active row of an id at once, which is what the worker's `finally` wants instead.
    """
    row = session.execute(
        select(Reservation)
        .where(Reservation.battle_id == battle_id, Reservation.status == "active")
        .order_by(Reservation.id)
        .limit(1)
    ).scalars().first()
    if row is None:
        return 0
    row.status = "released"
    row.released_at = datetime.now(timezone.utc)
    session.commit()
    return int(row.amount)
```

- [ ] **Step 4: Ejecutar el test y ver que pasa**

Run: `cd backend && .venv/bin/python -m pytest tests/test_reservations.py -q`
Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/reservations.py backend/tests/test_reservations.py
git commit -m "feat(reservations): release_one_reservation para liberación incremental

Las tiradas de gacha retienen una fila por sobre para poder soltar la retención
en cuanto el pago de ese sobre cuaja on-chain. Sin esto el saldo on-chain (ya
reducido) y la reserva completa se contarían dos veces.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Modelo `GachaPull` y columna `GachaPack.pull_id`

**Files:**
- Modify: `backend/app/models.py` (tras `class GachaPack`, sobre la línea 86)
- Modify: `backend/app/db.py` (lista `_ENSURE_COLUMNS`)
- Test: `backend/tests/test_gacha_pull.py` (nuevo)

**Interfaces:**
- Consumes: `Base`, `_now` de `app.models`.
- Produces: `GachaPull` con campos `id, wallet, machine_code, count, turbo, price_each, status, paid_count, error, created_at, finished_at`; `GachaPack.pull_id: Optional[str]`.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/test_gacha_pull.py`:

```python
from sqlalchemy import create_engine, inspect
from sqlalchemy.pool import StaticPool

from app.db import init_db, make_session_factory
from app.models import GachaPack, GachaPull


def _engine():
    engine = create_engine("sqlite:///:memory:",
                           connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    init_db(engine)
    return engine


def test_gacha_pull_row_roundtrip():
    s = make_session_factory(_engine())()
    s.add(GachaPull(id="p1", wallet="W", machine_code="pokemon_50", count=3,
                    turbo=True, price_each=50_000_000, status="running"))
    s.commit()

    row = s.get(GachaPull, "p1")
    assert (row.count, row.turbo, row.price_each) == (3, True, 50_000_000)
    assert row.status == "running"
    assert row.paid_count == 0        # default: aún no se ha pagado ningún sobre
    assert row.error is None
    assert row.finished_at is None


def test_gacha_pack_has_pull_id():
    s = make_session_factory(_engine())()
    s.add(GachaPack(memo="m1", wallet="W", pack_type="pokemon_50", pull_id="p1"))
    s.commit()
    assert s.get(GachaPack, "m1").pull_id == "p1"


def test_pull_id_column_is_added_to_a_preexisting_gacha_packs_table():
    """La DB de dev no tiene migraciones: create_all no añade columnas a tablas ya creadas,
    así que pull_id tiene que estar en _ENSURE_COLUMNS o las DB existentes reventarán."""
    from app.db import _ENSURE_COLUMNS
    assert ("gacha_packs", "pull_id", "VARCHAR") in _ENSURE_COLUMNS
    assert "pull_id" in {c["name"] for c in inspect(_engine()).get_columns("gacha_packs")}
```

- [ ] **Step 2: Ejecutar el test y ver que falla**

Run: `cd backend && .venv/bin/python -m pytest tests/test_gacha_pull.py -q`
Expected: FAIL con `ImportError: cannot import name 'GachaPull'`

- [ ] **Step 3: Implementar el modelo**

En `backend/app/models.py`, añadir `pull_id` a `GachaPack` (justo después de la línea `name: Mapped[Optional[str]] ...`):

```python
    pull_id: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)  # GachaPull.id
```

Y después de la clase `GachaPack`, añadir:

```python
class GachaPull(Base):
    """Un lote de tiradas de gacha ejecutado por el servidor.

    El navegador hace un POST y puede irse: el worker ejecuta todos los sobres y esta fila es
    el registro duradero que el cliente consulta después. `paid_count` avanza en cuanto el
    submit de un sobre cuaja on-chain, y es lo que permite calcular cuánto se devolvió sin
    gastar: price_each * (count - paid_count).
    """
    __tablename__ = "gacha_pulls"
    id: Mapped[str] = mapped_column(String, primary_key=True)          # uuid4().hex
    wallet: Mapped[str] = mapped_column(String, index=True)
    machine_code: Mapped[str] = mapped_column(String)
    count: Mapped[int] = mapped_column(Integer)
    turbo: Mapped[bool] = mapped_column(Boolean, default=False)
    price_each: Mapped[int] = mapped_column(Integer)                   # USDC base units por sobre
    status: Mapped[str] = mapped_column(String, default="running", index=True)  # running|done|aborted
    paid_count: Mapped[int] = mapped_column(Integer, default=0)        # sobres cuyo pago cuajó
    error: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
```

- [ ] **Step 4: Añadir la migración de columna**

En `backend/app/db.py`, dentro de `_ENSURE_COLUMNS`, tras `("gacha_packs", "name", "VARCHAR"),`:

```python
    ("gacha_packs", "pull_id", "VARCHAR"),
```

- [ ] **Step 5: Ejecutar el test y ver que pasa**

Run: `cd backend && .venv/bin/python -m pytest tests/test_gacha_pull.py -q`
Expected: `3 passed`

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/app/db.py backend/tests/test_gacha_pull.py
git commit -m "feat(gacha): modelo GachaPull y GachaPack.pull_id

GachaPull es el registro duradero de un lote de tiradas ejecutado por el
servidor: el cliente lo consulta después de irse. paid_count avanza al cuajar
cada pago y permite calcular lo devuelto sin gastar.

pull_id va también en _ENSURE_COLUMNS porque la DB de dev no tiene migraciones
y create_all no añade columnas a tablas ya existentes.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Extraer `_persist_opened_pack` (refactor sin cambio de comportamiento)

Al abrir un sobre no basta con guardar la carta: la ruta actual **también** otorga
gimmighouls y emite el live drop. El worker debe hacer exactamente lo mismo, así que primero
se extrae a un helper compartido. Esta tarea **no cambia comportamiento**: los tests
existentes de `open-pack` son la red.

**Files:**
- Modify: `backend/app/main.py:466-516` (cuerpo de `gacha_open`)

**Interfaces:**
- Produces: `async def _persist_opened_pack(s: Session, pack: GachaPack, out: dict, wallet: str) -> None` — persiste resultado, otorga gimmighouls la primera vez y lanza el broadcast del drop. No-op si `out` viene `pending` o sin `nft_address`.

- [ ] **Step 1: Ejecutar los tests existentes para fijar la línea base**

Run: `cd backend && .venv/bin/python -m pytest tests/test_gacha_api.py -q`
Expected: `30 passed`

- [ ] **Step 2: Extraer el helper**

En `backend/app/main.py`, **encima** de `@app.post("/gacha/open-pack")`, añadir:

```python
    async def _persist_opened_pack(s: Session, pack: GachaPack, out: dict, wallet: str) -> None:
        """Guarda el resultado de un sobre abierto y dispara sus efectos laterales.

        Compartido por la ruta /gacha/open-pack y por el worker de tiradas: además de
        persistir la carta, otorga gimmighouls la PRIMERA vez y emite el live drop. Tenerlo
        en un solo sitio evita que el camino del worker pierda lealtad y feed en silencio.
        No hace nada si el sobre sigue pendiente en CC.
        """
        if out.get("pending") or not out.get("nft_address"):
            return
        first_open = pack.opened_at is None
        pack.opened_at = datetime.now(timezone.utc)
        pack.nft_address = out["nft_address"]
        pack.insured_value = out.get("insured_value")
        pack.name = out.get("name")
        try:
            pack.price = await _machine_price(pack.pack_type)
        except Exception:
            pass  # best-effort; el open ya tuvo éxito
        if first_open and pack.price:
            from .services.referrals import award_gimmighouls
            award_gimmighouls(s, wallet, float(pack.price),
                              ratio=get_settings().gimmighoul_per_usdc_gacha)
        s.commit()
        username = read_user_view(s, wallet, elo_start).get("alias")
        drop = {
            "type": "drop",
            "id": out.get("nft_address"),
            "wallet": wallet,
            "username": username,
            "name": out.get("name"),
            "valueUsd": out.get("insured_value"),
            "rarity": out.get("rarity"),
            "image": out.get("image"),
            "ts": int(_time.time()),
        }
        asyncio.create_task(_broadcast_drop_later(drop, cost_base=pack.price,
                                                  machine_code=pack.pack_type))
```

- [ ] **Step 3: Sustituir el cuerpo duplicado de la ruta**

En `gacha_open`, reemplazar todo el bloque `if not out.get("pending") and out.get("nft_address"):` (desde esa línea hasta el `asyncio.create_task(_broadcast_drop_later(...))` incluido) por:

```python
        await _persist_opened_pack(s, pack, out, wallet)
        return out
```

- [ ] **Step 4: Verificar que no cambió el comportamiento**

Run: `cd backend && .venv/bin/python -m pytest tests/test_gacha_api.py tests/test_live_drops.py -q`
Expected: todos pasan, mismo número que en el Step 1 para `test_gacha_api.py`

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py
git commit -m "refactor(gacha): extraer _persist_opened_pack

Abrir un sobre no solo guarda la carta: otorga gimmighouls la primera vez y
emite el live drop. Extraerlo a un helper compartido para que el worker de
tiradas por servidor no pierda esos efectos en silencio. Sin cambio de
comportamiento: los tests de open-pack y live drops son la red.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `POST /gacha/pull` — validar, reservar, lanzar

El worker se monkeypatchea en los tests para probar validación y reserva aisladas.

**Files:**
- Modify: `backend/app/main.py` (nuevo `PullBody` junto a `YoloBody:142`; ruta y helpers junto a `/gacha/yolo:610`)
- Test: `backend/tests/test_gacha_pull.py`

**Interfaces:**
- Consumes: `release_one_reservation` (Task 1), `GachaPull` (Task 2), `_machine_price`, `_require_available`, `_gacha_throttle`, `current_user`, `current_user_id`.
- Produces: `_pull_ref(pull_id: str) -> str`; `POST /gacha/pull` → `202 {"pull_id": str}`; `_run_pull_bg(pull_id: str, wallet_id: str) -> None` (stub en esta tarea, implementado en Task 5).

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `backend/tests/test_gacha_pull.py` (junto a los imports ya existentes, añadir los nuevos):

```python
import json
import time

import jwt
import pytest
import respx
from httpx import Response
from fastapi.testclient import TestClient

from app.main import create_app
from app.privy import PrivyVerifier
from app.services.gacha import GachaService
from app.models import Reservation
from app.services.reservations import reserved_total
from tests.conftest import make_es256, privy_auth_headers

BASE = "https://dev-gacha.example.com"
APP_ID = "test-app"
WALLET_A = "So1anaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1"
WALLET_B = "So1anaBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1"


class _FakeSigner:
    """Sustituto de PrivySigner: la ruta solo comprueba que no sea None."""
    enabled = True

    async def sign_solana(self, wallet_id, tx_base64):
        return "signed-" + tx_base64


async def _noop_runner(pull_id, wallet_id):
    """Worker desactivado: deja el pull en 'running' para poder inspeccionar la reserva."""
    return None


def _pull_client(rate_limit=60, signer=_FakeSigner(), pull_runner=None,
                 with_operator=False):
    """Por defecto usa el worker REAL. Pasa `pull_runner=_noop_runner` para desactivarlo y
    poder inspeccionar el pull en estado 'running' con su reserva intacta.

    OJO: el worker se inyecta por parámetro y NO se monkeypatchea, porque vive como closure
    dentro de create_app y no existe como atributo de módulo — `setattr("app.main._run_pull_bg")`
    crearía un atributo que nadie lee y el worker real correría igual durante el test.
    """
    engine = create_engine("sqlite:///:memory:",
                           connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    init_db(engine)
    sf = make_session_factory(engine)
    priv = make_es256()
    privy = PrivyVerifier(app_id=APP_ID, key_resolver=lambda kid: priv.public_key())
    gacha = GachaService(base_url=BASE, api_key="k")
    app = create_app(sf, MockChainSource(), elo_start=1200, elo_k=32, gacha=gacha,
                     gacha_rate_limit=rate_limit, privy=privy, privy_signer=signer,
                     pull_runner=pull_runner,
                     solana_rpc_url="https://api.devnet.solana.com",
                     cc_usdc_mint="Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr",
                     privy_operator_wallet_id="op-id" if with_operator else "",
                     privy_operator_address=("So1anaOPERATOR1111111111111111111111111111"
                                             if with_operator else ""))
    return TestClient(app), priv, sf


def _mock_machines(price=10, available=True):
    respx.get(f"{BASE}/api/machines").mock(return_value=Response(200, json={"machines": [
        {"code": "pokemon_50", "price": price, "available": available}]}))
    respx.get(f"{BASE}/api/status").mock(return_value=Response(200, json={"gachas": []}))


@respx.mock
def test_pull_reserves_one_row_per_pack_and_returns_202(monkeypatch):
    _mock_machines(price=10)
    async def _bal(*a, **kw): return 100_000_000          # 100 USDC
    monkeypatch.setattr("app.main.usdc_balance_base_units", _bal)

    c, priv, sf = _pull_client(pull_runner=_noop_runner)   # el pull queda en 'running'
    r = c.post("/gacha/pull", json={"machine_code": "pokemon_50", "count": 3, "turbo": True},
               headers=privy_auth_headers(priv, APP_ID, WALLET_A))
    assert r.status_code == 202, r.text
    pull_id = r.json()["pull_id"]

    s = sf()
    pull = s.get(GachaPull, pull_id)
    assert (pull.wallet, pull.count, pull.turbo, pull.price_each) == (WALLET_A, 3, True, 10_000_000)
    assert pull.status == "running"
    # UNA fila por sobre, no una sola por el total → permite liberación incremental
    rows = s.query(Reservation).filter_by(battle_id=f"gacha:{pull_id}", status="active").all()
    assert len(rows) == 3 and {x.amount for x in rows} == {10_000_000}
    assert reserved_total(s, WALLET_A) == 30_000_000


@respx.mock
def test_pull_409_when_machine_is_off(monkeypatch):
    _mock_machines(price=10, available=False)
    async def _bal(*a, **kw): return 100_000_000
    monkeypatch.setattr("app.main.usdc_balance_base_units", _bal)
    c, priv, sf = _pull_client()

    r = c.post("/gacha/pull", json={"machine_code": "pokemon_50", "count": 1, "turbo": False},
               headers=privy_auth_headers(priv, APP_ID, WALLET_A))
    assert r.status_code == 409
    assert sf().query(GachaPull).count() == 0        # ni tirada ni reserva
    assert reserved_total(sf(), WALLET_A) == 0


@respx.mock
def test_pull_402_when_available_balance_is_short(monkeypatch):
    """25 USDC de saldo no bastan para 3 sobres de 10."""
    _mock_machines(price=10)
    async def _bal(*a, **kw): return 25_000_000
    monkeypatch.setattr("app.main.usdc_balance_base_units", _bal)
    c, priv, sf = _pull_client()

    r = c.post("/gacha/pull", json={"machine_code": "pokemon_50", "count": 3, "turbo": False},
               headers=privy_auth_headers(priv, APP_ID, WALLET_A))
    assert r.status_code == 402
    assert sf().query(GachaPull).count() == 0


@respx.mock
def test_pull_402_counts_existing_reservations(monkeypatch):
    """Saldo suficiente pero ya reservado por una batalla → no se puede gastar dos veces."""
    _mock_machines(price=10)
    async def _bal(*a, **kw): return 30_000_000
    monkeypatch.setattr("app.main.usdc_balance_base_units", _bal)
    c, priv, sf = _pull_client()
    s = sf()
    s.add(Reservation(wallet=WALLET_A, battle_id="battle-1", amount=25_000_000, status="active"))
    s.commit()

    r = c.post("/gacha/pull", json={"machine_code": "pokemon_50", "count": 1, "turbo": False},
               headers=privy_auth_headers(priv, APP_ID, WALLET_A))
    assert r.status_code == 402


@respx.mock
def test_pull_503_without_signer(monkeypatch):
    _mock_machines(price=10)
    async def _bal(*a, **kw): return 100_000_000
    monkeypatch.setattr("app.main.usdc_balance_base_units", _bal)
    c, priv, sf = _pull_client(signer=None)

    r = c.post("/gacha/pull", json={"machine_code": "pokemon_50", "count": 1, "turbo": False},
               headers=privy_auth_headers(priv, APP_ID, WALLET_A))
    assert r.status_code == 503


@respx.mock
def test_pull_requires_auth():
    _mock_machines(price=10)
    c, _, _ = _pull_client()
    assert c.post("/gacha/pull",
                  json={"machine_code": "pokemon_50", "count": 1, "turbo": False}).status_code == 401


@respx.mock
def test_reserved_pull_blocks_withdrawing_the_same_money(monkeypatch):
    """El objetivo declarado de la reserva: que no puedas sacar lo que ya has comprometido."""
    _mock_machines(price=10)
    async def _bal(*a, **kw): return 30_000_000          # 30 USDC
    monkeypatch.setattr("app.main.usdc_balance_base_units", _bal)

    c, priv, _ = _pull_client(with_operator=True, pull_runner=_noop_runner)
    hdrs = privy_auth_headers(priv, APP_ID, WALLET_A)

    # Antes de reservar, retirar 25 de los 30 está permitido por saldo.
    r = c.post("/gacha/pull", json={"machine_code": "pokemon_50", "count": 3, "turbo": False},
               headers=hdrs)
    assert r.status_code == 202                            # 30 USDC quedan retenidos

    w = c.post("/users/me/withdraw", json={"amount": 25.0}, headers=hdrs)
    assert w.status_code == 402, w.text
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `cd backend && .venv/bin/python -m pytest tests/test_gacha_pull.py -q -k pull_`
Expected: FAIL con 404 en las rutas (la ruta aún no existe)

- [ ] **Step 3: Añadir el body model**

En `backend/app/main.py`, tras `class YoloBody` (línea 142-145):

```python
class PullBody(BaseModel):
    machine_code: str = Field(min_length=1, max_length=32, pattern=r"^[a-z0-9_]+$")
    count: int = Field(ge=1, le=10)
    turbo: bool = False
```

- [ ] **Step 4: Añadir imports, el parámetro `pull_runner`, `_pull_ref` y la ruta**

Añadir a los imports de `app.services.reservations` en `main.py` (línea 45) el nombre
`release_one_reservation`, y a los de `app.models` el nombre `GachaPull`. Añadir
`from uuid import uuid4` a los imports de la cabecera.

En la firma de `create_app` (línea 176), tras `privy_signer: PrivySigner | None = None,`:

```python
               pull_runner=None,   # inyectable en tests; None = worker real (_run_pull_bg)
```

El worker se inyecta en vez de monkeypatchearse porque vive como **closure dentro de
`create_app`** y no existe como atributo de módulo: un `setattr("app.main._run_pull_bg", …)`
crearía un atributo que nadie lee, y el worker real correría igual durante el test.

Justo encima de `@app.post("/gacha/yolo")`:

```python
    def _pull_ref(pull_id: str) -> str:
        """Clave de las reservas de una tirada. Reusa Reservation.battle_id con prefijo para no
        migrar el esquema; el prefijo evita cualquier choque con ids de batalla."""
        return f"gacha:{pull_id}"

    @app.post("/gacha/pull", status_code=202)
    async def gacha_pull_start(body: PullBody,
                               wallet: str = Depends(current_user),
                               wallet_id: str = Depends(current_user_id),
                               s: Session = Depends(db)):
        """Arranca una tirada conducida por el servidor.

        Valida de forma SÍNCRONA (para que el usuario vea el error al instante), reserva el
        importe completo y devuelve 202 con el id. El worker sigue aunque el cliente se vaya.
        """
        _gacha_or_503()
        if privy_signer is None:
            raise HTTPException(503, "gacha_unavailable")
        _gacha_throttle(wallet)
        price = await _machine_price(body.machine_code)      # 409 si la máquina está apagada
        total = price * body.count
        await _require_available(wallet, total, s)           # 402 si saldo - reservado < total
        pull_id = uuid4().hex
        s.add(GachaPull(id=pull_id, wallet=wallet, machine_code=body.machine_code,
                        count=body.count, turbo=body.turbo, price_each=price, status="running"))
        # Una fila por sobre: liberar "un sobre" al cuajar su pago es liberar UNA fila.
        for _ in range(body.count):
            s.add(Reservation(wallet=wallet, battle_id=_pull_ref(pull_id),
                              amount=price, status="active"))
        s.commit()
        asyncio.create_task((pull_runner or _run_pull_bg)(pull_id, wallet_id))
        return {"pull_id": pull_id}
```

- [ ] **Step 5: Añadir el stub del worker**

Inmediatamente después de la ruta anterior (se implementa en Task 5):

```python
    async def _run_pull_bg(pull_id: str, wallet_id: str) -> None:
        return None
```

- [ ] **Step 6: Ejecutar y ver que pasan**

Run: `cd backend && .venv/bin/python -m pytest tests/test_gacha_pull.py -q`
Expected: `10 passed`

- [ ] **Step 7: Commit**

```bash
git add backend/app/main.py backend/tests/test_gacha_pull.py
git commit -m "feat(gacha): POST /gacha/pull valida y reserva antes de tirar

Valida de forma síncrona máquina encendida (409), saldo disponible descontando
lo reservado (402) y signer configurado (503), y solo entonces reserva una fila
por sobre y responde 202. Cierra el bypass que tenía /gacha/yolo, que no
comprobaba ninguna de las tres cosas en servidor.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: El worker `_run_pull_bg`

**Files:**
- Modify: `backend/app/main.py` (sustituir el stub del Task 4)
- Test: `backend/tests/test_gacha_pull.py`

**Interfaces:**
- Consumes: `_pull_ref`, `_persist_opened_pack`, `release_one_reservation`, `release_reservations`, `GachaPull`, `GachaPack`.
- Produces: `_run_pull_bg(pull_id, wallet_id)` deja el `GachaPull` en `done` o `aborted`, con `paid_count` actualizado y **todas** las reservas del pull liberadas.

**Orden dentro de un sobre y por qué:** `generate → sign → submit` se reintenta hasta 3 veces
porque hasta que el submit no devuelve firma **no se ha pagado nada** (como mucho queda un
memo abandonado). En cuanto el submit devuelve firma: se libera UNA fila de reserva (el
dinero ya salió on-chain) y **ya no se reintenta ese sobre**, para no cobrar dos veces. El
`open_pack` posterior tiene su propio poll; si sigue pendiente al final, el sobre queda con
`opened_at = NULL` (estado "pendiente" que ya existe) y **no** aborta el lote: el pago fue
bueno y la carta llegará.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `backend/tests/test_gacha_pull.py`:

```python
def _mock_pull_upstream(open_response=None, generate_fail_times=0):
    """generatePack/submitTransaction/openPack de CC. `generate_fail_times` primeras
    generaciones devuelven 500 para ejercitar los reintentos."""
    calls = {"generate": 0}

    def _generate(request):
        calls["generate"] += 1
        if calls["generate"] <= generate_fail_times:
            return Response(500, text="boom")
        return Response(200, json={"memo": f"memo-{calls['generate']}", "transaction": "dA=="})

    respx.post(f"{BASE}/api/generatePack").mock(side_effect=_generate)
    respx.post(f"{BASE}/api/submitTransaction").mock(
        return_value=Response(200, json={"signature": "sig", "confirmationStatus": "confirmed"}))
    respx.post(f"{BASE}/api/openPack").mock(return_value=Response(200, json=(
        open_response or {"success": True, "nft_address": "Mint" + "1" * 40, "rarity": "Rare",
                          "nftWon": {"content": {"metadata": {"name": "Pika"}}, "image": "https://x/p.png"}})))
    return calls


@respx.mock
@pytest.mark.anyio
async def test_worker_completes_every_pack_and_releases_all_reservations(monkeypatch):
    from app import main as main_mod
    _mock_machines(price=10)
    _mock_pull_upstream()
    async def _bal(*a, **kw): return 100_000_000
    monkeypatch.setattr("app.main.usdc_balance_base_units", _bal)

    c, priv, sf = _pull_client()
    r = c.post("/gacha/pull", json={"machine_code": "pokemon_50", "count": 2, "turbo": False},
               headers=privy_auth_headers(priv, APP_ID, WALLET_A))
    pull_id = r.json()["pull_id"]
    await _wait_for_pull(sf, pull_id)

    s = sf()
    pull = s.get(GachaPull, pull_id)
    assert pull.status == "done"
    assert pull.paid_count == 2
    assert pull.finished_at is not None
    assert reserved_total(s, WALLET_A) == 0                    # nada retenido al terminar
    packs = s.query(GachaPack).filter_by(pull_id=pull_id).all()
    assert len(packs) == 2 and all(p.nft_address for p in packs)


@respx.mock
@pytest.mark.anyio
async def test_worker_retries_a_failing_generate(monkeypatch):
    """Dos fallos de generate y al tercer intento cuaja: el lote termina bien."""
    _mock_machines(price=10)
    calls = _mock_pull_upstream(generate_fail_times=2)
    async def _bal(*a, **kw): return 100_000_000
    monkeypatch.setattr("app.main.usdc_balance_base_units", _bal)

    c, priv, sf = _pull_client()
    r = c.post("/gacha/pull", json={"machine_code": "pokemon_50", "count": 1, "turbo": False},
               headers=privy_auth_headers(priv, APP_ID, WALLET_A))
    await _wait_for_pull(sf, r.json()["pull_id"])

    assert calls["generate"] == 3
    assert sf().get(GachaPull, r.json()["pull_id"]).status == "done"


@respx.mock
@pytest.mark.anyio
async def test_worker_aborts_after_three_failures_and_refunds_the_rest(monkeypatch):
    """generate falla siempre → 0 sobres pagados, lote abortado, TODO liberado."""
    _mock_machines(price=10)
    _mock_pull_upstream(generate_fail_times=99)
    async def _bal(*a, **kw): return 100_000_000
    monkeypatch.setattr("app.main.usdc_balance_base_units", _bal)

    c, priv, sf = _pull_client()
    r = c.post("/gacha/pull", json={"machine_code": "pokemon_50", "count": 5, "turbo": False},
               headers=privy_auth_headers(priv, APP_ID, WALLET_A))
    pull_id = r.json()["pull_id"]
    await _wait_for_pull(sf, pull_id)

    s = sf()
    pull = s.get(GachaPull, pull_id)
    assert pull.status == "aborted"
    assert pull.paid_count == 0
    assert pull.error
    assert reserved_total(s, WALLET_A) == 0        # los 5 sobres devueltos


@respx.mock
@pytest.mark.anyio
async def test_worker_releases_reservations_even_on_unexpected_error(monkeypatch):
    """El finally es la red que sustituye al TTL: pase lo que pase, no queda dinero retenido."""
    _mock_machines(price=10)
    _mock_pull_upstream()
    async def _bal(*a, **kw): return 100_000_000
    monkeypatch.setattr("app.main.usdc_balance_base_units", _bal)

    # release_one_reservation SÍ es importable a nivel de módulo en main.py (línea 45), a
    # diferencia de los helpers que viven como closures dentro de create_app.
    def _explode(*a, **kw):
        raise RuntimeError("algo inesperado a mitad del sobre")
    monkeypatch.setattr("app.main.release_one_reservation", _explode)

    c, priv, sf = _pull_client()
    r = c.post("/gacha/pull", json={"machine_code": "pokemon_50", "count": 2, "turbo": False},
               headers=privy_auth_headers(priv, APP_ID, WALLET_A))
    pull_id = r.json()["pull_id"]
    await _wait_for_pull(sf, pull_id)

    s = sf()
    assert s.get(GachaPull, pull_id).status == "aborted"
    assert reserved_total(s, WALLET_A) == 0     # el finally libera pase lo que pase


@respx.mock
@pytest.mark.anyio
async def test_worker_leaves_a_still_pending_pack_unopened_without_aborting(monkeypatch):
    """Pagado pero CC no entrega: opened_at queda NULL (estado pendiente ya existente) y el
    lote NO se aborta, porque el pago fue bueno."""
    _mock_machines(price=10)
    _mock_pull_upstream(open_response={"code": "WAITING_FOR_WEBHOOK"})
    async def _bal(*a, **kw): return 100_000_000
    monkeypatch.setattr("app.main.usdc_balance_base_units", _bal)
    monkeypatch.setattr("app.main._PULL_OPEN_ATTEMPTS", 2)
    monkeypatch.setattr("app.main._PULL_RETRY_DELAY_S", 0.0)

    c, priv, sf = _pull_client()
    r = c.post("/gacha/pull", json={"machine_code": "pokemon_50", "count": 1, "turbo": False},
               headers=privy_auth_headers(priv, APP_ID, WALLET_A))
    pull_id = r.json()["pull_id"]
    await _wait_for_pull(sf, pull_id)

    s = sf()
    assert s.get(GachaPull, pull_id).status == "done"
    assert s.get(GachaPull, pull_id).paid_count == 1
    pack = s.query(GachaPack).filter_by(pull_id=pull_id).one()
    assert pack.opened_at is None and pack.nft_address is None
    assert reserved_total(s, WALLET_A) == 0
```

Añadir además, al principio del fichero de tests, el helper de espera y el fixture de anyio:

```python
import asyncio


@pytest.fixture
def anyio_backend():
    return "asyncio"


async def _wait_for_pull(sf, pull_id, timeout_s=5.0):
    """Espera a que el worker en background deje el pull en un estado terminal."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        row = sf().get(GachaPull, pull_id)
        if row is not None and row.status in ("done", "aborted"):
            return row
        await asyncio.sleep(0.02)
    raise AssertionError(f"el pull {pull_id} no terminó en {timeout_s}s")
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `cd backend && .venv/bin/python -m pytest tests/test_gacha_pull.py -q -k worker`
Expected: FAIL — el stub deja el pull en `running` y `_wait_for_pull` lanza el AssertionError

- [ ] **Step 3: Implementar el worker**

En `backend/app/main.py`, sustituir el stub `_run_pull_bg` por:

```python
    _PULL_ATTEMPTS = 3            # intentos de generate+sign+submit por sobre
    _PULL_OPEN_ATTEMPTS = 8       # polls de open_pack por sobre (CC tarda en asentar)
    _PULL_RETRY_DELAY_S = 1.5

    async def _pull_one_pack(s: Session, pull: GachaPull, wallet_id: str) -> None:
        """Ejecuta UN sobre. Lanza excepción si no se llegó a pagar (el lote abortará).

        Hasta que submit_tx no devuelve firma no se ha pagado nada, así que esa parte se puede
        reintentar sin riesgo de doble cobro. En cuanto hay firma: se libera una fila de reserva
        (el dinero ya salió) y NO se reintenta más este sobre.
        """
        last_err: Exception | None = None
        for attempt in range(_PULL_ATTEMPTS):
            try:
                pack_out = await gacha.generate_pack(player_address=pull.wallet,
                                                     pack_type=pull.machine_code,
                                                     turbo=pull.turbo)
                memo = pack_out.get("memo")
                if not memo:
                    raise RuntimeError("generatePack sin memo")
                signed = await privy_signer.sign_solana(wallet_id, pack_out["transaction"])
                sub = await gacha.submit_tx(signed)
                if not sub.get("signature"):
                    raise RuntimeError("submit sin signature")
                break                                  # pagado: se sale del bucle de reintentos
            except Exception as e:                     # nada pagado todavía → reintentable
                last_err = e
                if attempt < _PULL_ATTEMPTS - 1:
                    await asyncio.sleep(_PULL_RETRY_DELAY_S * (attempt + 1))
        else:
            raise last_err or RuntimeError("no se pudo iniciar el sobre")

        # A partir de aquí el sobre ESTÁ pagado: registrar, soltar su retención y abrir.
        pack = GachaPack(memo=memo, wallet=pull.wallet, pack_type=pull.machine_code,
                         pull_id=pull.id)
        s.add(pack)
        pull.paid_count += 1
        s.commit()
        release_one_reservation(s, _pull_ref(pull.id))   # el USDC ya salió on-chain

        for attempt in range(_PULL_OPEN_ATTEMPTS):
            try:
                out = await gacha.open_pack(memo=memo)
            except Exception:
                out = {"pending": True}
            if not out.get("pending"):
                await _persist_opened_pack(s, pack, out, pull.wallet)
                return
            if attempt < _PULL_OPEN_ATTEMPTS - 1:
                await asyncio.sleep(_PULL_RETRY_DELAY_S)
        # Sigue pendiente: el pago fue bueno, así que NO se aborta el lote. El sobre queda con
        # opened_at NULL y lo recoge la vía de pendientes que ya existe.

    async def _run_pull_bg(pull_id: str, wallet_id: str) -> None:
        """Ejecuta el lote entero. El finally garantiza que no quede USDC retenido: es la red
        que en las batallas da el finally de _run_bg, y por eso este flujo no necesita un TTL."""
        s = session_factory()
        try:
            pull = s.get(GachaPull, pull_id)
            if pull is None:
                return
            try:
                for _ in range(pull.count):
                    await _pull_one_pack(s, pull, wallet_id)
                pull.status = "done"
            except Exception as e:
                logger.warning("gacha pull %s abortado: %s", pull_id, e)
                pull.status = "aborted"
                pull.error = str(e)[:200]
            pull.finished_at = datetime.now(timezone.utc)
            s.commit()
        except Exception:
            logger.exception("gacha pull %s falló de forma inesperada", pull_id)
        finally:
            try:
                release_reservations(s, _pull_ref(pull_id))
            except Exception:
                logger.exception("no se pudieron liberar las reservas de %s", pull_id)
            s.close()
```

- [ ] **Step 4: Ejecutar y ver que pasan**

Run: `cd backend && .venv/bin/python -m pytest tests/test_gacha_pull.py -q`
Expected: `15 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py backend/tests/test_gacha_pull.py
git commit -m "feat(gacha): worker que ejecuta la tirada en el servidor

Por sobre: generate+sign+submit con 3 reintentos (hasta que el submit no
devuelve firma no se ha pagado nada, así que reintentar no puede cobrar dos
veces), y en cuanto hay firma se libera una fila de reserva porque el USDC ya
salió on-chain. El open_pack tiene su propio poll; un sobre que siga pendiente
NO aborta el lote, porque el pago fue bueno.

El finally libera siempre lo no gastado: es la red que sustituye al TTL que
haría falta si condujera el navegador.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `GET /gacha/pull/{id}` — estado y resultados

**Files:**
- Modify: `backend/app/main.py` (tras `POST /gacha/pull`)
- Test: `backend/tests/test_gacha_pull.py`

**Interfaces:**
- Produces: `GET /gacha/pull/{pull_id}` → `{id, status, count, done, paid, turbo, results[], refunded_base_units, error}`. `404` si no existe, `403` si no es del solicitante. **Sin `_gacha_throttle`.**

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `backend/tests/test_gacha_pull.py`:

```python
@respx.mock
@pytest.mark.anyio
async def test_pull_status_returns_results_and_refund(monkeypatch):
    _mock_machines(price=10)
    _mock_pull_upstream(generate_fail_times=99)      # nada se llega a pagar
    async def _bal(*a, **kw): return 100_000_000
    monkeypatch.setattr("app.main.usdc_balance_base_units", _bal)
    monkeypatch.setattr("app.main._PULL_RETRY_DELAY_S", 0.0)

    c, priv, sf = _pull_client()
    hdrs = privy_auth_headers(priv, APP_ID, WALLET_A)
    r = c.post("/gacha/pull", json={"machine_code": "pokemon_50", "count": 4, "turbo": False},
               headers=hdrs)
    pull_id = r.json()["pull_id"]
    await _wait_for_pull(sf, pull_id)

    st = c.get(f"/gacha/pull/{pull_id}", headers=hdrs)
    assert st.status_code == 200
    body = st.json()
    assert body["status"] == "aborted"
    assert (body["count"], body["paid"], body["done"]) == (4, 0, 0)
    assert body["refunded_base_units"] == 40_000_000      # 4 sobres x 10 USDC devueltos
    assert body["results"] == []
    assert body["error"]


@respx.mock
@pytest.mark.anyio
async def test_pull_status_lists_pulled_cards(monkeypatch):
    _mock_machines(price=10)
    _mock_pull_upstream()
    async def _bal(*a, **kw): return 100_000_000
    monkeypatch.setattr("app.main.usdc_balance_base_units", _bal)

    c, priv, sf = _pull_client()
    hdrs = privy_auth_headers(priv, APP_ID, WALLET_A)
    r = c.post("/gacha/pull", json={"machine_code": "pokemon_50", "count": 2, "turbo": False},
               headers=hdrs)
    pull_id = r.json()["pull_id"]
    await _wait_for_pull(sf, pull_id)

    body = c.get(f"/gacha/pull/{pull_id}", headers=hdrs).json()
    assert body["status"] == "done"
    assert (body["count"], body["paid"], body["done"]) == (2, 2, 2)
    assert body["refunded_base_units"] == 0
    assert len(body["results"]) == 2
    assert body["results"][0]["name"] == "Pika"
    assert body["results"][0]["nft_address"].startswith("Mint")


@respx.mock
def test_pull_status_403_for_another_wallet(monkeypatch):
    _mock_machines(price=10)
    async def _bal(*a, **kw): return 100_000_000
    monkeypatch.setattr("app.main.usdc_balance_base_units", _bal)

    c, priv, sf = _pull_client(pull_runner=_noop_runner)
    pull_id = c.post("/gacha/pull", json={"machine_code": "pokemon_50", "count": 1, "turbo": False},
                     headers=privy_auth_headers(priv, APP_ID, WALLET_A)).json()["pull_id"]

    r = c.get(f"/gacha/pull/{pull_id}", headers=privy_auth_headers(priv, APP_ID, WALLET_B))
    assert r.status_code == 403


@respx.mock
def test_pull_status_404_when_unknown():
    c, priv, _ = _pull_client()
    r = c.get("/gacha/pull/noexiste", headers=privy_auth_headers(priv, APP_ID, WALLET_A))
    assert r.status_code == 404


@respx.mock
def test_pull_status_is_not_rate_limited(monkeypatch):
    """Se pollea por diseño: throttlearlo es el error que causaba los 429."""
    _mock_machines(price=10)
    async def _bal(*a, **kw): return 100_000_000
    monkeypatch.setattr("app.main.usdc_balance_base_units", _bal)

    c, priv, _ = _pull_client(rate_limit=2, pull_runner=_noop_runner)
    hdrs = privy_auth_headers(priv, APP_ID, WALLET_A)
    pull_id = c.post("/gacha/pull", json={"machine_code": "pokemon_50", "count": 1, "turbo": False},
                     headers=hdrs).json()["pull_id"]

    codes = [c.get(f"/gacha/pull/{pull_id}", headers=hdrs).status_code for _ in range(8)]
    assert codes == [200] * 8, codes
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `cd backend && .venv/bin/python -m pytest tests/test_gacha_pull.py -q -k status`
Expected: FAIL con 404 (la ruta no existe)

- [ ] **Step 3: Implementar la ruta**

En `backend/app/main.py`, tras `gacha_pull_start`:

```python
    @app.get("/gacha/pull/{pull_id}")
    async def gacha_pull_status(pull_id: str,
                                wallet: str = Depends(current_user),
                                s: Session = Depends(db)):
        """Estado y resultados de una tirada.

        SIN _gacha_throttle a propósito: el cliente lo pollea mientras dura la tirada, y
        throttlear un endpoint polleado es exactamente lo que provocaba los 429 en open-pack.
        """
        pull = s.get(GachaPull, pull_id)
        if pull is None:
            raise HTTPException(404, "tirada no encontrada")
        if pull.wallet != wallet:
            raise HTTPException(403, "esta tirada no es tuya")
        packs = (s.query(GachaPack)
                 .filter_by(pull_id=pull_id)
                 .order_by(GachaPack.created_at)
                 .all())
        results = [{
            "nft_address": p.nft_address,
            "name": p.name,
            "insured_value": p.insured_value,
            "pending": False,
        } for p in packs if p.nft_address]
        return {
            "id": pull.id,
            "status": pull.status,
            "count": pull.count,
            "paid": pull.paid_count,
            "done": len(results),
            "turbo": pull.turbo,
            "results": results,
            "refunded_base_units": pull.price_each * (pull.count - pull.paid_count),
            "error": pull.error,
        }
```

- [ ] **Step 4: Ejecutar y ver que pasan**

Run: `cd backend && .venv/bin/python -m pytest tests/test_gacha_pull.py -q`
Expected: `20 passed` (15 previos + los 5 de estado)

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py backend/tests/test_gacha_pull.py
git commit -m "feat(gacha): GET /gacha/pull/{id} con estado, resultados y devolución

Sin throttle a propósito: se pollea por diseño, y throttlear un endpoint
polleado es justo lo que provocaba los 429 en open-pack. 403 si la tirada no es
de quien pregunta.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Resume al arrancar

**Files:**
- Modify: `backend/app/main.py` (dentro de `_resume_orphaned_battles`, línea ~1336)
- Test: `backend/tests/test_gacha_pull.py`

**Interfaces:**
- Produces: al arrancar, todo `GachaPull` en `running` queda `aborted` con sus reservas liberadas.

- [ ] **Step 1: Escribir el test que falla**

Añadir a `backend/tests/test_gacha_pull.py`:

```python
@respx.mock
def test_startup_aborts_orphaned_pulls_and_frees_the_money():
    """Un reinicio mata al worker. Sin esto, la reserva quedaría activa para siempre y el
    usuario no podría ni tirar ni retirar su propio dinero."""
    engine = create_engine("sqlite:///:memory:",
                           connect_args={"check_same_thread": False}, poolclass=StaticPool)
    init_db(engine)
    sf = make_session_factory(engine)
    s = sf()
    s.add(GachaPull(id="huerfano", wallet=WALLET_A, machine_code="pokemon_50", count=3,
                    turbo=False, price_each=10_000_000, status="running", paid_count=1))
    for _ in range(2):
        s.add(Reservation(wallet=WALLET_A, battle_id="gacha:huerfano",
                          amount=10_000_000, status="active"))
    s.commit()
    assert reserved_total(s, WALLET_A) == 20_000_000

    priv = make_es256()
    privy = PrivyVerifier(app_id=APP_ID, key_resolver=lambda kid: priv.public_key())
    app = create_app(sf, MockChainSource(), elo_start=1200, elo_k=32,
                     gacha=GachaService(base_url=BASE, api_key="k"),
                     privy=privy, privy_signer=_FakeSigner())
    with TestClient(app):                       # dispara el evento startup
        pass

    s2 = sf()
    assert s2.get(GachaPull, "huerfano").status == "aborted"
    assert reserved_total(s2, WALLET_A) == 0
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `cd backend && .venv/bin/python -m pytest tests/test_gacha_pull.py -q -k startup`
Expected: FAIL — `status` sigue siendo `running` y `reserved_total` sigue en 20_000_000

- [ ] **Step 3: Implementar**

En `backend/app/main.py`, dentro de `_resume_orphaned_battles`, **antes** del `if privy_signer is None or gacha is None: return` (para que se ejecute aunque el gacha esté deshabilitado):

```python
        # Las tiradas de gacha no se reanudan: los sobres que faltaban nunca llegaron a pagar,
        # así que abortar y devolver es lo coherente con la política de fallo. Sin esto la
        # reserva quedaría activa para siempre y bloquearía hasta el retiro del propio usuario.
        try:
            with session_factory() as s0:
                orphans = [p.id for p in s0.query(GachaPull).filter_by(status="running").all()]
                for pull_id in orphans:
                    pull = s0.get(GachaPull, pull_id)
                    pull.status = "aborted"
                    pull.error = "backend reiniciado a media tirada"
                    pull.finished_at = datetime.now(timezone.utc)
                    s0.commit()
                    release_reservations(s0, _pull_ref(pull_id))
                if orphans:
                    logger.warning("resume: %d tirada(s) de gacha abortadas y devueltas",
                                   len(orphans))
        except Exception:
            logger.exception("resume: no se pudieron cerrar las tiradas huérfanas")
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `cd backend && .venv/bin/python -m pytest tests/test_gacha_pull.py -q`
Expected: `21 passed` (20 previos + el de arranque)

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py backend/tests/test_gacha_pull.py
git commit -m "feat(gacha): abortar y devolver las tiradas huérfanas al arrancar

Un reinicio mata al worker en memoria. Sin este barrido la reserva quedaría
activa para siempre y bloquearía al usuario hasta para retirar su propio dinero.
No se reanudan: los sobres que faltaban nunca llegaron a pagar.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Cliente — `startPull` / `fetchPull`

**Files:**
- Modify: `src/onchain/gachaClient.ts`
- Test: `src/onchain/gachaPull.test.ts` (nuevo)

**Interfaces:**
- Produces:
  - `startPull(token: string, machineCode: string, count: number, turbo: boolean): Promise<{ pull_id: string }>`
  - `fetchPull(token: string, pullId: string): Promise<PullStatus>`
  - `interface PullStatus { id: string; status: 'running'|'done'|'aborted'; count: number; paid: number; done: number; turbo: boolean; results: PullResult[]; refunded_base_units: number; error: string | null }`
  - `interface PullResult { nft_address: string | null; name: string | null; insured_value: number | null; pending: false }`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/onchain/gachaPull.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { startPull, fetchPull } from './gachaClient'
import { config } from './config'

beforeEach(() => { vi.restoreAllMocks() })

describe('startPull', () => {
  it('hace POST a /gacha/pull con Bearer y el body del spec', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 202, json: async () => ({ pull_id: 'p1' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(startPull('TOKEN', 'pokemon_50', 3, true)).resolves.toEqual({ pull_id: 'p1' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${config.backendUrl}/gacha/pull`)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer TOKEN')
    expect(JSON.parse(init.body)).toEqual({ machine_code: 'pokemon_50', count: 3, turbo: true })
  })

  it('propaga el detalle del error del backend (p.ej. 402 sin saldo)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 402, json: async () => ({ detail: 'USDC disponible insuficiente' }),
    }))
    await expect(startPull('T', 'pokemon_50', 1, false))
      .rejects.toThrow('USDC disponible insuficiente')
  })
})

describe('fetchPull', () => {
  it('hace GET a /gacha/pull/{id} y devuelve el estado', async () => {
    const body = {
      id: 'p1', status: 'done', count: 2, paid: 2, done: 2, turbo: false,
      results: [{ nft_address: 'Mint1', name: 'Pika', insured_value: 12.5, pending: false }],
      refunded_base_units: 0, error: null,
    }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchPull('TOKEN', 'p1')).resolves.toEqual(body)
    expect(fetchMock.mock.calls[0][0]).toBe(`${config.backendUrl}/gacha/pull/p1`)
  })
})
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `npx vitest run src/onchain/gachaPull.test.ts`
Expected: FAIL — `startPull` no está exportado

- [ ] **Step 3: Implementar**

En `src/onchain/gachaClient.ts`, al final del fichero:

```ts
// ── Tiradas conducidas por el servidor ──────────────────────────────────────
// El navegador ya no orquesta el bucle: arranca la tirada y consulta el estado. Puede
// cerrarse: el worker del backend termina igual y el resultado queda persistido.

export interface PullResult {
  nft_address: string | null
  name: string | null
  insured_value: number | null
  pending: false
}

export interface PullStatus {
  id: string
  status: 'running' | 'done' | 'aborted'
  count: number
  paid: number
  done: number
  turbo: boolean
  results: PullResult[]
  refunded_base_units: number
  error: string | null
}

export function startPull(token: string, machineCode: string, count: number, turbo: boolean): Promise<{ pull_id: string }> {
  return gachaFetch<{ pull_id: string }>('/gacha/pull', {
    method: 'POST', headers: authHeaders(token),
    body: JSON.stringify({ machine_code: machineCode, count, turbo }),
  })
}

export function fetchPull(token: string, pullId: string): Promise<PullStatus> {
  return gachaFetch<PullStatus>(`/gacha/pull/${encodeURIComponent(pullId)}`, {
    headers: authHeaders(token),
  })
}
```

- [ ] **Step 4: Ejecutar y ver que pasan**

Run: `npx vitest run src/onchain/gachaPull.test.ts && npx tsc -b`
Expected: `3 passed`, tsc exit 0

- [ ] **Step 5: Commit**

```bash
git add src/onchain/gachaClient.ts src/onchain/gachaPull.test.ts
git commit -m "feat(gacha): cliente startPull/fetchPull

El navegador deja de orquestar el bucle: arranca la tirada y consulta estado.
Puede cerrarse, el worker termina igual y el resultado queda persistido.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `GachaVault` — arrancar y pollear

**Files:**
- Modify: `src/ui/screens/gacha/GachaVault.tsx` (imports; `handleYolo` líneas 171-218; render del gate)

**Interfaces:**
- Consumes: `startPull`, `fetchPull`, `PullStatus` (Task 8); `useDelegationGate`/`DelegationGate`; `getBalance` de `src/onchain/packBattleClient.ts` (`(token) => Promise<{reserved: number; locked_royale?: number}>`).

- [ ] **Step 1: Sustituir imports y añadir el gate**

En `src/ui/screens/gacha/GachaVault.tsx`:

- En el import de `../../../onchain/gachaClient`, quitar `generateYoloPacks` y añadir `startPull, fetchPull`.
- Quitar el import de tipo `YoloPacksResponse` si queda sin uso.
- Añadir:

```ts
import { useDelegationGate } from '../../components/useDelegationGate'
import { DelegationGate } from '../../components/DelegationGate'
import { getBalance } from '../../../onchain/packBattleClient'
```

Dentro del componente, junto a los demás hooks:

```ts
  const gate = useDelegationGate()
  const [reservedBase, setReservedBase] = useState(0)

  // El saldo mostrado es on-chain bruto; lo retenido por batallas/tiradas no es gastable.
  useEffect(() => {
    if (!identityToken) { setReservedBase(0); return }
    let cancelled = false
    getBalance(identityToken)
      .then((b) => { if (!cancelled) setReservedBase(b.reserved ?? 0) })
      .catch(() => { /* si falla, el backend sigue siendo quien protege */ })
    return () => { cancelled = true }
  }, [identityToken, phase.kind])
```

Y en el JSX, junto al resto de overlays (antes del cierre del contenedor que ya contiene `{confirm && selected && (`):

```tsx
        <DelegationGate gate={gate} />
```

- [ ] **Step 2: Reescribir `handleYolo`**

Sustituir por completo la función `handleYolo` (líneas 171-218) por:

```ts
  async function pollPull(pullId: string): Promise<void> {
    for (;;) {
      await new Promise((r) => setTimeout(r, 1000))
      let st: PullStatus
      try {
        st = await fetchPull(identityToken!, pullId)
      } catch {
        continue                       // fallo puntual de red: el worker sigue solo
      }
      setPhase({
        kind: 'yolo',
        step: st.paid < st.count ? 'enviando' : 'abriendo',
        done: st.done,
        total: st.count,
      })
      if (st.status === 'running') continue

      const results = st.results as unknown as YoloResult[]
      if (st.status === 'aborted') {
        const refunded = st.refunded_base_units / 1e6
        setOpenError(
          `Se abrieron ${st.paid} de ${st.count} sobres. Se te han devuelto $${refunded.toFixed(2)}.`,
        )
      }
      if (results.length === 0) { setPhase({ kind: 'machines' }); return }
      setPhase({ kind: 'yolo-reveal', results, index: 0 })
      return
    }
  }

  async function handleYolo(count: number, turbo: boolean) {
    if (!selected || !identityToken) return
    const total = (selected.price ?? 0) * count
    // Disponible = on-chain menos lo retenido. El backend valida igual: esto es solo UX.
    const available = usdc == null ? null : usdc - reservedBase / 1e6
    if (available != null && available < total) {
      setOpenError(`USDC disponible insuficiente — ${count} sobres cuestan $${total}.`)
      return
    }
    setOpenError(null)
    // La delegación ya se exigía hoy dentro de signTransactionBase64; al firmar el servidor,
    // nada en el navegador dispararía ese prompt, así que se pide por adelantado.
    gate.requireDelegation(async () => {
      let pullId: string
      try {
        setPhase({ kind: 'yolo', step: 'firmando', done: 0, total: count })
        const started = await startPull(identityToken, selected.code, count, turbo)
        pullId = started.pull_id
      } catch (e) {
        setOpenError(`No se pudo iniciar la tirada: ${e instanceof Error ? e.message : String(e)}.`)
        setPhase({ kind: 'machines' })
        return
      }
      await pollPull(pullId)
    })
  }
```

Añadir `PullStatus` al import de tipos desde `../../../onchain/gachaClient`.

- [ ] **Step 3: Verificar compilación y tests**

Run: `npx tsc -b && npx vitest run`
Expected: tsc exit 0; toda la suite en verde

- [ ] **Step 4: Commit**

```bash
git add src/ui/screens/gacha/GachaVault.tsx
git commit -m "feat(gacha): la vault arranca la tirada y consulta estado

handleYolo deja de orquestar firma/submit/poll sobre a sobre: arranca la tirada
y consulta el estado. Si el lote aborta se muestra el resumen parcial con lo
devuelto.

El check de saldo pasa a usar disponible = on-chain menos lo retenido (solo UX;
el backend valida igual), y la delegación se pide por adelantado porque al
firmar el servidor nada en el navegador dispararía ese prompt.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Eliminar `/gacha/yolo`

Va la última: hasta que el frontend no dejó de usarla (Task 9), borrarla rompería la app.

**Files:**
- Modify: `backend/app/main.py` (ruta `/gacha/yolo` y `class YoloBody`)
- Modify: `src/onchain/gachaClient.ts` (`generateYoloPacks`, `YoloTx`, `YoloPacksResponse`)
- Modify: `backend/tests/test_gacha_api.py` (borrar 4 tests, líneas ~354-400):
  `test_yolo_generates_and_stores_memos`, `test_yolo_count_bounds`,
  `test_yolo_requires_auth`, `test_yolo_open_pack_owns_memo`

`test_yolo_open_pack_owns_memo` comprueba que open-pack rechaza un memo ajeno. Se puede
borrar sin perder cobertura: `test_open_pack_memo_ajeno_403` (línea 99) ya cubre esa regla
por la vía de `generate-pack`.

- [ ] **Step 1: Comprobar que nadie la usa**

```bash
grep -rn "gacha/yolo\|generateYoloPacks" src backend --include='*.ts' --include='*.tsx' --include='*.py'
```
Expected: solo la definición de la ruta en `main.py`, la de `generateYoloPacks` en
`gachaClient.ts`, y los 4 tests listados arriba. Si aparece cualquier **otro** llamante
(sobre todo en `src/ui/`), **parar** y avisar: significa que Task 9 no lo migró.

- [ ] **Step 2: Borrar en backend**

En `backend/app/main.py`, eliminar la ruta completa `@app.post("/gacha/yolo")` con su función `gacha_yolo`, y la `class YoloBody`.

- [ ] **Step 3: Borrar en frontend**

En `src/onchain/gachaClient.ts`, eliminar `generateYoloPacks` y las interfaces `YoloTx` y `YoloPacksResponse` si quedan sin uso.

- [ ] **Step 4: Verificar**

Run: `cd backend && .venv/bin/python -m pytest -q` → toda la suite en verde
Run: `npx tsc -b && npx vitest run` → tsc exit 0, suite en verde

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py src/onchain/gachaClient.ts
git commit -m "chore(gacha): eliminar POST /gacha/yolo

Era el endpoint que originó este trabajo: no comprobaba saldo ni máquina
apagada en servidor. Ya sustituido por /gacha/pull, que valida antes de reservar.
Mantener dos caminos al dinero con uno abierto es peor que borrarlo.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Verificación final

```bash
cd backend && .venv/bin/python -m pytest -q      # toda la suite backend
cd .. && npx tsc -b && npx vitest run            # tipos + suite frontend
```

Prueba manual con los servicios levantados (`./scripts/run-net.sh devnet`):

1. Abrir 3 sobres y **cerrar la pestaña a mitad**. Volver a `/play/gacha` y consultar
   `GET /gacha/pull/{id}`: `status` debe acabar en `done` con los 3 resultados.
2. Intentar tirar con más sobres de los que da el saldo → 402 y mensaje de disponible.
3. Comprobar en el log que las tiradas ya no producen `429`.
