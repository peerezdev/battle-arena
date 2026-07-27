# Rev-share del rake para referidores — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el dueño de un código de referido cobre USDC real (25% del rake que generan sus referidos) mediante un ledger en BD y un botón de claim.

**Architecture:** El devengo se engancha dentro de `collect_battle_fee` (en su punto de éxito, dentro del guard de idempotencia `fee_charged`), de modo que hereda la protección contra settles repetidos y solo devenga sobre dinero realmente cobrado. Una función pura `accrue_rake_earnings` hace el reparto por jugador y escribe filas `ReferralEarning`. El claim agrega las filas sin pagar de un referidor, transfiere USDC desde la operator wallet y las marca con el `payout_id`.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 (`Mapped`/`mapped_column`) + SQLite, pytest; React 19 + TypeScript, vitest + @testing-library/react.

## Global Constraints

- Rev-share = **25% por defecto** (`ReferralCode.rake_share_pct` default `0.25`), configurable **por código**.
- Sale **del rake existente**: el jugador no paga más. No se modifica `fee_pct_total` ni el importe cobrado.
- **Atribución por jugador**: `per_player = charged // n_participants`; cada referidor cobra `floor(per_player * rake_share_pct)` por cada referido que jugó, gane o pierda.
- El devengo usa **`charged`** (lo realmente cobrado), nunca el fee teórico.
- Redondeo **siempre a la baja** (`//` y `int()` truncado); el polvo queda en plataforma.
- Se salta el devengo si: `referred_wallet == code.owner_wallet` (auto-referido), el código no tiene `owner_wallet`, o el importe es `<= 0`.
- Mínimo de claim: **$5** = `5_000_000` base units (`Settings.referral_claim_min_base_units`).
- Solo rake de **batallas** (pack + royale). No fee de retiro, no gacha.
- El claim paga **desde la operator wallet** (`privy_operator_wallet_id` / `privy_operator_address`).
- USDC = 6 decimales; todos los importes internos en **base units** (enteros).
- Money path: ninguna función nueva puede romper un settle. Los fallos se registran y se devuelven vacíos, nunca se propagan.
- El corte de puntos del referidor (`referrer_pct`) sigue existiendo pero su default sigue en `0.0`; el boost del referido (`boost_pct`) no se toca.
- Comandos: backend desde `backend/` con `source .venv/bin/activate`; frontend desde la raíz con `npx vitest run` y `npx tsc -b` (NO `tsc --noEmit`, que no comprueba nada en este repo).
- Los mensajes de commit terminan con `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **NUNCA** `git add -A`: se stagean solo los ficheros de la tarea.

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `backend/app/models.py` (mod) | `ReferralCode.rake_share_pct`; tablas `ReferralEarning`, `ReferralPayout` |
| `backend/app/db.py` (mod) | Migración de la columna nueva vía `_ENSURE_COLUMNS` |
| `backend/app/config.py` (mod) | `referral_claim_min_base_units` |
| `backend/app/services/referral_earnings.py` (nuevo) | Devengo puro + consultas de resumen y de claim. Fichero aparte de `referrals.py`: aquél gestiona puntos/códigos, éste dinero |
| `backend/app/services/battle_fees.py` (mod) | Llamada al devengo en el punto de éxito |
| `backend/app/main.py` (mod) | `GET /users/me/referrer`, `POST /users/me/referrer/claim` |
| `backend/scripts/referrals.py` (mod) | Flag `--rake-share`; `list` con unclaimed/lifetime |
| `src/onchain/referrerClient.ts` (nuevo) | Cliente de los dos endpoints |
| `src/ui/screens/Profile/ReferrerPanel.tsx` (nuevo) | Tarjeta del referidor + botón Claim |
| `src/ui/screens/Profile/OverviewTab.tsx` (mod) | Monta el panel (solo perfil propio) |

Tests: `backend/tests/test_referral_earnings.py` (nuevo), `backend/tests/test_referrer_api.py` (nuevo), `src/ui/screens/Profile/ReferrerPanel.test.tsx` (nuevo).

---

### Task 1: Esquema — columna y tablas del ledger

**Files:**
- Modify: `backend/app/models.py` (clase `ReferralCode`, ~línea 37; añadir 2 clases al final del bloque de modelos)
- Modify: `backend/app/db.py:21` (lista `_ENSURE_COLUMNS`)
- Test: `backend/tests/test_referral_earnings.py` (crear)

**Interfaces:**
- Consumes: nada.
- Produces: `ReferralCode.rake_share_pct: float`; `ReferralEarning(id, code, referrer_wallet, referred_wallet, battle_id, amount_base_units, payout_id, created_at)`; `ReferralPayout(id, wallet, amount_base_units, signature, status, created_at)`.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/test_referral_earnings.py`:

```python
"""Rev-share del rake: esquema del ledger, devengo y consultas de claim."""
from app.models import ReferralCode, ReferralEarning, ReferralPayout


def test_referral_code_rake_share_default(Session):
    s = Session()
    rc = ReferralCode(code="IBAI", name="Ibai")
    s.add(rc); s.commit()
    assert s.get(ReferralCode, "IBAI").rake_share_pct == 0.25


def test_earning_and_payout_tables_exist(Session):
    s = Session()
    s.add(ReferralEarning(code="IBAI", referrer_wallet="W_OWNER", referred_wallet="W_REF",
                          battle_id="b1", amount_base_units=500_000))
    s.add(ReferralPayout(wallet="W_OWNER", amount_base_units=500_000, status="pending"))
    s.commit()
    e = s.query(ReferralEarning).one()
    assert e.payout_id is None and e.amount_base_units == 500_000
    p = s.query(ReferralPayout).one()
    assert p.status == "pending" and p.signature is None


def test_rake_share_column_migrates_on_existing_db():
    """Una BD con referral_codes SIN la columna debe ganarla al init (no hay framework de
    migraciones: _ENSURE_COLUMNS es el mecanismo)."""
    from sqlalchemy import create_engine, inspect, text
    from sqlalchemy.pool import StaticPool
    from app.db import init_db
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    with engine.begin() as c:
        c.execute(text("CREATE TABLE referral_codes (code VARCHAR PRIMARY KEY, name VARCHAR, "
                       "boost_pct FLOAT, referrer_pct FLOAT, owner_wallet VARCHAR, "
                       "earned INTEGER, created_at DATETIME)"))
    init_db(engine)
    assert "rake_share_pct" in {c["name"] for c in inspect(engine).get_columns("referral_codes")}
```

- [ ] **Step 2: Ejecutar para verificar que falla**

```bash
cd backend && source .venv/bin/activate
python -m pytest tests/test_referral_earnings.py -q
```

Expected: FAIL con `ImportError: cannot import name 'ReferralEarning' from 'app.models'`.

- [ ] **Step 3: Añadir la columna a `ReferralCode`**

En `backend/app/models.py`, dentro de `class ReferralCode`, después de la línea `referrer_pct`:

```python
    # Rev-share del rake de batallas que generan los referidos de este código. Es dinero real
    # (USDC), a diferencia de referrer_pct, que es puntos. Sale del rake existente: el jugador
    # paga lo mismo.
    rake_share_pct: Mapped[float] = mapped_column(Float, default=0.25)
```

- [ ] **Step 4: Añadir las tablas del ledger**

En `backend/app/models.py`, justo después de la clase `ReferralCode`:

```python
class ReferralEarning(Base):
    """Un devengo: lo que un referidor ganó por UN participante referido en UNA batalla.

    Una fila por (batalla, referido) hace la auditoría trivial: se puede reconstruir de dónde
    salió cada céntimo. `payout_id` nulo = pendiente de cobrar.
    """
    __tablename__ = "referral_earnings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String)
    referrer_wallet: Mapped[str] = mapped_column(String, index=True)
    referred_wallet: Mapped[str] = mapped_column(String)
    battle_id: Mapped[str] = mapped_column(String, index=True)
    amount_base_units: Mapped[int] = mapped_column(Integer)
    payout_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ReferralPayout(Base):
    """Un claim: el pago agregado de todas las earnings pendientes de un referidor."""
    __tablename__ = "referral_payouts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    wallet: Mapped[str] = mapped_column(String, index=True)
    amount_base_units: Mapped[int] = mapped_column(Integer)
    signature: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="pending")  # pending | sent | failed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
```

- [ ] **Step 5: Añadir la migración de la columna**

En `backend/app/db.py`, dentro de `_ENSURE_COLUMNS` (línea 21), añadir tras la entrada de `gacha_packs`:

```python
    ("referral_codes", "rake_share_pct", "FLOAT NOT NULL DEFAULT 0.25"),
```

- [ ] **Step 6: Ejecutar los tests**

```bash
cd backend && source .venv/bin/activate
python -m pytest tests/test_referral_earnings.py -q
```

Expected: 3 passed.

- [ ] **Step 7: Verificar que no se rompió nada**

```bash
cd backend && source .venv/bin/activate
python -m pytest -q
```

Expected: todos los tests existentes siguen pasando (433+ passed).

- [ ] **Step 8: Commit**

```bash
git add backend/app/models.py backend/app/db.py backend/tests/test_referral_earnings.py
git commit -m "$(cat <<'EOF'
feat(referrals): esquema del ledger de rev-share

rake_share_pct por código (default 25%) y las tablas referral_earnings /
referral_payouts. Una fila por (batalla, referido) hace la auditoría
trivial: se reconstruye de dónde salió cada céntimo.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Devengo puro — `accrue_rake_earnings`

**Files:**
- Create: `backend/app/services/referral_earnings.py`
- Test: `backend/tests/test_referral_earnings.py` (añadir al fichero de Task 1)

**Interfaces:**
- Consumes: `ReferralEarning`, `ReferralCode` (Task 1); `User.referred_by`, `BattlePlayer` (ya existen).
- Produces:
  `accrue_rake_earnings(session, battle_id: str, charged_base_units: int) -> list[ReferralEarning]`
  — NO hace commit (el llamador ya commitea); devuelve las filas creadas (vacía si no hay).

- [ ] **Step 1: Escribir los tests que fallan**

Añadir al final de `backend/tests/test_referral_earnings.py`:

```python
from app.models import BattlePlayer, PackBattle, User
from app.services.referral_earnings import accrue_rake_earnings


def _battle_with(session, bid, players):
    """Crea una batalla settled con `players` = lista de (wallet, código o None)."""
    session.add(PackBattle(id=bid, mode="pack", machine_code="m50", price=50_000_000,
                           max_players=len(players), status="settled"))
    for wallet, code in players:
        session.add(BattlePlayer(battle_id=bid, player_wallet=wallet))
        session.add(User(wallet=wallet, referred_by=code))
    session.commit()


def test_reparto_por_jugador_gane_o_pierda(Session):
    s = Session()
    s.add(ReferralCode(code="IBAI", name="Ibai", owner_wallet="W_IBAI", rake_share_pct=0.25))
    s.add(ReferralCode(code="MAURO", name="Mauro", owner_wallet="W_MAURO", rake_share_pct=0.25))
    s.commit()
    # 4 jugadores, fee cobrado $8 → parte por jugador $2 → 25% = $0.50 por referido
    _battle_with(s, "b1", [("ANA", "IBAI"), ("BRUNO", "IBAI"),
                           ("CARLA", "MAURO"), ("DAVID", None)])
    rows = accrue_rake_earnings(s, "b1", 8_000_000)
    s.commit()
    by_ref = {}
    for r in rows:
        by_ref[r.referrer_wallet] = by_ref.get(r.referrer_wallet, 0) + r.amount_base_units
    assert by_ref == {"W_IBAI": 1_000_000, "W_MAURO": 500_000}   # IBAI cobra por 2 referidos
    assert len(rows) == 3                                        # DAVID no genera fila


def test_redondeo_siempre_a_la_baja(Session):
    s = Session()
    s.add(ReferralCode(code="C", name="c", owner_wallet="W_OWNER", rake_share_pct=0.25))
    s.commit()
    _battle_with(s, "b2", [("A", "C"), ("B", None), ("D", None)])
    # 1_000_000 // 3 = 333_333 → *0.25 = 83_333.25 → 83_333 (el polvo queda en plataforma)
    rows = accrue_rake_earnings(s, "b2", 1_000_000)
    assert rows[0].amount_base_units == 83_333


def test_fee_parcial_devenga_proporcionalmente(Session):
    s = Session()
    s.add(ReferralCode(code="C", name="c", owner_wallet="W_OWNER", rake_share_pct=0.25))
    s.commit()
    _battle_with(s, "b3", [("A", "C"), ("B", None)])
    # El ganador solo cubrió $5 de los $8 teóricos → se devenga sobre $5
    rows = accrue_rake_earnings(s, "b3", 5_000_000)
    assert rows[0].amount_base_units == 625_000    # (5_000_000 // 2) * 0.25


def test_auto_referido_no_devenga(Session):
    """Me hago una segunda cuenta y me refiero a mí mismo: no puede pagar."""
    s = Session()
    s.add(ReferralCode(code="C", name="c", owner_wallet="ME", rake_share_pct=0.25))
    s.commit()
    _battle_with(s, "b4", [("ME", "C"), ("B", None)])
    assert accrue_rake_earnings(s, "b4", 8_000_000) == []


def test_codigo_sin_owner_no_devenga(Session):
    s = Session()
    s.add(ReferralCode(code="C", name="c", owner_wallet=None, rake_share_pct=0.25))
    s.commit()
    _battle_with(s, "b5", [("A", "C"), ("B", None)])
    assert accrue_rake_earnings(s, "b5", 8_000_000) == []


def test_sin_referidos_no_devenga(Session):
    s = Session()
    _battle_with(s, "b6", [("A", None), ("B", None)])
    assert accrue_rake_earnings(s, "b6", 8_000_000) == []


def test_fee_cero_no_devenga(Session):
    s = Session()
    s.add(ReferralCode(code="C", name="c", owner_wallet="W_OWNER", rake_share_pct=0.25))
    s.commit()
    _battle_with(s, "b7", [("A", "C"), ("B", None)])
    assert accrue_rake_earnings(s, "b7", 0) == []


def test_rake_share_por_codigo_se_respeta(Session):
    s = Session()
    s.add(ReferralCode(code="VIP", name="vip", owner_wallet="W_VIP", rake_share_pct=0.40))
    s.commit()
    _battle_with(s, "b8", [("A", "VIP"), ("B", None)])
    rows = accrue_rake_earnings(s, "b8", 8_000_000)
    assert rows[0].amount_base_units == 1_600_000   # (8M // 2) * 0.40
```

- [ ] **Step 2: Ejecutar para verificar que falla**

```bash
cd backend && source .venv/bin/activate
python -m pytest tests/test_referral_earnings.py -q
```

Expected: FAIL con `ModuleNotFoundError: No module named 'app.services.referral_earnings'`.

- [ ] **Step 3: Implementar el devengo**

Crear `backend/app/services/referral_earnings.py`:

```python
"""Rev-share del rake: dinero real (USDC) para el dueño de un código de referido.

Separado de `referrals.py` a propósito: aquél reparte puntos Gimmighoul, éste reparte
dinero. Mezclarlos haría que un cambio en la economía de puntos tocase el camino del dinero.

Atribución POR JUGADOR: el rake se cobra al ganador, pero su cuantía es por jugador
(0,5% × N, con tope). Así que el fee cobrado se divide en N partes iguales y el referidor
de cada participante referido cobra su corte de la parte de SU referido — gane o pierda.
Con atribución al ganador, un referido que juega mucho y gana poco no generaría nada, que
es justo lo contrario de lo que se quiere premiar.
"""
from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from ..models import BattlePlayer, ReferralCode, ReferralEarning, User

logger = logging.getLogger(__name__)


def accrue_rake_earnings(session: Session, battle_id: str,
                         charged_base_units: int) -> list[ReferralEarning]:
    """Devenga el rev-share de UNA batalla sobre el fee REALMENTE cobrado.

    No commitea: se llama dentro del commit del cobro del fee, para heredar su guard de
    idempotencia (`battle.fee_charged`) — un settle repetido no puede duplicar devengos.

    Devuelve las filas creadas (lista vacía si no había nada que devengar). Nunca lanza:
    esto vive en el camino del dinero y un fallo aquí no puede tumbar un settle.
    """
    try:
        if charged_base_units <= 0:
            return []
        wallets = [p.player_wallet for p in
                   session.query(BattlePlayer).filter_by(battle_id=battle_id).all()]
        if not wallets:
            return []
        per_player = charged_base_units // len(wallets)
        if per_player <= 0:
            return []

        rows: list[ReferralEarning] = []
        for wallet in wallets:
            user = session.get(User, wallet)
            if user is None or not user.referred_by:
                continue
            code = session.get(ReferralCode, user.referred_by)
            # Sin dueño no hay a quién pagar; auto-referido sería crear una segunda cuenta
            # para recuperar parte del propio rake.
            if code is None or not code.owner_wallet or code.owner_wallet == wallet:
                continue
            amount = int(per_player * code.rake_share_pct)   # trunca: el polvo queda en plataforma
            if amount <= 0:
                continue
            row = ReferralEarning(code=code.code, referrer_wallet=code.owner_wallet,
                                  referred_wallet=wallet, battle_id=battle_id,
                                  amount_base_units=amount)
            session.add(row)
            rows.append(row)
        return rows
    except Exception:
        logger.exception("rev-share: devengo falló en la batalla %s — se omite", battle_id)
        return []
```

- [ ] **Step 4: Ejecutar los tests**

```bash
cd backend && source .venv/bin/activate
python -m pytest tests/test_referral_earnings.py -q
```

Expected: 11 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/referral_earnings.py backend/tests/test_referral_earnings.py
git commit -m "$(cat <<'EOF'
feat(referrals): devengo del rev-share por jugador

accrue_rake_earnings reparte el fee COBRADO (no el teórico) entre los
jugadores y da a cada referidor su corte por cada referido que jugó, gane
o pierda: es jugar lo que genera rake, y premiar solo al ganador dejaría
sin cobrar a quien trae jugadores activos que pierden.

Redondeo a la baja, auto-referido y códigos sin dueño se saltan. No
commitea ni lanza: vive en el camino del dinero.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Enganche en el cobro del fee

**Files:**
- Modify: `backend/app/services/battle_fees.py` (bloque de persistencia tras la transferencia, ~líneas 108-118)
- Test: `backend/tests/test_referral_earnings.py` (añadir)

**Interfaces:**
- Consumes: `accrue_rake_earnings(session, battle_id, charged_base_units)` (Task 2).
- Produces: efecto lateral — tras un cobro con éxito hay filas `ReferralEarning` en la misma transacción que `battle.fee_charged = True`.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir al final de `backend/tests/test_referral_earnings.py`:

```python
from app.services.battle_fees import collect_battle_fee


class _Gacha:
    async def machines(self):
        return [{"code": "m50", "instantBuyback": 1.0}]


async def _noop(*a, **k):
    return None


def _fee_deps(balance=100_000_000):
    """Dependencias inyectadas de collect_battle_fee: todo falso, nada toca la red."""
    async def usdc_balance(_w):
        return balance
    async def build_tx(_a, _b, _amt):
        return "TX"
    async def submit(_signed):
        return "SIG"
    class _Signer:
        async def sign_solana(self, _wid, tx):
            return tx
    return dict(gacha=_Gacha(), signer=_Signer(), resolve_wallet_id=lambda w: f"wid-{w}",
                submit_tx=submit, usdc_balance=usdc_balance, build_usdc_transfer_tx=build_tx,
                sleep_fn=_noop)


async def test_cobrar_el_fee_devenga_rev_share(Session):
    from app.models import BattlePull
    s = Session()
    s.add(ReferralCode(code="C", name="c", owner_wallet="W_OWNER", rake_share_pct=0.25))
    s.commit()
    _battle_with(s, "bf", [("A", "C"), ("B", None)])
    b = s.get(PackBattle, "bf")
    # Base del fee: una carta auto-vendida por $400 → fee 1% (0.5% × 2) = $4
    s.add(BattlePull(battle_id="bf", player_wallet="A", memo="m", round_number=1,
                     nft_address="n1", insured_value=400.0, auto_sold=True,
                     buyback_amount=400_000_000))
    s.commit()

    charged = await collect_battle_fee(s, b, "A", 2, **_fee_deps())

    assert charged == 4_000_000 and b.fee_charged is True
    rows = s.query(ReferralEarning).filter_by(battle_id="bf").all()
    assert len(rows) == 1
    assert rows[0].amount_base_units == 500_000    # (4M // 2) * 0.25


async def test_settle_repetido_no_duplica_devengos(Session):
    """El guard fee_charged ya protege el cobro; el devengo hereda esa protección."""
    from app.models import BattlePull
    s = Session()
    s.add(ReferralCode(code="C", name="c", owner_wallet="W_OWNER", rake_share_pct=0.25))
    s.commit()
    _battle_with(s, "bf2", [("A", "C"), ("B", None)])
    b = s.get(PackBattle, "bf2")
    s.add(BattlePull(battle_id="bf2", player_wallet="A", memo="m", round_number=1,
                     nft_address="n1", insured_value=400.0, auto_sold=True,
                     buyback_amount=400_000_000))
    s.commit()

    await collect_battle_fee(s, b, "A", 2, **_fee_deps())
    await collect_battle_fee(s, b, "A", 2, **_fee_deps())   # segunda pasada

    assert s.query(ReferralEarning).filter_by(battle_id="bf2").count() == 1


async def test_sin_saldo_no_devenga(Session):
    """Fee no cobrado (ganador a cero) → no hay dinero que repartir."""
    from app.models import BattlePull
    s = Session()
    s.add(ReferralCode(code="C", name="c", owner_wallet="W_OWNER", rake_share_pct=0.25))
    s.commit()
    _battle_with(s, "bf3", [("A", "C"), ("B", None)])
    b = s.get(PackBattle, "bf3")
    s.add(BattlePull(battle_id="bf3", player_wallet="A", memo="m", round_number=1,
                     nft_address="n1", insured_value=400.0, auto_sold=True,
                     buyback_amount=400_000_000))
    s.commit()

    await collect_battle_fee(s, b, "A", 2, **_fee_deps(balance=0))

    assert s.query(ReferralEarning).filter_by(battle_id="bf3").count() == 0
```

- [ ] **Step 2: Ejecutar para verificar que falla**

```bash
cd backend && source .venv/bin/activate
python -m pytest tests/test_referral_earnings.py -q -k "devenga or duplica"
```

Expected: FAIL — `test_cobrar_el_fee_devenga_rev_share` da `len(rows) == 0` (aún no hay enganche).

- [ ] **Step 3: Enganchar el devengo**

En `backend/app/services/battle_fees.py`, en el bloque de persistencia tras la transferencia (el `try` que hace `battle.fee_charged = True`), añadir la llamada ANTES del `session.commit()`:

```python
            try:
                battle.fee_charged = True
                battle.fee_base_units = charged
                battle.fee_pct = pct
                # Rev-share de referidos DENTRO de este commit: así hereda el guard
                # fee_charged y un settle repetido no puede duplicar devengos. Nunca lanza.
                from app.services.referral_earnings import accrue_rake_earnings
                accrue_rake_earnings(session, battle.id, charged)
                session.commit()
            except Exception as exc:
```

- [ ] **Step 4: Ejecutar los tests**

```bash
cd backend && source .venv/bin/activate
python -m pytest tests/test_referral_earnings.py -q
```

Expected: 14 passed.

- [ ] **Step 5: Verificar que el camino del dinero sigue intacto**

```bash
cd backend && source .venv/bin/activate
python -m pytest tests/test_battle_fees.py tests/test_referrals.py -q
```

Expected: todos pasan (el fee cobrado y los puntos no cambian).

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/battle_fees.py backend/tests/test_referral_earnings.py
git commit -m "$(cat <<'EOF'
feat(referrals): devengar rev-share al cobrar el fee

La llamada va DENTRO del commit que marca fee_charged, así hereda su guard
de idempotencia: un settle repetido no duplica devengos. Y devenga sobre
`charged`, no sobre el fee teórico — si el ganador no cubría el fee, se
reparte solo lo que entró.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Consultas de resumen y claim

**Files:**
- Modify: `backend/app/services/referral_earnings.py`
- Modify: `backend/app/config.py` (añadir setting)
- Test: `backend/tests/test_referral_earnings.py` (añadir)

**Interfaces:**
- Consumes: `ReferralEarning`, `ReferralPayout`, `ReferralCode` (Task 1).
- Produces:
  - `referrer_summary(session, wallet) -> dict` con claves `codes` (lista de `{code, rake_share_pct, referred_count}`), `unclaimed_base_units`, `lifetime_base_units`.
  - `claim_earnings(session, wallet) -> tuple[ReferralPayout, list[int]]` — crea el payout `pending` y devuelve `(payout, earning_ids)`. NO paga: eso lo hace el endpoint.
  - `mark_payout_sent(session, payout, earning_ids, signature)` / `mark_payout_failed(session, payout)`.
  - `Settings.referral_claim_min_base_units: int = 5_000_000`.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir al final de `backend/tests/test_referral_earnings.py`:

```python
from app.config import Settings
from app.services.referral_earnings import (claim_earnings, mark_payout_failed,
                                            mark_payout_sent, referrer_summary)


def test_claim_min_default():
    assert Settings().referral_claim_min_base_units == 5_000_000   # $5


def test_summary_sin_codigos_devuelve_ceros(Session):
    s = Session()
    out = referrer_summary(s, "NADIE")
    assert out["codes"] == []
    assert out["unclaimed_base_units"] == 0 and out["lifetime_base_units"] == 0


def test_summary_cuenta_referidos_unclaimed_y_lifetime(Session):
    s = Session()
    s.add(ReferralCode(code="C", name="c", owner_wallet="W_OWNER", rake_share_pct=0.25))
    s.add_all([User(wallet="A", referred_by="C"), User(wallet="B", referred_by="C"),
               User(wallet="X", referred_by=None)])
    s.add(ReferralEarning(code="C", referrer_wallet="W_OWNER", referred_wallet="A",
                          battle_id="b1", amount_base_units=500_000))
    s.add(ReferralEarning(code="C", referrer_wallet="W_OWNER", referred_wallet="B",
                          battle_id="b1", amount_base_units=300_000, payout_id=7))
    s.commit()
    out = referrer_summary(s, "W_OWNER")
    assert out["codes"] == [{"code": "C", "rake_share_pct": 0.25, "referred_count": 2}]
    assert out["unclaimed_base_units"] == 500_000    # la de payout_id=7 ya se cobró
    assert out["lifetime_base_units"] == 800_000


def test_claim_agrega_lo_pendiente_y_deja_el_payout_en_pending(Session):
    s = Session()
    s.add_all([
        ReferralEarning(code="C", referrer_wallet="W", referred_wallet="A",
                        battle_id="b1", amount_base_units=500_000),
        ReferralEarning(code="C", referrer_wallet="W", referred_wallet="B",
                        battle_id="b2", amount_base_units=250_000),
        ReferralEarning(code="C", referrer_wallet="OTRO", referred_wallet="Z",
                        battle_id="b3", amount_base_units=999_000),
    ])
    s.commit()
    payout, ids = claim_earnings(s, "W")
    assert payout.amount_base_units == 750_000 and payout.status == "pending"
    assert len(ids) == 2                       # no arrastra las de OTRO
    # Hasta que no se marque como pagado, las earnings siguen sin payout_id
    assert s.query(ReferralEarning).filter_by(payout_id=None).count() == 3


def test_claim_sin_pendientes_devuelve_none(Session):
    s = Session()
    assert claim_earnings(s, "W") == (None, [])


def test_mark_sent_marca_earnings_y_firma(Session):
    s = Session()
    s.add(ReferralEarning(code="C", referrer_wallet="W", referred_wallet="A",
                          battle_id="b1", amount_base_units=500_000))
    s.commit()
    payout, ids = claim_earnings(s, "W")
    mark_payout_sent(s, payout, ids, "SIG123")
    assert payout.status == "sent" and payout.signature == "SIG123"
    assert s.query(ReferralEarning).one().payout_id == payout.id
    assert referrer_summary(s, "W")["unclaimed_base_units"] == 0


def test_mark_failed_deja_las_earnings_reclamables(Session):
    s = Session()
    s.add(ReferralEarning(code="C", referrer_wallet="W", referred_wallet="A",
                          battle_id="b1", amount_base_units=500_000))
    s.commit()
    payout, ids = claim_earnings(s, "W")
    mark_payout_failed(s, payout)
    assert payout.status == "failed"
    # El dinero no se pierde: se puede volver a reclamar
    assert referrer_summary(s, "W")["unclaimed_base_units"] == 500_000
```

- [ ] **Step 2: Ejecutar para verificar que falla**

```bash
cd backend && source .venv/bin/activate
python -m pytest tests/test_referral_earnings.py -q -k "summary or claim or mark or claim_min"
```

Expected: FAIL con `ImportError: cannot import name 'referrer_summary'`.

- [ ] **Step 3: Añadir el setting**

En `backend/app/config.py`, junto a los otros settings de fee (tras `battle_fee_pct_cap`, ~línea 36):

```python
    # Mínimo para que un referidor pueda reclamar su rev-share. Agrega el polvo de muchas
    # batallas en un solo pago: sin mínimo, cada claim costaría más en fees de red que el importe.
    referral_claim_min_base_units: int = 5_000_000  # $5; env: REFERRAL_CLAIM_MIN_BASE_UNITS
```

- [ ] **Step 4: Implementar las consultas**

Añadir al final de `backend/app/services/referral_earnings.py`:

```python
from typing import Optional

from sqlalchemy import func, select

from ..models import ReferralPayout


def referrer_summary(session: Session, wallet: str) -> dict:
    """Resumen para el panel del referidor. Devuelve ceros (no error) si no posee códigos."""
    codes = session.query(ReferralCode).filter_by(owner_wallet=wallet).all()
    code_rows = []
    for c in codes:
        referred = session.query(User).filter_by(referred_by=c.code).count()
        code_rows.append({"code": c.code, "rake_share_pct": c.rake_share_pct,
                          "referred_count": referred})

    def _sum(*conditions) -> int:
        return int(session.scalar(
            select(func.coalesce(func.sum(ReferralEarning.amount_base_units), 0))
            .where(ReferralEarning.referrer_wallet == wallet, *conditions)) or 0)

    return {
        "codes": code_rows,
        "unclaimed_base_units": _sum(ReferralEarning.payout_id.is_(None)),
        "lifetime_base_units": _sum(),
    }


def claim_earnings(session: Session, wallet: str) -> tuple[Optional[ReferralPayout], list[int]]:
    """Abre un claim: crea el payout 'pending' con el total pendiente y devuelve sus earning ids.

    NO marca las earnings todavía. Se marcan sólo cuando la transferencia confirma
    (mark_payout_sent), para que un pago fallido deje el dinero reclamable.
    """
    pending = session.query(ReferralEarning).filter(
        ReferralEarning.referrer_wallet == wallet,
        ReferralEarning.payout_id.is_(None)).all()
    if not pending:
        return None, []
    total = sum(e.amount_base_units for e in pending)
    payout = ReferralPayout(wallet=wallet, amount_base_units=total, status="pending")
    session.add(payout)
    session.flush()          # necesitamos payout.id
    return payout, [e.id for e in pending]


def mark_payout_sent(session: Session, payout: ReferralPayout, earning_ids: list[int],
                     signature: str) -> None:
    session.query(ReferralEarning).filter(ReferralEarning.id.in_(earning_ids)).update(
        {ReferralEarning.payout_id: payout.id}, synchronize_session=False)
    payout.status = "sent"
    payout.signature = signature
    session.commit()


def mark_payout_failed(session: Session, payout: ReferralPayout) -> None:
    """El pago no salió: las earnings siguen sin payout_id, así que se pueden volver a reclamar."""
    payout.status = "failed"
    session.commit()
```

- [ ] **Step 5: Ejecutar los tests**

```bash
cd backend && source .venv/bin/activate
python -m pytest tests/test_referral_earnings.py -q
```

Expected: 21 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/referral_earnings.py backend/app/config.py backend/tests/test_referral_earnings.py
git commit -m "$(cat <<'EOF'
feat(referrals): resumen y claim del rev-share

referrer_summary (códigos, referidos, unclaimed, lifetime) y el ciclo de
claim en tres pasos: abrir payout pending → pagar → marcar. Las earnings
sólo se marcan cuando la transferencia confirma, así un pago fallido deja
el dinero reclamable en vez de evaporarlo.

Mínimo de claim $5: sin él, cada cobro costaría más en fees de red que el
importe.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Endpoints del referidor

**Files:**
- Modify: `backend/app/main.py` (junto al endpoint `POST /users/{wallet}/referral`, ~línea 359)
- Test: `backend/tests/test_referrer_api.py` (crear)

**Interfaces:**
- Consumes: `referrer_summary`, `claim_earnings`, `mark_payout_sent`, `mark_payout_failed` (Task 4); `Settings.referral_claim_min_base_units`.
- Produces: `GET /users/me/referrer`, `POST /users/me/referrer/claim`.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `backend/tests/test_referrer_api.py`:

```python
"""Endpoints del panel del referidor: resumen y claim."""
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from app.chain.mock import MockChainSource
from app.db import init_db, make_session_factory
from app.main import create_app
from app.models import ReferralCode, ReferralEarning


def _client_and_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    init_db(engine)
    Session = make_session_factory(engine)
    app = create_app(Session, MockChainSource(), privy=None)
    return TestClient(app), Session


def test_endpoints_exigen_auth():
    c, _ = _client_and_session()
    assert c.get("/users/me/referrer").status_code in (401, 503)
    assert c.post("/users/me/referrer/claim").status_code in (401, 503)
```

- [ ] **Step 2: Ejecutar para verificar que falla**

```bash
cd backend && source .venv/bin/activate
python -m pytest tests/test_referrer_api.py -q
```

Expected: FAIL con 404 (los endpoints no existen todavía; el test espera 401/503).

- [ ] **Step 3: Implementar los endpoints**

En `backend/app/main.py`, justo después del endpoint `post_referral` (~línea 371), añadir:

```python
    # Un claim en vuelo por wallet: dos pulsaciones seguidas no pueden pagar dos veces.
    _claim_locks: set[str] = set()

    @app.get("/users/me/referrer")
    async def me_referrer(wallet: str = Depends(current_user), s: Session = Depends(db)):
        """Panel del referidor. Sin códigos en propiedad devuelve ceros, no 404: el frontend
        decide con esto si enseña el panel."""
        from .services.referral_earnings import referrer_summary
        out = referrer_summary(s, wallet)
        out["claim_min_base_units"] = get_settings().referral_claim_min_base_units
        return out

    @app.post("/users/me/referrer/claim")
    async def me_referrer_claim(wallet: str = Depends(current_user), s: Session = Depends(db)):
        """Paga el rev-share pendiente desde la operator wallet. El fee wallet es solo una
        dirección (no firmable), así que el pago sale del operador."""
        from .services.referral_earnings import (claim_earnings, mark_payout_failed,
                                                 mark_payout_sent, referrer_summary)
        settings = get_settings()
        pending = referrer_summary(s, wallet)["unclaimed_base_units"]
        if pending < settings.referral_claim_min_base_units:
            raise HTTPException(409, "below_minimum")
        if not (privy_operator_wallet_id and privy_operator_address):
            raise HTTPException(503, "payouts_unavailable")
        if wallet in _claim_locks:
            raise HTTPException(409, "claim_in_progress")
        _claim_locks.add(wallet)
        try:
            payout, earning_ids = claim_earnings(s, wallet)
            if payout is None:
                raise HTTPException(409, "nothing_to_claim")
            s.commit()
            try:
                bh = await fetch_latest_blockhash(solana_rpc_url)
                # withdraw_usdc ya crea el ATA destino de forma idempotente (el operador paga la
                # renta): un referidor puede no tener cuenta USDC todavía. El operador va como
                # origen Y como fee-payer; al ser el mismo firmante, la segunda firma es un no-op.
                sig = await withdraw_usdc(
                    solana_rpc_url, privy_signer,
                    privy_operator_wallet_id, privy_operator_address,   # origen del dinero
                    privy_operator_wallet_id, privy_operator_address,   # fee-payer
                    wallet, cc_usdc_mint, payout.amount_base_units, bh)
            except Exception as exc:
                mark_payout_failed(s, payout)
                logger.error("rev-share: claim de %s falló: %s", wallet, exc)
                raise HTTPException(502, "payout_failed")
            mark_payout_sent(s, payout, earning_ids, sig)
            return {"signature": sig, "amount_base_units": payout.amount_base_units}
        finally:
            _claim_locks.discard(wallet)
```

`withdraw_usdc` y `fetch_latest_blockhash` ya están importados en `main.py` (líneas 41 y 44); `privy_signer`, `solana_rpc_url`, `cc_usdc_mint`, `privy_operator_wallet_id` y `privy_operator_address` son parámetros de `create_app`, así que están en scope. No hace falta ningún import nuevo.

- [ ] **Step 4: Ejecutar el test**

```bash
cd backend && source .venv/bin/activate
python -m pytest tests/test_referrer_api.py -q
```

Expected: 1 passed.

- [ ] **Step 5: Verificar que la app arranca**

```bash
cd backend && source .venv/bin/activate
python -c "from app.main import create_app; print('import OK')"
```

Expected: `import OK`.

- [ ] **Step 6: Ejecutar toda la suite del backend**

```bash
cd backend && source .venv/bin/activate
python -m pytest -q
```

Expected: todos pasan.

- [ ] **Step 7: Commit**

```bash
git add backend/app/main.py backend/tests/test_referrer_api.py
git commit -m "$(cat <<'EOF'
feat(referrals): endpoints de panel y claim del referidor

GET /users/me/referrer devuelve ceros en vez de 404 sin códigos, para que
el frontend decida con una sola llamada si enseña el panel.

El claim paga desde la operator wallet: el fee wallet es solo una dirección
sin firma. Lock por wallet contra doble pago, y un fallo de transferencia
marca el payout failed dejando las earnings reclamables.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: CLI — crear códigos con rev-share y ver ganancias

**Files:**
- Modify: `backend/scripts/referrals.py`

**Interfaces:**
- Consumes: `create_referral_code` (existente), `referrer_summary` (Task 4), `ReferralCode.rake_share_pct` (Task 1).
- Produces: flag `--rake-share`; `list` muestra unclaimed/lifetime.

- [ ] **Step 1: Añadir el flag `--rake-share` al parser**

En `backend/scripts/referrals.py`, dentro de `main()`, junto a los otros argumentos de `add`
(tras la línea de `--referrer`):

```python
    pa.add_argument("--rake-share", type=float, default=0.25,
                    help="fracción del rake de sus referidos que cobra el dueño (0.25 = 25%%)")
```

- [ ] **Step 2: Guardar el valor al crear el código**

En `cmd_add`, sustituir el bloque de creación y su `print` por:

```python
        rc = create_referral_code(s, args.code, args.name, boost_pct=args.boost,
                                  referrer_pct=args.referrer, owner_wallet=args.owner)
        rc.rake_share_pct = args.rake_share   # create_referral_code no acepta el campo aún
        s.commit()
        print(f"added {args.code} (name={args.name!r} boost={args.boost} "
              f"rake_share={args.rake_share} owner={args.owner})")
        return 0
```

- [ ] **Step 3: Mostrar rev-share y ganancias en `list`**

En `cmd_list`, sustituir el bucle `for r in rows:` por:

```python
        from app.services.referral_earnings import referrer_summary
        for r in rows:
            line = (f"{r.code}\tname={r.name!r}\tboost={r.boost_pct}\t"
                    f"rake_share={r.rake_share_pct}\towner={r.owner_wallet}")
            if r.owner_wallet:
                sm = referrer_summary(s, r.owner_wallet)
                line += (f"\treferidos={sum(c['referred_count'] for c in sm['codes'])}"
                         f"\tunclaimed=${sm['unclaimed_base_units'] / 1e6:.2f}"
                         f"\tlifetime=${sm['lifetime_base_units'] / 1e6:.2f}")
            print(line)
```

- [ ] **Step 4: Verificar a mano contra la BD de dev**

```bash
cd backend && source .venv/bin/activate
PYTHONPATH=. python3 scripts/referrals.py add TESTCODE --name "Prueba" --boost 0.10 --rake-share 0.30 --owner 8QDBKx8P3pxkRhiqyXFtYcPPf2CM1F5NiE5A8yjkgtm6
PYTHONPATH=. python3 scripts/referrals.py list
```

Expected: el `list` muestra `TESTCODE` con `rake_share=0.30`, `referidos=0`, `unclaimed=$0.00`.

- [ ] **Step 5: Limpiar el código de prueba**

```bash
cd backend && python3 -c "
import sqlite3; c=sqlite3.connect('battlearena.db')
c.execute(\"DELETE FROM referral_codes WHERE code='TESTCODE'\"); c.commit()
print('borrado')"
```

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/referrals.py
git commit -m "$(cat <<'EOF'
feat(referrals): CLI con --rake-share y ganancias en list

Los códigos se siguen creando sólo por CLI (curados): con dinero real de
por medio, el auto-referido deja de ser gratis de prevenir y curar en la
puerta lo corta sin anti-fraude.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Cliente y panel del referidor (frontend)

**Files:**
- Create: `src/onchain/referrerClient.ts`
- Create: `src/ui/screens/Profile/ReferrerPanel.tsx`
- Create: `src/ui/screens/Profile/ReferrerPanel.test.tsx`
- Modify: `src/ui/screens/Profile/OverviewTab.tsx`

**Interfaces:**
- Consumes: `GET /users/me/referrer`, `POST /users/me/referrer/claim` (Task 5).
- Produces: `ReferrerPanel` (sin props; se auto-oculta si no hay códigos).

- [ ] **Step 1: Escribir el cliente**

Crear `src/onchain/referrerClient.ts`:

```typescript
// Cliente del panel de referidor (rev-share del rake). Mismo patrón que leaderboardClient.
import { config } from './config'

export interface ReferrerCode {
  code: string
  rake_share_pct: number
  referred_count: number
}

export interface ReferrerSummary {
  codes: ReferrerCode[]
  unclaimed_base_units: number
  lifetime_base_units: number
  claim_min_base_units: number
}

async function refFetch<T>(path: string, token: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${config.backendUrl}${path}`, {
    ...options,
    headers: {
      ...(options?.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${token}`,
      'ngrok-skip-browser-warning': 'true',
    },
  })
  if (!resp.ok) {
    let detail: string | undefined
    try { detail = (await resp.json())?.detail } catch { /* ignore */ }
    throw new Error(detail || `Referrer error ${resp.status}`)
  }
  return resp.json() as Promise<T>
}

export function fetchReferrerSummary(token: string): Promise<ReferrerSummary> {
  return refFetch<ReferrerSummary>('/users/me/referrer', token)
}

export function claimReferrerEarnings(
  token: string,
): Promise<{ signature: string; amount_base_units: number }> {
  return refFetch('/users/me/referrer/claim', token, { method: 'POST' })
}
```

- [ ] **Step 2: Escribir los tests que fallan**

Crear `src/ui/screens/Profile/ReferrerPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReferrerSummary } from '../../../onchain/referrerClient'

const mocks = vi.hoisted(() => ({ fetchSummary: vi.fn(), claim: vi.fn() }))
vi.mock('../../../onchain/referrerClient', () => ({
  fetchReferrerSummary: mocks.fetchSummary,
  claimReferrerEarnings: mocks.claim,
}))
vi.mock('@privy-io/react-auth', () => ({ useIdentityToken: () => ({ identityToken: 'tok' }) }))
const toast = vi.hoisted(() => vi.fn())
vi.mock('../../toast', () => ({ showToast: toast }))

import { ReferrerPanel } from './ReferrerPanel'

const summary = (over: Partial<ReferrerSummary> = {}): ReferrerSummary => ({
  codes: [{ code: 'IBAI', rake_share_pct: 0.25, referred_count: 12 }],
  unclaimed_base_units: 12_400_000,
  lifetime_base_units: 87_000_000,
  claim_min_base_units: 5_000_000,
  ...over,
})

beforeEach(() => { mocks.fetchSummary.mockReset(); mocks.claim.mockReset(); toast.mockReset() })

describe('ReferrerPanel', () => {
  it('no se muestra si el usuario no posee códigos', async () => {
    mocks.fetchSummary.mockResolvedValue(summary({ codes: [], unclaimed_base_units: 0, lifetime_base_units: 0 }))
    const { container } = render(<ReferrerPanel />)
    await waitFor(() => expect(mocks.fetchSummary).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('muestra referidos, pendiente y total histórico', async () => {
    mocks.fetchSummary.mockResolvedValue(summary())
    render(<ReferrerPanel />)
    expect(await screen.findByText('$12.4')).toBeTruthy()      // unclaimed
    expect(screen.getByText('12')).toBeTruthy()                // referidos
    expect(screen.getByText('$87')).toBeTruthy()               // lifetime
  })

  it('el botón Claim se deshabilita por debajo del mínimo', async () => {
    mocks.fetchSummary.mockResolvedValue(summary({ unclaimed_base_units: 2_000_000 }))
    render(<ReferrerPanel />)
    const btn = await screen.findByRole('button', { name: /claim/i })
    expect(btn).toHaveProperty('disabled', true)
    fireEvent.click(btn)
    expect(mocks.claim).not.toHaveBeenCalled()
  })

  it('un claim con éxito avisa y refresca el pendiente a cero', async () => {
    mocks.fetchSummary
      .mockResolvedValueOnce(summary())
      .mockResolvedValueOnce(summary({ unclaimed_base_units: 0 }))
    mocks.claim.mockResolvedValue({ signature: 'SIG', amount_base_units: 12_400_000 })
    render(<ReferrerPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /claim/i }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining('$12.4'), 'success'))
    await waitFor(() => expect(screen.getByText('$0')).toBeTruthy())
  })

  it('un claim fallido lo dice y no rompe el panel', async () => {
    mocks.fetchSummary.mockResolvedValue(summary())
    mocks.claim.mockRejectedValue(new Error('payout_failed'))
    render(<ReferrerPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /claim/i }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('payout_failed', 'error'))
    expect(screen.getByText('$12.4')).toBeTruthy()   // sigue reclamable
  })
})
```

- [ ] **Step 3: Ejecutar para verificar que falla**

```bash
npx vitest run src/ui/screens/Profile/ReferrerPanel.test.tsx
```

Expected: FAIL — no existe `./ReferrerPanel`.

- [ ] **Step 4: Implementar el panel**

Crear `src/ui/screens/Profile/ReferrerPanel.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS, formatUsd } from '../../theme'
import { showToast } from '../../toast'
import { claimReferrerEarnings, fetchReferrerSummary, type ReferrerSummary } from '../../../onchain/referrerClient'

/**
 * Rev-share del referidor: lo que han generado sus referidos y el botón para cobrarlo.
 * Se auto-oculta si el usuario no posee ningún código — la inmensa mayoría no lo hace, y el
 * endpoint devuelve ceros en vez de error precisamente para poder decidirlo con una llamada.
 */
export function ReferrerPanel() {
  const { identityToken } = useIdentityToken()
  const [data, setData] = useState<ReferrerSummary | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!identityToken) return
    try { setData(await fetchReferrerSummary(identityToken)) } catch { /* panel oculto */ }
  }, [identityToken])

  useEffect(() => { void load() }, [load])

  if (!data || data.codes.length === 0) return null

  const usd = (base: number) => formatUsd(base / 1e6)
  const canClaim = data.unclaimed_base_units >= data.claim_min_base_units
  const referred = data.codes.reduce((s, c) => s + c.referred_count, 0)

  async function onClaim() {
    if (!identityToken || !canClaim || busy) return
    setBusy(true)
    try {
      const r = await claimReferrerEarnings(identityToken)
      showToast(`Claimed ${usd(r.amount_base_units)}`, 'success')
      await load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const stat = (label: string, value: string, accent?: string) => (
    <div style={{ lineHeight: 1.2 }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: 9.5, letterSpacing: '.16em', color: COLORS.muted }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: accent ?? COLORS.text, marginTop: 3 }}>{value}</div>
    </div>
  )

  return (
    <section style={{
      borderRadius: 16, border: `1px solid ${COLORS.border}`, background: COLORS.panel,
      padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 26, flexWrap: 'wrap',
    }}>
      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.2em', color: COLORS.green }}>
          REFERRALS · {data.codes.map((c) => c.code).join(' · ')}
        </div>
        <div style={{ display: 'flex', gap: 26, marginTop: 12, flexWrap: 'wrap' }}>
          {stat('REFERRED', String(referred))}
          {stat('UNCLAIMED', usd(data.unclaimed_base_units), COLORS.green)}
          {stat('LIFETIME', usd(data.lifetime_base_units))}
        </div>
      </div>
      <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        <button
          onClick={() => void onClaim()}
          disabled={!canClaim || busy}
          style={{
            padding: '12px 24px', borderRadius: 12, border: 0,
            cursor: canClaim && !busy ? 'pointer' : 'default',
            fontFamily: FONTS.display, fontSize: 14, fontWeight: 800,
            color: canClaim && !busy ? '#06170f' : COLORS.muted,
            background: canClaim && !busy ? COLORS.green : COLORS.panel2,
          }}
        >
          {busy ? 'Claiming…' : 'Claim'}
        </button>
        {!canClaim && (
          <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: COLORS.muted }}>
            min {usd(data.claim_min_base_units)}
          </span>
        )}
      </div>
    </section>
  )
}
```

- [ ] **Step 5: Ejecutar los tests**

```bash
npx vitest run src/ui/screens/Profile/ReferrerPanel.test.tsx
```

Expected: 5 passed.

- [ ] **Step 6: Montar el panel en el perfil propio**

En `src/ui/screens/Profile/OverviewTab.tsx`, añadir el import y renderizarlo al principio del contenido, sólo si `isSelf`:

```tsx
import { ReferrerPanel } from './ReferrerPanel'
```

Y dentro del JSX devuelto, como primer hijo del contenedor:

```tsx
      {isSelf && <ReferrerPanel />}
```

- [ ] **Step 7: Typecheck y suite completa**

```bash
npx tsc -b
npx vitest run
```

Expected: `tsc -b` sin errores (salvo los preexistentes del WIP del usuario en `WaitingRoom.tsx`); vitest sin fallos nuevos.

- [ ] **Step 8: Commit**

```bash
git add src/onchain/referrerClient.ts src/ui/screens/Profile/ReferrerPanel.tsx src/ui/screens/Profile/ReferrerPanel.test.tsx src/ui/screens/Profile/OverviewTab.tsx
git commit -m "$(cat <<'EOF'
feat(referrals): panel de rev-share en el perfil

Referidos, pendiente y total histórico, con botón de Claim deshabilitado
bajo el mínimo. Se auto-oculta si el usuario no posee códigos: el endpoint
devuelve ceros en vez de 404 para decidirlo con una sola llamada.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verificación final

- [ ] **Backend completo**

```bash
cd backend && source .venv/bin/activate && python -m pytest -q
```

- [ ] **Frontend completo**

```bash
npx vitest run && npx tsc -b
```

- [ ] **Prueba manual de punta a punta (devnet)**

1. Crear un código con dueño: `PYTHONPATH=. python3 scripts/referrals.py add TEST --name T --rake-share 0.25 --owner <TU_WALLET>`
2. Con una segunda cuenta, aplicar el código desde Ranking.
3. Jugar una Pack Battle con esa cuenta hasta el settle.
4. `PYTHONPATH=. python3 scripts/referrals.py list` → `unclaimed` > 0.
5. Con la cuenta dueña del código, abrir Perfil → el panel aparece con el pendiente.

> El claim real necesita `unclaimed ≥ $5`, lo que en devnet exige varias batallas. Para probar el
> pago sin acumular, bajar temporalmente `REFERRAL_CLAIM_MIN_BASE_UNITS=1` en `backend/.env`.

## Notas de despliegue

Antes de mainnet hay que decidir de dónde sale el dinero de los claims: el rake aterriza en
`fee_wallet_address` (solo dirección, no firmable) pero los claims pagan desde la operator
wallet. Opciones: convertir el fee wallet en wallet Privy firmable, o mantener un float en el
operador y barrer el fee wallet periódicamente. En devnet basta con apuntar
`FEE_WALLET_ADDRESS` al operador.
