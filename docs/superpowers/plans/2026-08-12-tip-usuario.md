# Tip en USDC a otro jugador — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un jugador pueda enviar USDC a otro jugador registrado, desde su perfil y desde el chat.

**Architecture:** Un tip es, técnicamente, un withdraw cuyo destino es la wallet embebida de otro jugador, así que reutiliza `withdraw_usdc` tal cual: el emisor autoriza el movimiento de USDC y el operador paga la fee y la renta de la cuenta destino. No hay código nuevo on-chain. La defensa que impide que esto sea una puerta trasera para sacar fondos es que el destinatario **tiene que existir en `users`**, y la wallet de un usuario es siempre su embebida delegada.

**Tech Stack:** FastAPI + SQLAlchemy + pytest (backend); React + TypeScript + vitest + Testing Library (frontend).

Spec: `docs/superpowers/specs/2026-08-12-tip-usuario-design.md`.

## Global Constraints

- Los importes en USDC viajan como float en la API y se guardan y comparan **en unidades base** (enteros, 6 decimales): `int(round(amount * 1_000_000))`.
- No hay migraciones: `init_db` llama a `Base.metadata.create_all`, así que una tabla nueva se crea sola. Las **columnas** nuevas sobre tablas existentes sí necesitan `app/db.py`; aquí no aplica porque la tabla es nueva.
- Sin comisión de plataforma en el tip, y sin bloqueo por batalla en curso. Estas dos son decisiones del spec, no descuidos.
- Backend: se ejecuta desde `backend/` con `./.venv/bin/pytest`.
- Frontend: se ejecuta desde la raíz con `npx vitest run`.
- Los textos de error que ve el jugador se escriben en el frontend, no se reenvía el `detail` del backend. Es el patrón ya establecido en `WithdrawModal.tsx:82-89`.
- Nada de guiones largos (—) en los textos que ve el usuario.

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `backend/app/models.py` (modificar) | Tabla `tips` |
| `backend/app/config.py` (modificar) | `min_tip_usdc`, `tip_rate_limit`, `tip_rate_window_s` |
| `backend/app/main.py` (modificar) | Endpoint `POST /users/me/tip` + su throttle |
| `backend/tests/test_tip_api.py` (crear) | Todo el comportamiento del endpoint |
| `src/onchain/tipClient.ts` (crear) | `sendTip()`, traducción de errores HTTP a un tipo |
| `src/onchain/tipClient.test.ts` (crear) | Tests del cliente |
| `src/ui/components/TipModal.tsx` (crear) | El modal, compartido por las dos entradas |
| `src/ui/components/TipModal.test.tsx` (crear) | Tests del modal |
| `src/ui/screens/Profile/ProfilePage.tsx` (modificar) | Botón en el perfil ajeno |
| `src/ui/screens/Hub/…` chat (modificar) | Acción junto al nombre en el chat |

---

### Task 1: Tabla `tips` y ajustes de configuración

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/config.py:70` (junto a los ajustes de withdraw)
- Test: `backend/tests/test_models.py`

**Interfaces:**
- Produces: modelo `Tip` con campos `id, from_wallet, to_wallet, amount, signature, source, created_at`; ajustes `min_tip_usdc: float`, `tip_rate_limit: int`, `tip_rate_window_s: float`.

- [ ] **Step 1: Escribir el test que falla**

En `backend/tests/test_models.py`, al final del fichero:

```python
def test_tip_round_trip(Session):
    from app.models import Tip
    s = Session()
    s.add(Tip(from_wallet="WalletA", to_wallet="WalletB", amount=250_000,
              signature="sig-1", source="profile"))
    s.commit()
    row = s.query(Tip).one()
    assert row.amount == 250_000
    assert row.source == "profile"
    assert row.created_at is not None
```

- [ ] **Step 2: Ejecutar el test y comprobar que falla**

Run: `cd backend && ./.venv/bin/pytest tests/test_models.py::test_tip_round_trip -v`
Expected: FAIL con `ImportError: cannot import name 'Tip'`

- [ ] **Step 3: Añadir el modelo**

En `backend/app/models.py`, al final del fichero:

```python
class Tip(Base):
    """Propina en USDC de un jugador a otro.

    La transferencia vive en la cadena; esta fila es el historial: sin ella un tip solo existiría
    como una firma suelta, y no habría forma de enseñar las propinas recibidas en un perfil ni de
    investigar un abuso después. `source` se guarda porque lo primero que se querrá saber si hay
    que capar el spam es por dónde entra.
    """
    __tablename__ = "tips"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    from_wallet: Mapped[str] = mapped_column(String, index=True)
    to_wallet: Mapped[str] = mapped_column(String, index=True)
    amount: Mapped[int] = mapped_column(Integer)          # unidades base de USDC (6 decimales)
    signature: Mapped[str] = mapped_column(String)        # la prueba: la firma de la transacción
    source: Mapped[str] = mapped_column(String)           # "profile" | "chat"
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
```

- [ ] **Step 4: Ejecutar el test y comprobar que pasa**

Run: `cd backend && ./.venv/bin/pytest tests/test_models.py::test_tip_round_trip -v`
Expected: PASS

- [ ] **Step 5: Añadir los ajustes**

En `backend/app/config.py`, justo después del bloque de `min_withdraw_usdc` (línea 70 y siguientes):

```python
    # Tips entre jugadores. El mínimo existe por lo mismo que el del withdraw: si el destinatario
    # todavía no tiene cuenta de USDC, el operador paga su renta (~0.002 SOL), así que sin mínimo
    # se le drena a base de propinas minúsculas a jugadores nuevos. El rate-limit es contra el
    # spam social, sobre todo desde el chat.
    min_tip_usdc: float = 1.0             # propina mínima (USDC); env: MIN_TIP_USDC
    tip_rate_limit: int = 10              # nº máx. de tips por wallet y ventana
    tip_rate_window_s: float = 60.0       # ventana del rate-limit de tips (segundos)
```

- [ ] **Step 6: Comprobar que la suite entera sigue verde**

Run: `cd backend && ./.venv/bin/pytest -q`
Expected: todos los tests pasan (incluido `test_db_migration.py`, que comprueba que la base se construye)

- [ ] **Step 7: Commit**

```bash
git add backend/app/models.py backend/app/config.py backend/tests/test_models.py
git commit -m "feat(tip): tabla tips y ajustes de mínimo y rate-limit"
```

---

### Task 2: Endpoint `POST /users/me/tip`

**Files:**
- Modify: `backend/app/main.py` (junto a `me_withdraw`, sobre la línea 1280)
- Test: `backend/tests/test_tip_api.py` (crear)

**Interfaces:**
- Consumes: modelo `Tip` (Task 1); ajuste `min_tip_usdc` (Task 1); `withdraw_usdc` de `services/royale_funding.py:63`; `_require_available(wallet, amount, s)` de `main.py:1059`; `get_or_create_user` de `services/users.py:23`.
- Produces: `POST /users/me/tip` con cuerpo `{"to": str, "amount": float, "source": str}` y respuesta `{"signature": str, "amount": float, "to": str}`.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/test_tip_api.py`. Este fichero monta la app igual que `test_nft_withdraw_api.py`, del que se copian los helpers a propósito: cada test de API de este repo es autocontenido.

```python
import json
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from app.db import init_db, make_session_factory
from app.main import create_app
from app.models import Tip, User
from app.services.gacha import GachaService
from tests.test_chain_mock import MockChainSource

APP_ID = "testapp"
WALLET_A = "So1anaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1"
WALLET_ID_A = "wallet-id-aaa"
WALLET_B = "So1anaBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1"
DUMMY_RPC = "https://api.devnet.solana.com"
DUMMY_MINT = "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr"


def _solana_embedded_with_id(addr: str, wallet_id: str) -> dict:
    return {"type": "wallet", "chain_type": "solana", "connector_type": None,
            "wallet_client_type": "privy", "address": addr, "id": wallet_id}


def _auth_headers(priv, addr: str, wallet_id: str) -> dict:
    now = int(time.time())
    payload = {"aud": APP_ID, "iss": "privy.io", "sub": f"did:privy:{addr[:8]}",
               "iat": now, "exp": now + 3600,
               "linked_accounts": json.dumps([_solana_embedded_with_id(addr, wallet_id)])}
    token = jwt.encode(payload, priv, algorithm="ES256", headers={"kid": "test-kid", "alg": "ES256"})
    return {"Authorization": f"Bearer {token}"}


class FakeSigner:
    def __init__(self):
        self.signed: list[tuple[str, str]] = []

    async def sign_solana(self, wallet_id: str, tx: str) -> str:
        self.signed.append((wallet_id, tx))
        return f"signed::{tx}"


def _build_client(**overrides):
    from app.services.privy_auth import PrivyVerifier
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    init_db(engine)
    sf = make_session_factory(engine)
    priv = ec.generate_private_key(ec.SECP256R1())
    privy = PrivyVerifier(app_id=APP_ID, key_resolver=lambda kid: priv.public_key())
    kwargs = dict(gacha=GachaService(base_url="https://dev-gacha.example.com", api_key=""),
                  privy=privy, privy_signer=FakeSigner(), solana_rpc_url=DUMMY_RPC,
                  cc_usdc_mint=DUMMY_MINT, privy_operator_wallet_id="op-wallet-id",
                  privy_operator_address="So1anaOPERATOR1111111111111111111111111111",
                  min_tip_usdc=1.0)
    kwargs.update(overrides)
    app = create_app(sf, MockChainSource(), **kwargs)
    client = TestClient(app, raise_server_exceptions=True)
    client.session_factory = sf
    return client, priv


def _mock_money(monkeypatch, *, balance: int = 100_000_000):
    """Saldo on-chain alto y transferencia falsa: el tip no toca la red en los tests."""
    async def _bal(rpc_url, wallet, mint, *a, **k):
        return balance
    monkeypatch.setattr("app.main.usdc_balance_base_units", _bal)

    async def _bh(rpc_url):
        return "11111111111111111111111111111111"
    monkeypatch.setattr("app.main.fetch_latest_blockhash", _bh)

    sent = []

    async def _withdraw(rpc_url, signer, wid, addr, op_wid, op_addr, dest, mint, amount, bh):
        sent.append({"from": addr, "to": dest, "amount": amount})
        return "tx-signature-1"
    monkeypatch.setattr("app.main.withdraw_usdc", _withdraw)
    return sent


def _register(client, wallet: str):
    """Da de alta al jugador: el destinatario tiene que existir para poder recibir un tip."""
    from app.services.users import get_or_create_user
    s = client.session_factory()
    get_or_create_user(s, wallet, 1200)
    s.commit()
    s.close()


def test_tip_moves_usdc_and_records_the_row(monkeypatch):
    client, priv = _build_client()
    sent = _mock_money(monkeypatch)
    _register(client, WALLET_A)
    _register(client, WALLET_B)

    resp = client.post("/users/me/tip", json={"to": WALLET_B, "amount": 1.5, "source": "profile"},
                       headers=_auth_headers(priv, WALLET_A, WALLET_ID_A))

    assert resp.status_code == 200, resp.text
    assert resp.json()["signature"] == "tx-signature-1"
    # el dinero va de A a B, en unidades base
    assert sent == [{"from": WALLET_A, "to": WALLET_B, "amount": 1_500_000}]
    # y queda registrado
    s = client.session_factory()
    row = s.query(Tip).one()
    assert (row.from_wallet, row.to_wallet, row.amount) == (WALLET_A, WALLET_B, 1_500_000)
    assert row.signature == "tx-signature-1"
    assert row.source == "profile"
```

- [ ] **Step 2: Ejecutar el test y comprobar que falla**

Run: `cd backend && ./.venv/bin/pytest tests/test_tip_api.py::test_tip_moves_usdc_and_records_the_row -v`
Expected: FAIL con 404 (la ruta todavía no existe)

- [ ] **Step 3: Añadir el cuerpo de la petición**

En `backend/app/main.py`, junto a las otras clases de cuerpo (busca `class WithdrawBody`):

```python
class TipBody(BaseModel):
    to: str
    amount: float
    source: str = "profile"     # "profile" | "chat"; solo para el historial
```

- [ ] **Step 4: Añadir el parámetro de configuración a `create_app`**

En la firma de `create_app` (`backend/app/main.py:205`, junto a `min_withdraw_usdc`):

```python
               min_tip_usdc: float = 1.0,
```

Y en la llamada de `main.py:2071` que construye la app desde los ajustes, añadir:

```python
               min_tip_usdc=s.min_tip_usdc,
```

- [ ] **Step 5: Implementar el endpoint**

En `backend/app/main.py`, justo **después** de `me_withdraw` (que termina en la línea 1322):

```python
    @app.post("/users/me/tip")
    async def me_tip(body: TipBody, wallet: str = Depends(current_user),
                     wallet_id: str = Depends(current_user_id), s: Session = Depends(db)):
        """Propina en USDC de un jugador a OTRO JUGADOR.

        El destino tiene que ser un usuario registrado, y eso no es una comodidad: como
        `current_user` devuelve siempre la wallet embebida del token de Privy, exigir que el
        destinatario exista en `users` garantiza que el dinero aterriza en otra wallet delegada
        nuestra. Con destino libre, esto sería un `/users/me/withdraw` sin mínimo, sin comisión y
        sin throttle, o sea la puerta de atrás del withdraw.

        A diferencia del withdraw NO cobra comisión (el dinero sigue dentro de la plataforma y ya
        la pagará al salir) y NO se bloquea durante una batalla: basta con respetar el saldo
        reservado, y así se puede dar propina justo al terminar una partida, que es cuando apetece.
        """
        if privy_signer is None or not (privy_operator_wallet_id and privy_operator_address):
            raise HTTPException(503, "tips_unavailable")
        dest = (body.to or "").strip()
        if s.get(User, dest) is None:
            raise HTTPException(404, "that player does not have an account")
        if dest == wallet:
            raise HTTPException(422, "you cannot tip yourself")
        amount = int(round(body.amount * 1_000_000))    # USDC base units
        if amount <= 0:
            raise HTTPException(422, "amount must be > 0")
        min_base = int(round(min_tip_usdc * 1_000_000))
        if amount < min_base:
            raise HTTPException(422, f"the minimum tip is {min_tip_usdc} USDC")
        await _require_available(wallet, amount, s)     # saldo on-chain menos lo reservado
        blockhash = await fetch_latest_blockhash(solana_rpc_url)
        try:
            sig = await withdraw_usdc(solana_rpc_url, privy_signer, wallet_id, wallet,
                                      privy_operator_wallet_id, privy_operator_address,
                                      dest, cc_usdc_mint, amount, blockhash)
        except Exception as exc:
            raise HTTPException(502, f"tip failed: {exc}")
        # La fila se escribe DESPUÉS de la firma: si la transferencia falla no hay historial que
        # corregir, y si falla esta escritura el dinero ya se movió y la firma está en los logs,
        # que es el menos malo de los dos fallos posibles.
        source = body.source if body.source in ("profile", "chat") else "profile"
        s.add(Tip(from_wallet=wallet, to_wallet=dest, amount=amount, signature=sig, source=source))
        s.commit()
        return {"signature": sig, "amount": amount / 1_000_000, "to": dest}
```

Añade `Tip` al import de modelos que ya existe en la cabecera de `main.py` (busca la línea que importa `User`).

- [ ] **Step 6: Ejecutar el test y comprobar que pasa**

Run: `cd backend && ./.venv/bin/pytest tests/test_tip_api.py -v`
Expected: PASS

- [ ] **Step 7: Añadir los tests de las validaciones**

En `backend/tests/test_tip_api.py`:

```python
def test_tip_to_someone_without_an_account_is_rejected(monkeypatch):
    client, priv = _build_client()
    _mock_money(monkeypatch)
    _register(client, WALLET_A)      # B NO está registrado: es el agujero que cerramos
    resp = client.post("/users/me/tip", json={"to": WALLET_B, "amount": 1.5},
                       headers=_auth_headers(priv, WALLET_A, WALLET_ID_A))
    assert resp.status_code == 404
    s = client.session_factory()
    assert s.query(Tip).count() == 0


def test_tip_to_yourself_is_rejected(monkeypatch):
    client, priv = _build_client()
    _mock_money(monkeypatch)
    _register(client, WALLET_A)
    resp = client.post("/users/me/tip", json={"to": WALLET_A, "amount": 1.5},
                       headers=_auth_headers(priv, WALLET_A, WALLET_ID_A))
    assert resp.status_code == 422


def test_tip_below_the_minimum_is_rejected(monkeypatch):
    client, priv = _build_client()
    _mock_money(monkeypatch)
    _register(client, WALLET_A)
    _register(client, WALLET_B)
    resp = client.post("/users/me/tip", json={"to": WALLET_B, "amount": 0.05},
                       headers=_auth_headers(priv, WALLET_A, WALLET_ID_A))
    assert resp.status_code == 422
    assert "0.1" in resp.json()["detail"]


def test_tip_without_signer_is_unavailable(monkeypatch):
    client, priv = _build_client(privy_signer=None)
    _mock_money(monkeypatch)
    _register(client, WALLET_A)
    _register(client, WALLET_B)
    resp = client.post("/users/me/tip", json={"to": WALLET_B, "amount": 1.5},
                       headers=_auth_headers(priv, WALLET_A, WALLET_ID_A))
    assert resp.status_code == 503
```

- [ ] **Step 8: Ejecutar los tests**

Run: `cd backend && ./.venv/bin/pytest tests/test_tip_api.py -v`
Expected: los 5 pasan

- [ ] **Step 9: Commit**

```bash
git add backend/app/main.py backend/tests/test_tip_api.py
git commit -m "feat(tip): endpoint POST /users/me/tip solo a jugadores registrados"
```

---

### Task 3: Las dos defensas — saldo reservado y throttle

**Files:**
- Modify: `backend/app/main.py` (el endpoint de la Task 2 y el bloque de throttles sobre la línea 1206)
- Test: `backend/tests/test_tip_api.py`

**Interfaces:**
- Consumes: `POST /users/me/tip` (Task 2); ajustes `tip_rate_limit`, `tip_rate_window_s` (Task 1).
- Produces: 402 cuando el saldo está reservado por una batalla; 429 al pasarse del límite.

Este es el test que de verdad importa del plan entero: comprueba que un jugador no puede vaciar su wallet a mitad de partida convirtiendo en propinas el dinero que la batalla tiene comprometido.

- [ ] **Step 1: Escribir el test del saldo reservado**

En `backend/tests/test_tip_api.py`:

```python
def test_tip_cannot_spend_balance_reserved_by_a_battle(monkeypatch):
    """El saldo on-chain llega, pero está comprometido por una batalla en curso."""
    client, priv = _build_client()
    _mock_money(monkeypatch, balance=2_000_000)      # 2 USDC en la wallet
    _register(client, WALLET_A)
    _register(client, WALLET_B)
    monkeypatch.setattr("app.main.reserved_total", lambda s, w: 1_800_000)   # 1.8 comprometidos

    resp = client.post("/users/me/tip", json={"to": WALLET_B, "amount": 1.0},
                       headers=_auth_headers(priv, WALLET_A, WALLET_ID_A))

    assert resp.status_code == 402
    s = client.session_factory()
    assert s.query(Tip).count() == 0
```

- [ ] **Step 2: Ejecutar y comprobar que falla o pasa**

Run: `cd backend && ./.venv/bin/pytest tests/test_tip_api.py::test_tip_cannot_spend_balance_reserved_by_a_battle -v`
Expected: PASS ya, porque `_require_available` está en el endpoint desde la Task 2. Si falla, comprueba que el `monkeypatch` apunta al nombre que usa `_require_available` (`app.main.reserved_total`); ese es el fallo probable, no la lógica.

- [ ] **Step 3: Escribir el test del throttle**

```python
def test_tip_is_rate_limited(monkeypatch):
    client, priv = _build_client(tip_rate_limit=2, tip_rate_window_s=60.0)
    _mock_money(monkeypatch)
    _register(client, WALLET_A)
    _register(client, WALLET_B)
    headers = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    body = {"to": WALLET_B, "amount": 1.0}

    assert client.post("/users/me/tip", json=body, headers=headers).status_code == 200
    assert client.post("/users/me/tip", json=body, headers=headers).status_code == 200
    assert client.post("/users/me/tip", json=body, headers=headers).status_code == 429


def test_tip_throttle_does_not_block_withdrawals(monkeypatch):
    """Contadores separados: gastar los tips no puede dejarte sin poder retirar."""
    client, priv = _build_client(tip_rate_limit=1, tip_rate_window_s=60.0)
    _mock_money(monkeypatch)
    _register(client, WALLET_A)
    _register(client, WALLET_B)
    headers = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    assert client.post("/users/me/tip", json={"to": WALLET_B, "amount": 1.0},
                       headers=headers).status_code == 200
    assert client.post("/users/me/tip", json={"to": WALLET_B, "amount": 1.0},
                       headers=headers).status_code == 429
    # el withdraw sigue disponible: su throttle es otro
    resp = client.post("/users/me/withdraw",
                       json={"address": "So1anaDESTBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1", "amount": 1.5},
                       headers=headers)
    assert resp.status_code != 429
```

- [ ] **Step 4: Ejecutar y comprobar que fallan**

Run: `cd backend && ./.venv/bin/pytest tests/test_tip_api.py -k rate -v`
Expected: FAIL. `test_tip_is_rate_limited` da 200 en la tercera llamada, y `create_app` todavía no acepta `tip_rate_limit`.

- [ ] **Step 5: Añadir el throttle**

En la firma de `create_app`, junto a `min_tip_usdc`:

```python
               tip_rate_limit: int = 10,
               tip_rate_window_s: float = 60.0,
```

Y en la llamada de `main.py:2071`: `tip_rate_limit=s.tip_rate_limit, tip_rate_window_s=s.tip_rate_window_s,`.

Junto al bloque de `_withdraw_throttle` (sobre la línea 1206):

```python
    # Throttle de tips, con contadores PROPIOS. Compartirlos con el withdraw haría que dar
    # propinas dejara al jugador sin poder retirar, y son dos límites con motivos distintos: el
    # del withdraw protege la renta de ATA que paga el operador; este, del spam social.
    _tip_hits: dict[str, list[float]] = {}

    def _tip_throttle(wallet: str) -> None:
        now = _time.time()
        hits = [t for t in _tip_hits.get(wallet, []) if now - t < tip_rate_window_s]
        if len(hits) >= tip_rate_limit:
            raise HTTPException(429, "too many tips, try again later")
        hits.append(now)
        _tip_hits[wallet] = hits
```

Y en el endpoint `me_tip`, **después** de la validación del mínimo y **antes** de `_require_available`:

```python
        _tip_throttle(wallet)
```

- [ ] **Step 6: Ejecutar los tests**

Run: `cd backend && ./.venv/bin/pytest tests/test_tip_api.py -v`
Expected: los 8 pasan

- [ ] **Step 7: Comprobar que no se ha roto nada**

Run: `cd backend && ./.venv/bin/pytest -q`
Expected: toda la suite verde

- [ ] **Step 8: Commit**

```bash
git add backend/app/main.py backend/tests/test_tip_api.py
git commit -m "feat(tip): respeta el saldo reservado y limita la frecuencia"
```

---

### Task 4: Cliente del frontend

**Files:**
- Create: `src/onchain/tipClient.ts`
- Test: `src/onchain/tipClient.test.ts`

**Interfaces:**
- Consumes: `POST /users/me/tip` (Tasks 2 y 3); `config.backendUrl` de `src/onchain/config.ts`.
- Produces: `sendTip(token: string, to: string, amount: number, source?: 'profile' | 'chat'): Promise<TipResult>` y `TipError` con `kind: 'no_account' | 'insufficient' | 'too_many' | 'invalid' | 'unavailable' | 'failed'`.

El motivo del error se traduce **aquí**, a un tipo cerrado, para que el modal no ande mirando códigos HTTP y para poder testear los textos sin montar la red.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/onchain/tipClient.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { sendTip, TipError } from './tipClient'

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

afterEach(() => { vi.unstubAllGlobals() })

describe('sendTip', () => {
  it('devuelve la firma cuando el envío va bien', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { signature: 'sig-1', amount: 1.5, to: 'WalletB' }))
    const out = await sendTip('token', 'WalletB', 1.5, 'profile')
    expect(out.signature).toBe('sig-1')
    expect(out.amount).toBe(1.5)
  })

  it('manda el importe y el origen en el cuerpo', async () => {
    const f = mockFetch(200, { signature: 's', amount: 2, to: 'WalletB' })
    vi.stubGlobal('fetch', f)
    await sendTip('token', 'WalletB', 2, 'chat')
    const body = JSON.parse(f.mock.calls[0][1].body)
    expect(body).toEqual({ to: 'WalletB', amount: 2, source: 'chat' })
  })

  it.each([
    [404, 'no_account'],
    [402, 'insufficient'],
    [429, 'too_many'],
    [422, 'invalid'],
    [503, 'unavailable'],
    [502, 'failed'],
  ])('traduce el %i a %s', async (status, kind) => {
    vi.stubGlobal('fetch', mockFetch(status, { detail: 'lo que sea' }))
    await expect(sendTip('token', 'WalletB', 1.5)).rejects.toMatchObject({ kind })
  })

  it('el error es un TipError', async () => {
    vi.stubGlobal('fetch', mockFetch(404, {}))
    await expect(sendTip('token', 'WalletB', 1.5)).rejects.toBeInstanceOf(TipError)
  })
})
```

- [ ] **Step 2: Ejecutar los tests y comprobar que fallan**

Run: `npx vitest run src/onchain/tipClient.test.ts`
Expected: FAIL, no existe el módulo `./tipClient`

- [ ] **Step 3: Escribir el cliente**

Crear `src/onchain/tipClient.ts`:

```ts
// Cliente de las propinas entre jugadores. El destino es SIEMPRE otro jugador registrado: el
// backend lo exige, y es lo que impide que un tip sea un withdraw sin reglas.
import { config } from './config'

export type TipErrorKind =
  | 'no_account'    // 404: el destinatario no tiene cuenta
  | 'insufficient'  // 402: saldo disponible insuficiente (ya descontado lo reservado)
  | 'too_many'      // 429: demasiadas propinas seguidas
  | 'invalid'       // 422: importe bajo el mínimo, cero, o a uno mismo
  | 'unavailable'   // 503: firmante u operador no configurados
  | 'failed'        // cualquier otra cosa

export class TipError extends Error {
  constructor(public kind: TipErrorKind) { super(kind) }
}

export interface TipResult {
  signature: string
  amount: number
  to: string
}

const BY_STATUS: Record<number, TipErrorKind> = {
  404: 'no_account', 402: 'insufficient', 429: 'too_many',
  422: 'invalid', 503: 'unavailable',
}

export async function sendTip(
  token: string,
  to: string,
  amount: number,
  source: 'profile' | 'chat' = 'profile',
): Promise<TipResult> {
  const resp = await fetch(`${config.backendUrl}/users/me/tip`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify({ to, amount, source }),
  })
  if (!resp.ok) throw new TipError(BY_STATUS[resp.status] ?? 'failed')
  return resp.json() as Promise<TipResult>
}
```

- [ ] **Step 4: Ejecutar los tests y comprobar que pasan**

Run: `npx vitest run src/onchain/tipClient.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/onchain/tipClient.ts src/onchain/tipClient.test.ts
git commit -m "feat(tip): cliente sendTip con los motivos de error tipados"
```

---

### Task 5: El modal

**Files:**
- Create: `src/ui/components/TipModal.tsx`
- Test: `src/ui/components/TipModal.test.tsx`

**Interfaces:**
- Consumes: `sendTip`, `TipError` (Task 4); `useUsdcBalance`, `useReservedBalance`, `availableUsd` (los que usa `WithdrawModal.tsx:15-16`); `useDelegationGate` y `DelegationGate` (`WithdrawModal.tsx:18-19`); `useIdentityToken` de `@privy-io/react-auth`.
- Produces: `<TipModal open to={{ wallet, alias }} source onClose />`.

Lee `src/ui/components/WithdrawModal.tsx` entero antes de empezar: este modal es su hermano y debe parecerse en estructura, estilos y manejo del gate de delegación. La delegación es obligatoria, porque el backend firma la transferencia con la wallet del jugador.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/ui/components/TipModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TipModal } from './TipModal'
import { TipError } from '../../onchain/tipClient'

vi.mock('../../onchain/tipClient', async () => {
  const actual = await vi.importActual<typeof import('../../onchain/tipClient')>('../../onchain/tipClient')
  return { ...actual, sendTip: vi.fn() }
})
vi.mock('@privy-io/react-auth', () => ({ useIdentityToken: () => ({ identityToken: 'tok' }) }))
// OJO con las formas reales: useUsdcBalance devuelve { usdc, loading } (NO { balance }),
// useReservedBalance devuelve { reserved, locked }, y availableUsd(usdc, reserved) toma DOS
// argumentos y puede devolver null. Ver src/wallet/useUsdcBalance.ts:16 y useReservedBalance.ts:6,18.
vi.mock('../../wallet/useUsdcBalance', () => ({ useUsdcBalance: () => ({ usdc: 10, loading: false }) }))
vi.mock('../../wallet/useReservedBalance', () => ({
  useReservedBalance: () => ({ reserved: 0, locked: 0 }),
  availableUsd: (usdc: number | null) => usdc,
}))
vi.mock('./useDelegationGate', () => ({
  useDelegationGate: () => ({ requireDelegation: (fn: () => void) => fn(), state: null }),
}))
vi.mock('./DelegationGate', () => ({ DelegationGate: () => null }))

import { sendTip } from '../../onchain/tipClient'

const TO = { wallet: 'WalletB', alias: 'Rival' }

beforeEach(() => { vi.mocked(sendTip).mockReset() })

describe('TipModal', () => {
  it('envía el importe al destinatario', async () => {
    vi.mocked(sendTip).mockResolvedValue({ signature: 'sig', amount: 2, to: 'WalletB' })
    render(<TipModal open to={TO} source="profile" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /send tip/i }))
    await waitFor(() => expect(sendTip).toHaveBeenCalledWith('tok', 'WalletB', 2, 'profile'))
  })

  it('no deja enviar más de lo disponible y no llama al backend', async () => {
    render(<TipModal open to={TO} source="profile" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '99' } })
    fireEvent.click(screen.getByRole('button', { name: /send tip/i }))
    expect(await screen.findByText(/exceeds your available balance/i)).toBeTruthy()
    expect(sendTip).not.toHaveBeenCalled()
  })

  it('explica que el jugador no tiene cuenta', async () => {
    vi.mocked(sendTip).mockRejectedValue(new TipError('no_account'))
    render(<TipModal open to={TO} source="profile" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /send tip/i }))
    expect(await screen.findByText(/does not have an account yet/i)).toBeTruthy()
  })

  it('un segundo clic no manda un segundo tip', async () => {
    vi.mocked(sendTip).mockImplementation(() => new Promise(() => {}))   // nunca resuelve
    render(<TipModal open to={TO} source="profile" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '2' } })
    const btn = screen.getByRole('button', { name: /send tip/i })
    fireEvent.click(btn)
    fireEvent.click(btn)
    await waitFor(() => expect(sendTip).toHaveBeenCalledTimes(1))
  })
})
```

- [ ] **Step 2: Ejecutar los tests y comprobar que fallan**

Run: `npx vitest run src/ui/components/TipModal.test.tsx`
Expected: FAIL, no existe `./TipModal`

- [ ] **Step 3: Escribir el modal**

Crear `src/ui/components/TipModal.tsx`. Copia la estructura visual de `WithdrawModal.tsx` (contenedor, cabecera, campo, botones, estilos de `theme`) y cambia lo que sigue:

- No hay campo de dirección: el destinatario llega por props y se pinta como texto (`alias` si lo hay, si no la wallet abreviada).
- El botón dice "Send tip".
- El campo de importe lleva `aria-label="Amount"`.
- Validación antes de llamar: importe > 0 y no mayor que `availableUsd(...)`.
- `busy` bloquea el botón mientras vuela la petición.
- La llamada va dentro de `gate.requireDelegation(async () => { … })`, exactamente como `WithdrawModal.tsx:74`.
- Los textos de error, por motivo (escritos aquí, no reenviados del backend):

```ts
const MESSAGE: Record<TipErrorKind, string> = {
  no_account: 'That player does not have an account yet, so they cannot receive tips.',
  insufficient: 'Insufficient available balance.',
  too_many: 'Too many tips in a row. Try again in a minute.',
  invalid: 'Check the amount: there is a minimum, and you cannot tip yourself.',
  unavailable: 'Tips are unavailable right now. Try again later.',
  failed: 'The tip could not be sent. Please try again.',
}
```

Props:

```ts
interface TipModalProps {
  open: boolean
  to: { wallet: string; alias?: string | null }
  source: 'profile' | 'chat'
  onClose: () => void
}
```

Al terminar bien: `showToast` con el importe enviado (mismo patrón que el withdraw) y `onClose()`.

- [ ] **Step 4: Ejecutar los tests y comprobar que pasan**

Run: `npx vitest run src/ui/components/TipModal.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Comprobar que compila**

Run: `npx tsc -b`
Expected: sin errores

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/TipModal.tsx src/ui/components/TipModal.test.tsx
git commit -m "feat(tip): modal de propina, hermano del de retirada"
```

---

### Task 6: Entrada desde el perfil

**Files:**
- Modify: `src/ui/screens/Profile/ProfilePage.tsx`
- Test: `src/ui/screens/Profile/ProfilePage.test.tsx` (crear)

**Interfaces:**
- Consumes: `<TipModal>` (Task 5); `isSelf` (`ProfilePage.tsx:30`).

- [ ] **Step 1: Escribir el test que falla**

Crear `src/ui/screens/Profile/ProfilePage.test.tsx`. `ProfilePage` decide con `isSelf = !wallet || wallet === own` (línea 30), donde `wallet` sale de `useParams` y `own` de `useEmbeddedSolanaAddress`. Se mockean esos dos y las cuatro pestañas, que no pintan nada relevante aquí. El patrón de mocks es el de `OverviewTab.test.tsx`, en la misma carpeta:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const params: { wallet?: string } = {}
vi.mock('react-router-dom', () => ({
  useParams: () => params,
  useSearchParams: () => [new URLSearchParams(), () => {}],
}))
vi.mock('../../../wallet/embedded', () => ({ useEmbeddedSolanaAddress: () => 'WalletA' }))
vi.mock('../../../hooks/useProfile', () => ({ useProfile: () => ({ alias: null }) }))
vi.mock('../../../hooks/useUserStats', () => ({ useUserStats: () => ({ stats: null, loading: false }) }))
vi.mock('./OverviewTab', () => ({ OverviewTab: () => null }))
vi.mock('./InventoryTab', () => ({ InventoryTab: () => null }))
vi.mock('./HistoryTab', () => ({ HistoryTab: () => null }))
vi.mock('./SettingsTab', () => ({ SettingsTab: () => null }))
vi.mock('../../components/TipModal', () => ({ TipModal: () => null }))

import { ProfilePage } from './ProfilePage'

describe('ProfilePage', () => {
  it('ofrece dar propina en el perfil de otro', () => {
    params.wallet = 'WalletB'
    render(<ProfilePage />)
    expect(screen.getByRole('button', { name: /send tip/i })).toBeTruthy()
  })

  it('no ofrece dar propina en el perfil propio', () => {
    params.wallet = undefined
    render(<ProfilePage />)
    expect(screen.queryByRole('button', { name: /send tip/i })).toBeNull()
  })
})
```

Si `useProfile` o `useUserStats` devuelven otra forma, ajusta el mock a lo que devuelvan de verdad: míralos antes de dar el test por escrito.

- [ ] **Step 2: Ejecutar el test y comprobar que falla**

Run: `npx vitest run src/ui/screens/Profile/ProfilePage.test.tsx`
Expected: FAIL, no hay botón "Send tip"

- [ ] **Step 3: Añadir el botón y el modal**

En `ProfilePage.tsx`, con el estado `const [tipOpen, setTipOpen] = useState(false)`, renderiza el botón **solo cuando `!isSelf`** y monta:

```tsx
{!isSelf && wallet && (
  <TipModal open={tipOpen} to={{ wallet, alias: stats?.alias }} source="profile"
            onClose={() => setTipOpen(false)} />
)}
```

- [ ] **Step 4: Ejecutar el test y comprobar que pasa**

Run: `npx vitest run src/ui/screens/Profile/ProfilePage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/Profile/ProfilePage.tsx src/ui/screens/Profile/ProfilePage.test.tsx
git commit -m "feat(tip): dar propina desde el perfil de otro jugador"
```

---

### Task 7: Entrada desde el chat

**Files:**
- Modify: `src/ui/screens/Hub/ChatDock.tsx` (el componente `Autor`, líneas 18-26)
- Test: `src/ui/screens/Hub/ChatDock.test.tsx` (ya existe)

**Interfaces:**
- Consumes: `<TipModal>` (Task 5); el tipo `ChatLine`, que ya trae `wallet` (`main.py:1926` la envía).

- [ ] **Step 1: Leer el componente `Autor`**

Está en `ChatDock.tsx:18-26` y ya resuelve el caso difícil: **solo enlaza si el mensaje trae wallet**, porque los avisos de la casa y los mensajes anteriores a esa columna no la tienen. La propina hereda esa misma condición: sin wallet no hay a quién dar propina.

Fíjate también en su comentario sobre el aspecto: el nombre ya va coloreado por usuario y no se subraya solo a unos pocos. La acción de propina no debe romper eso.

- [ ] **Step 2: Escribir el test que falla**

```tsx
it('ofrece dar propina a quien habla, pero no a los avisos de la casa', () => {
  renderChat([
    { user: 'Rival', wallet: 'WalletB', text: 'hola', ts: 1 },
    { user: 'House', wallet: null, text: 'aviso', ts: 2, kind: 'system' },
  ])
  expect(screen.getAllByRole('button', { name: /tip/i })).toHaveLength(1)
})

it('no ofrece dar propina a uno mismo', () => {
  renderChat([{ user: 'Yo', wallet: 'WalletA', text: 'hola', ts: 1 }], { ownWallet: 'WalletA' })
  expect(screen.queryByRole('button', { name: /tip/i })).toBeNull()
})
```

- [ ] **Step 3: Ejecutar y comprobar que falla**

Run: `npx vitest run src/ui/screens/Hub/ChatDock.test.tsx`
Expected: FAIL

- [ ] **Step 4: Añadir la acción**

En `Autor`, junto al nombre, y **solo** si `msg.wallet` existe y no es la wallet propia (la del jugador, con `useEmbeddedSolanaAddress()` de `src/wallet/embedded.ts`). Abre el mismo `TipModal` con `source="chat"`. El estado del modal vive en `ChatDock`, no dentro de `Autor`: un modal por lista, no uno por mensaje.

- [ ] **Step 5: Ejecutar y comprobar que pasa**

Run: `npx vitest run src/ui/screens/Hub/ChatDock.test.tsx`
Expected: PASS

- [ ] **Step 6: La suite entera y el compilador**

Run: `npx vitest run && npx tsc -b && npx eslint .`
Expected: todo verde

- [ ] **Step 7: Commit**

```bash
git add src/ui/screens/Hub
git commit -m "feat(tip): dar propina desde el chat"
```

---

### Task 8: Documentación

**Files:**
- Modify: `backend/README.md` (la lista de endpoints)
- Modify: `docs/superpowers/specs/2026-08-12-tip-usuario-design.md` (cabecera `Status`)

- [ ] **Step 1: Documentar el endpoint**

En `backend/README.md`, donde estén listados los endpoints de usuario, añade `POST /users/me/tip` con una línea: propina en USDC a otro jugador registrado; mínimo `MIN_TIP_USDC`, limitada por `TIP_RATE_LIMIT` por ventana, respeta el saldo reservado y no cobra comisión.

- [ ] **Step 2: Marcar el spec como implementado**

Cambia `Status: approved-pending-review` por `Status: implemented`.

- [ ] **Step 3: Última pasada completa**

Run: `cd backend && ./.venv/bin/pytest -q && cd .. && npx vitest run && npx tsc -b`
Expected: todo verde

- [ ] **Step 4: Commit**

```bash
git add backend/README.md docs/superpowers/specs/2026-08-12-tip-usuario-design.md
git commit -m "docs(tip): endpoint documentado y spec marcado como implementado"
```
