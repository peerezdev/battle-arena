# Gacha de Collector Crypt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Abrir packs del Gacha de Collector Crypt desde BattleArena (devnet): comprar → firmar → reveal → batir la carta sacada, con la `x-api-key` solo en el backend.

**Architecture:** El backend FastAPI gana un módulo proxy `gacha` (4 endpoints) que reenvía a `dev-gacha.collectorcrypt.com` con la API key server-side, con binding memo↔wallet en SQLite. El frontend añade `gachaClient.ts` y una `GachaScreen` en el flujo on-chain; la carta sacada navega al lobby existente (oráculo/Anchor/SDK sin cambios).

**Tech Stack:** FastAPI + httpx + SQLAlchemy 2.0 + pytest/respx (backend); React + TS + framer-motion + Reown AppKit (frontend).

**Spec:** `docs/superpowers/specs/2026-06-10-gacha-integration-design.md`

**Contexto clave para el implementador:**
- Backend: app factory en `backend/app/main.py:create_app(session_factory, chain, auth, ...)`; endpoints son closures dentro de `create_app` con `Depends(db)` / `Depends(current_wallet)`. Tests usan `TestClient` + sqlite in-memory (`backend/tests/test_api.py:_client`).
- API Gacha upstream (docs.collectorcrypt.com/gacha/api): header `x-api-key` obligatorio; `POST /api/generatePack {playerAddress, packType}` → `{memo, transaction}`; `POST /api/submitTransaction {signedTransaction}` → `{success, signature, confirmationStatus}`; `POST /api/openPack {memo}` → `{success, transactionSignature, nft_address, nftWon, rarity}` o `{code:"WAITING_FOR_WEBHOOK"}`; `GET /api/machines` → array de máquinas.
- Frontend on-chain: navegación por estado en `src/App.tsx` (`type OnchainScreen = 'connect'|'collection'|'lobby'|'battle'`, pantallas lazy). Wallet en `src/wallet/useWallet.ts` (AppKit `SolanaProvider`). El lobby recibe `SelectedCard {mint, attestation}` de `CollectionScreen`; la GachaScreen NO atesta — tras el pull manda al usuario a Colección (la carta ya está en su wallet y el flujo existente la atesta).
- Comandos: backend `cd backend && python3 -m pytest -q`; frontend `npx vitest run`, `npx tsc --noEmit`, `npm run build` (raíz del repo).

---

### Task 1: Backend — config + modelo `GachaPack`

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/app/models.py`
- Modify: `backend/requirements.txt`
- Test: `backend/tests/test_gacha.py` (nuevo)

- [ ] **Step 1: Añadir respx a requirements e instalar**

En `backend/requirements.txt` añadir al final:
```
respx==0.21.1
```
Run: `cd backend && pip install respx==0.21.1`

- [ ] **Step 2: Test que falla — settings y modelo**

Crear `backend/tests/test_gacha.py`:
```python
import pytest
from app.config import Settings
from app.models import GachaPack


def test_settings_gacha_defaults():
    s = Settings(_env_file=None)
    assert s.gacha_base_url == "https://dev-gacha.collectorcrypt.com"
    assert s.gacha_api_key == ""


def test_gacha_pack_model(Session):
    s = Session()
    p = GachaPack(memo="slug-abc-123", wallet="W" * 43, pack_type="pokemon_50")
    s.add(p)
    s.commit()
    row = s.get(GachaPack, "slug-abc-123")
    assert row.wallet == "W" * 43
    assert row.opened_at is None and row.nft_address is None
    s.close()
```

- [ ] **Step 3: Verificar que falla**

Run: `cd backend && python3 -m pytest tests/test_gacha.py -q`
Expected: FAIL — `ImportError: cannot import name 'GachaPack'`

- [ ] **Step 4: Implementar**

En `backend/app/config.py`, dentro de `Settings` añadir:
```python
    gacha_base_url: str = "https://dev-gacha.collectorcrypt.com"
    gacha_api_key: str = ""  # vacío => módulo gacha deshabilitado
```

En `backend/app/models.py` añadir al final:
```python
class GachaPack(Base):
    __tablename__ = "gacha_packs"
    memo: Mapped[str] = mapped_column(String, primary_key=True)
    wallet: Mapped[str] = mapped_column(String, index=True)
    pack_type: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    opened_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    nft_address: Mapped[Optional[str]] = mapped_column(String, nullable=True)
```

- [ ] **Step 5: Verificar que pasa + suite entera**

Run: `cd backend && python3 -m pytest -q`
Expected: todo verde.

- [ ] **Step 6: Commit**

```bash
git add backend/requirements.txt backend/app/config.py backend/app/models.py backend/tests/test_gacha.py
git commit -m "feat(backend): config y modelo GachaPack para la integración del Gacha"
```

---

### Task 2: Backend — `GachaService` (cliente upstream)

**Files:**
- Create: `backend/app/services/gacha.py`
- Test: `backend/tests/test_gacha.py` (extender)

- [ ] **Step 1: Tests que fallan — cliente con respx**

Añadir a `backend/tests/test_gacha.py`:
```python
import respx
from httpx import Response
from app.services.gacha import GachaService, GachaDisabled, GachaUpstreamError

BASE = "https://dev-gacha.collectorcrypt.com"
MACHINE = {
    "code": "pokemon_50", "name": "Pokemon 50", "price": 50,
    "odds": {"epic": 1, "rare": 9, "uncommon": 30, "common": 60},
    "stock": {"epic": 2, "rare": 10, "uncommon": 40, "common": 100},
    "ev": 42.5, "image": "https://x/img.png",
    "tierRanges": {}, "instantBuyback": True, "extra_ignored": "x",
}


def _svc(now=None):
    return GachaService(base_url=BASE, api_key="k123", now_fn=now or (lambda: 1000.0))


@pytest.mark.asyncio
async def test_disabled_without_key():
    svc = GachaService(base_url=BASE, api_key="")
    with pytest.raises(GachaDisabled):
        await svc.machines()


@respx.mock
@pytest.mark.asyncio
async def test_machines_maps_and_caches():
    route = respx.get(f"{BASE}/api/machines").mock(return_value=Response(200, json=[MACHINE]))
    svc = _svc()
    out = await svc.machines()
    assert out == [{
        "code": "pokemon_50", "name": "Pokemon 50", "price": 50,
        "odds": MACHINE["odds"], "stock": MACHINE["stock"], "ev": 42.5,
        "image": "https://x/img.png",
    }]
    # whitelist: campos extra del upstream no se reenvían
    assert "tierRanges" not in out[0]
    await svc.machines()
    assert route.call_count == 1  # cache 60s


@respx.mock
@pytest.mark.asyncio
async def test_machines_cache_expira():
    route = respx.get(f"{BASE}/api/machines").mock(return_value=Response(200, json=[MACHINE]))
    t = {"v": 1000.0}
    svc = _svc(now=lambda: t["v"])
    await svc.machines(); t["v"] = 1061.0; await svc.machines()
    assert route.call_count == 2


@respx.mock
@pytest.mark.asyncio
async def test_generate_pack_sends_api_key_and_player():
    route = respx.post(f"{BASE}/api/generatePack").mock(
        return_value=Response(200, json={"memo": "slug-uuid-1", "transaction": "dGVzdA=="}))
    out = await _svc().generate_pack(player_address="W" * 43, pack_type="pokemon_50")
    assert out == {"memo": "slug-uuid-1", "transaction": "dGVzdA=="}
    req = route.calls[0].request
    assert req.headers["x-api-key"] == "k123"
    import json as _json
    body = _json.loads(req.content)
    assert body == {"playerAddress": "W" * 43, "packType": "pokemon_50"}


@respx.mock
@pytest.mark.asyncio
async def test_upstream_error_becomes_gacha_upstream_error():
    respx.post(f"{BASE}/api/generatePack").mock(return_value=Response(500, text="boom interno"))
    with pytest.raises(GachaUpstreamError):
        await _svc().generate_pack(player_address="W" * 43, pack_type="pokemon_50")


@respx.mock
@pytest.mark.asyncio
async def test_open_pack_pending_passthrough():
    respx.post(f"{BASE}/api/openPack").mock(
        return_value=Response(200, json={"code": "WAITING_FOR_WEBHOOK"}))
    out = await _svc().open_pack(memo="slug-uuid-1")
    assert out == {"pending": True}


@respx.mock
@pytest.mark.asyncio
async def test_open_pack_success_whitelists_fields():
    payload = {"success": True, "transactionSignature": "sig", "nft_address": "Mint" + "1" * 40,
               "nftWon": {"content": {"metadata": {"name": "Charizard"}},
                          "image": "https://x/c.png", "secret": "no"},
               "points": 10, "roll": 4242, "rarity": "Epic"}
    respx.post(f"{BASE}/api/openPack").mock(return_value=Response(200, json=payload))
    out = await _svc().open_pack(memo="slug-uuid-1")
    assert out == {"pending": False, "nft_address": payload["nft_address"],
                   "rarity": "Epic", "name": "Charizard", "image": "https://x/c.png"}


@respx.mock
@pytest.mark.asyncio
async def test_submit_tx():
    route = respx.post(f"{BASE}/api/submitTransaction").mock(
        return_value=Response(200, json={"success": True, "signature": "s1",
                                         "confirmationStatus": "confirmed"}))
    out = await _svc().submit_tx(signed_transaction="dGVzdA==")
    assert out == {"signature": "s1", "confirmation_status": "confirmed"}
    import json as _json
    assert _json.loads(route.calls[0].request.content) == {"signedTransaction": "dGVzdA=="}
```

Nota: `pytest-asyncio` ya está en requirements; si los tests `async` se saltan, añadir `asyncio_mode = auto` en `backend/pytest.ini` (sección `[pytest]`).

- [ ] **Step 2: Verificar que falla**

Run: `cd backend && python3 -m pytest tests/test_gacha.py -q`
Expected: FAIL — `ModuleNotFoundError: app.services.gacha`

- [ ] **Step 3: Implementar `backend/app/services/gacha.py`**

```python
"""Proxy fino hacia la API del Gacha de Collector Crypt.

La x-api-key vive SOLO aquí (server-side). Las respuestas upstream nunca se
reenvían crudas: cada método devuelve un dict con whitelist de campos.
"""
from __future__ import annotations

import time
from typing import Any, Callable, Optional

import httpx


class GachaDisabled(Exception):
    """No hay gacha_api_key configurada."""


class GachaUpstreamError(Exception):
    """La API del Gacha falló (4xx/5xx/timeout/JSON inválido)."""


_MACHINE_FIELDS = ("code", "name", "price", "odds", "stock", "ev", "image")
_CACHE_TTL = 60.0


class GachaService:
    def __init__(self, base_url: str, api_key: str,
                 now_fn: Callable[[], float] = time.time, timeout: float = 15.0):
        self._base = base_url.rstrip("/")
        self._key = api_key
        self._now = now_fn
        self._timeout = timeout
        self._machines_cache: Optional[tuple[float, list[dict]]] = None

    @property
    def enabled(self) -> bool:
        return bool(self._key)

    def _check_enabled(self) -> None:
        if not self.enabled:
            raise GachaDisabled()

    async def _request(self, method: str, path: str, json: Optional[dict] = None) -> Any:
        self._check_enabled()
        url = f"{self._base}{path}"
        headers = {"x-api-key": self._key, "accept": "application/json"}
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            try:
                resp = await client.request(method, url, json=json, headers=headers)
                resp.raise_for_status()
                return resp.json()
            except (httpx.HTTPError, ValueError) as e:
                # Nunca propagar el cuerpo upstream: solo la clase de error.
                raise GachaUpstreamError(f"gacha upstream: {type(e).__name__}")

    async def machines(self) -> list[dict]:
        self._check_enabled()
        now = self._now()
        if self._machines_cache and now - self._machines_cache[0] < _CACHE_TTL:
            return self._machines_cache[1]
        raw = await self._request("GET", "/api/machines")
        items = raw if isinstance(raw, list) else []
        out = [{k: m.get(k) for k in _MACHINE_FIELDS} for m in items if isinstance(m, dict)]
        self._machines_cache = (now, out)
        return out

    async def generate_pack(self, player_address: str, pack_type: str) -> dict:
        raw = await self._request("POST", "/api/generatePack",
                                  json={"playerAddress": player_address, "packType": pack_type})
        return {"memo": raw.get("memo"), "transaction": raw.get("transaction")}

    async def submit_tx(self, signed_transaction: str) -> dict:
        raw = await self._request("POST", "/api/submitTransaction",
                                  json={"signedTransaction": signed_transaction})
        return {"signature": raw.get("signature"),
                "confirmation_status": raw.get("confirmationStatus")}

    async def open_pack(self, memo: str) -> dict:
        raw = await self._request("POST", "/api/openPack", json={"memo": memo})
        if raw.get("code") == "WAITING_FOR_WEBHOOK":
            return {"pending": True}
        nft_won = raw.get("nftWon") or {}
        metadata = ((nft_won.get("content") or {}).get("metadata") or {})
        return {
            "pending": False,
            "nft_address": raw.get("nft_address"),
            "rarity": raw.get("rarity"),
            "name": metadata.get("name"),
            "image": nft_won.get("image"),
        }
```

- [ ] **Step 4: Verificar que pasa + suite entera**

Run: `cd backend && python3 -m pytest -q`
Expected: todo verde.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/gacha.py backend/tests/test_gacha.py backend/pytest.ini
git commit -m "feat(backend): GachaService — cliente proxy del Gacha de CC con whitelist y caché"
```

---

### Task 3: Backend — endpoints `/gacha/*` con binding memo↔wallet y rate limit

**Files:**
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_gacha_api.py` (nuevo)

- [ ] **Step 1: Tests que fallan — capa HTTP**

Crear `backend/tests/test_gacha_api.py` (mismo patrón que `test_api.py`):
```python
import json

import based58
import pytest
import respx
from fastapi.testclient import TestClient
from httpx import Response
from nacl.signing import SigningKey
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from app.main import create_app
from app.db import make_session_factory, init_db
from app.auth import AuthService, auth_message
from app.chain.mock import MockChainSource
from app.services.gacha import GachaService

BASE = "https://dev-gacha.collectorcrypt.com"


def _client(api_key="k123", rate_limit=10):
    engine = create_engine("sqlite:///:memory:",
                           connect_args={"check_same_thread": False}, poolclass=StaticPool)
    init_db(engine)
    sf = make_session_factory(engine)
    auth = AuthService(now_fn=lambda: 1000, ttl=3600)
    gacha = GachaService(base_url=BASE, api_key=api_key)
    app = create_app(sf, MockChainSource(), auth, elo_start=1200, elo_k=32,
                     gacha=gacha, gacha_rate_limit=rate_limit)
    return TestClient(app), auth


def _login(c, auth):
    key = SigningKey.generate()
    wallet = based58.b58encode(bytes(key.verify_key)).decode()
    nonce = c.get(f"/auth/nonce?wallet={wallet}").json()["nonce"]
    sig = key.sign(auth_message(wallet, nonce)).signature.hex()
    token = c.post("/auth/verify", json={"wallet": wallet, "signature_hex": sig}).json()["token"]
    return wallet, {"Authorization": f"Bearer {token}"}


def test_machines_publico_y_503_sin_key():
    c, _ = _client(api_key="")
    r = c.get("/gacha/machines")
    assert r.status_code == 503
    assert r.json()["detail"] == "gacha_disabled"


@respx.mock
def test_machines_ok():
    respx.get(f"{BASE}/api/machines").mock(return_value=Response(200, json=[
        {"code": "pokemon_50", "name": "P50", "price": 50, "odds": {}, "stock": {},
         "ev": 1.0, "image": None}]))
    c, _ = _client()
    r = c.get("/gacha/machines")
    assert r.status_code == 200
    assert r.json()[0]["code"] == "pokemon_50"


def test_generate_pack_requiere_auth():
    c, _ = _client()
    assert c.post("/gacha/generate-pack", json={"pack_type": "pokemon_50"}).status_code == 401


@respx.mock
def test_generate_pack_fija_player_y_guarda_memo():
    route = respx.post(f"{BASE}/api/generatePack").mock(
        return_value=Response(200, json={"memo": "slug-m1", "transaction": "dA=="}))
    c, auth = _client()
    wallet, hdrs = _login(c, auth)
    r = c.post("/gacha/generate-pack", json={"pack_type": "pokemon_50"}, headers=hdrs)
    assert r.status_code == 200
    assert r.json() == {"memo": "slug-m1", "transaction": "dA=="}
    # playerAddress = wallet autenticada, ignore lo que diga el cliente
    assert json.loads(route.calls[0].request.content)["playerAddress"] == wallet


@respx.mock
def test_open_pack_memo_ajeno_403():
    respx.post(f"{BASE}/api/generatePack").mock(
        return_value=Response(200, json={"memo": "slug-m2", "transaction": "dA=="}))
    c, auth = _client()
    _, hdrs1 = _login(c, auth)
    c.post("/gacha/generate-pack", json={"pack_type": "pokemon_50"}, headers=hdrs1)
    _, hdrs2 = _login(c, auth)  # otra wallet
    r = c.post("/gacha/open-pack", json={"memo": "slug-m2"}, headers=hdrs2)
    assert r.status_code == 403


@respx.mock
def test_open_pack_ok_marca_abierto():
    respx.post(f"{BASE}/api/generatePack").mock(
        return_value=Response(200, json={"memo": "slug-m3", "transaction": "dA=="}))
    respx.post(f"{BASE}/api/openPack").mock(return_value=Response(200, json={
        "success": True, "nft_address": "Mint" + "1" * 40, "rarity": "Rare",
        "nftWon": {"content": {"metadata": {"name": "Pika"}}, "image": "https://x/p.png"}}))
    c, auth = _client()
    _, hdrs = _login(c, auth)
    c.post("/gacha/generate-pack", json={"pack_type": "pokemon_50"}, headers=hdrs)
    r = c.post("/gacha/open-pack", json={"memo": "slug-m3"}, headers=hdrs)
    assert r.status_code == 200
    assert r.json() == {"pending": False, "nft_address": "Mint" + "1" * 40,
                        "rarity": "Rare", "name": "Pika", "image": "https://x/p.png"}


@respx.mock
def test_open_pack_pendiente():
    respx.post(f"{BASE}/api/generatePack").mock(
        return_value=Response(200, json={"memo": "slug-m4", "transaction": "dA=="}))
    respx.post(f"{BASE}/api/openPack").mock(
        return_value=Response(200, json={"code": "WAITING_FOR_WEBHOOK"}))
    c, auth = _client()
    _, hdrs = _login(c, auth)
    c.post("/gacha/generate-pack", json={"pack_type": "pokemon_50"}, headers=hdrs)
    r = c.post("/gacha/open-pack", json={"memo": "slug-m4"}, headers=hdrs)
    assert r.status_code == 200
    assert r.json() == {"pending": True}


@respx.mock
def test_submit_tx_valida_base64_y_tamano():
    c, auth = _client()
    _, hdrs = _login(c, auth)
    assert c.post("/gacha/submit-tx", json={"signed_transaction": "no base64 !!"},
                  headers=hdrs).status_code == 422
    assert c.post("/gacha/submit-tx", json={"signed_transaction": "A" * 4000},
                  headers=hdrs).status_code == 422


@respx.mock
def test_upstream_caido_502():
    respx.get(f"{BASE}/api/machines").mock(return_value=Response(500, text="interno secreto"))
    c, _ = _client()
    r = c.get("/gacha/machines")
    assert r.status_code == 502
    assert "secreto" not in r.text


@respx.mock
def test_rate_limit_429():
    respx.post(f"{BASE}/api/generatePack").mock(
        return_value=Response(200, json={"memo": None, "transaction": None}))
    c, auth = _client(rate_limit=2)
    _, hdrs = _login(c, auth)
    codes = [c.post("/gacha/generate-pack", json={"pack_type": "pokemon_50"}, headers=hdrs).status_code
             for _ in range(3)]
    # las 2 primeras llegan al upstream (memo nulo → 502); la 3ª ni sale → 429
    assert codes[2] == 429
```

- [ ] **Step 2: Verificar que falla**

Run: `cd backend && python3 -m pytest tests/test_gacha_api.py -q`
Expected: FAIL — `create_app() got an unexpected keyword argument 'gacha'`

- [ ] **Step 3: Implementar en `backend/app/main.py`**

Imports nuevos:
```python
import base64
import time as _time
from datetime import datetime, timezone

from .services.gacha import GachaService, GachaDisabled, GachaUpstreamError
from .models import GachaPack
```

Bodies (junto a los BaseModel existentes):
```python
class GeneratePackBody(BaseModel):
    pack_type: str = Field(min_length=1, max_length=32, pattern=r"^[a-z0-9_]+$")


class SubmitTxBody(BaseModel):
    signed_transaction: str = Field(min_length=1, max_length=3000)

    @model_validator(mode="after")
    def check_base64(self) -> "SubmitTxBody":
        try:
            base64.b64decode(self.signed_transaction, validate=True)
        except Exception:
            raise ValueError("signed_transaction debe ser base64 válido")
        return self


class OpenPackBody(BaseModel):
    memo: str = Field(min_length=1, max_length=128)
```

Firma de `create_app` — añadir parámetros:
```python
def create_app(session_factory, chain: ChainSource, auth: AuthService,
               elo_start: int = 1200, elo_k: int = 32,
               cors_origins: list[str] | None = None,
               gacha: GachaService | None = None,
               gacha_rate_limit: int = 10) -> FastAPI:
```

Dentro de `create_app`, tras `current_wallet`:
```python
    # ── Gacha (proxy a Collector Crypt; la x-api-key vive solo aquí) ─────────
    _gacha_hits: dict[str, list[float]] = {}

    def _gacha_throttle(wallet: str) -> None:
        now = _time.time()
        hits = [t for t in _gacha_hits.get(wallet, []) if now - t < 60.0]
        if len(hits) >= gacha_rate_limit:
            raise HTTPException(429, "demasiadas peticiones al gacha")
        hits.append(now)
        _gacha_hits[wallet] = hits

    def _gacha_or_503() -> GachaService:
        if gacha is None or not gacha.enabled:
            raise HTTPException(503, "gacha_disabled")
        return gacha

    @app.get("/gacha/machines")
    async def gacha_machines():
        svc = _gacha_or_503()
        try:
            return await svc.machines()
        except GachaDisabled:
            raise HTTPException(503, "gacha_disabled")
        except GachaUpstreamError:
            raise HTTPException(502, "gacha upstream no disponible")

    @app.post("/gacha/generate-pack")
    async def gacha_generate(body: GeneratePackBody,
                             wallet: str = Depends(current_wallet),
                             s: Session = Depends(db)):
        svc = _gacha_or_503()
        _gacha_throttle(wallet)
        try:
            out = await svc.generate_pack(player_address=wallet, pack_type=body.pack_type)
        except GachaDisabled:
            raise HTTPException(503, "gacha_disabled")
        except GachaUpstreamError:
            raise HTTPException(502, "gacha upstream no disponible")
        if not out.get("memo"):
            raise HTTPException(502, "gacha upstream no disponible")
        s.add(GachaPack(memo=out["memo"], wallet=wallet, pack_type=body.pack_type))
        s.commit()
        return out

    @app.post("/gacha/submit-tx")
    async def gacha_submit(body: SubmitTxBody, wallet: str = Depends(current_wallet)):
        svc = _gacha_or_503()
        _gacha_throttle(wallet)
        try:
            return await svc.submit_tx(signed_transaction=body.signed_transaction)
        except GachaDisabled:
            raise HTTPException(503, "gacha_disabled")
        except GachaUpstreamError:
            raise HTTPException(502, "gacha upstream no disponible")

    @app.post("/gacha/open-pack")
    async def gacha_open(body: OpenPackBody,
                         wallet: str = Depends(current_wallet),
                         s: Session = Depends(db)):
        svc = _gacha_or_503()
        _gacha_throttle(wallet)
        pack = s.get(GachaPack, body.memo)
        if pack is None or pack.wallet != wallet:
            raise HTTPException(403, "memo no pertenece a esta wallet")
        try:
            out = await svc.open_pack(memo=body.memo)
        except GachaDisabled:
            raise HTTPException(503, "gacha_disabled")
        except GachaUpstreamError:
            raise HTTPException(502, "gacha upstream no disponible")
        if not out.get("pending") and out.get("nft_address"):
            pack.opened_at = datetime.now(timezone.utc)
            pack.nft_address = out["nft_address"]
            s.commit()
        return out
```

En `build_default_app()` añadir antes del `return`:
```python
    gacha = GachaService(base_url=s.gacha_base_url, api_key=s.gacha_api_key)
```
y pasar `gacha=gacha` a `create_app(...)`.

- [ ] **Step 4: Verificar que pasa + suite entera**

Run: `cd backend && python3 -m pytest -q`
Expected: todo verde (incluida la suite previa: 39+ tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py backend/tests/test_gacha_api.py
git commit -m "feat(backend): endpoints /gacha/* — proxy autenticado con binding memo↔wallet y rate limit"
```

---

### Task 4: Frontend — `useWallet.signTransactionBase64` + `gachaClient.ts`

**Files:**
- Modify: `src/wallet/useWallet.ts`
- Create: `src/onchain/gachaClient.ts`
- Test: `src/onchain/gachaClient.test.ts` (nuevo)

- [ ] **Step 1: Añadir `signTransactionBase64` a `useWallet`**

La tx del Gacha llega ya construida y parcialmente firmada (base64) — no se construye con instrucciones. En `src/wallet/useWallet.ts`:

A la interfaz `WalletApi` añadir:
```ts
  /** Sign a pre-built (partially signed) base64 transaction without sending. Returns the fully signed tx re-serialized as base64. */
  signTransactionBase64: (txBase64: string) => Promise<string>
```

Implementación (junto a `signAndSendTransaction`):
```ts
  async function signTransactionBase64(txBase64: string): Promise<string> {
    if (!isConnected || publicKey == null) {
      throw new Error('Wallet not connected')
    }
    if (walletProvider == null) {
      throw new Error('Solana wallet provider not available')
    }
    const tx = Transaction.from(Buffer.from(txBase64, 'base64'))
    const signed = await walletProvider.signTransaction(tx)
    return Buffer.from(signed.serialize()).toString('base64')
  }
```
Y añadirla al objeto retornado: `return { publicKey, isConnected, connect, signAndSendTransaction, signMessage, signTransactionBase64 }`.

Nota: `Buffer` ya está disponible (polyfill de Vite usado por web3.js); si `tsc` se queja, importar `import { Buffer } from 'buffer'`.

- [ ] **Step 2: Tests que fallan — gachaClient (lógica de polling extraída pura)**

Crear `src/onchain/gachaClient.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { pollOpenPack, type OpenPackResult } from './gachaClient'

describe('pollOpenPack', () => {
  it('devuelve el resultado en cuanto deja de estar pendiente', async () => {
    const attempts: OpenPackResult[] = [
      { pending: true },
      { pending: true },
      { pending: false, nft_address: 'M1', rarity: 'Rare', name: 'Pika', image: null },
    ]
    let i = 0
    const open = vi.fn(async () => attempts[i++])
    const result = await pollOpenPack(open, { maxAttempts: 5, delayMs: () => 0 })
    expect(result.pending).toBe(false)
    expect(open).toHaveBeenCalledTimes(3)
  })

  it('agota intentos y devuelve pending', async () => {
    const open = vi.fn(async (): Promise<OpenPackResult> => ({ pending: true }))
    const result = await pollOpenPack(open, { maxAttempts: 3, delayMs: () => 0 })
    expect(result.pending).toBe(true)
    expect(open).toHaveBeenCalledTimes(3)
  })

  it('backoff exponencial por defecto: 2s, 4s, 8s…', async () => {
    const { defaultDelayMs } = await import('./gachaClient')
    expect(defaultDelayMs(0)).toBe(2000)
    expect(defaultDelayMs(1)).toBe(4000)
    expect(defaultDelayMs(2)).toBe(8000)
    expect(defaultDelayMs(10)).toBe(30000) // cap 30s
  })
})
```

- [ ] **Step 3: Verificar que falla**

Run: `npx vitest run src/onchain/gachaClient.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 4: Implementar `src/onchain/gachaClient.ts`**

```ts
// Cliente fino del proxy /gacha/* del backend. La x-api-key vive en el
// backend; aquí solo viajan el token de sesión y datos públicos.
import { config } from './config'

export interface GachaMachine {
  code: string
  name: string
  price: number
  odds: Record<string, number>
  stock: Record<string, number>
  ev: number | null
  image: string | null
}

export interface GeneratePackResponse {
  memo: string
  transaction: string // base64, parcialmente firmada (50 USDC)
}

export interface SubmitTxResponse {
  signature: string
  confirmation_status: string
}

export type OpenPackResult =
  | { pending: true }
  | { pending: false; nft_address: string; rarity: string; name: string | null; image: string | null }

class GachaDisabledError extends Error {
  constructor() { super('gacha_disabled') }
}
export { GachaDisabledError }

async function gachaFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${config.backendUrl}${path}`, options)
  if (resp.status === 503) throw new GachaDisabledError()
  if (!resp.ok) throw new Error(`Gacha error ${resp.status}`)
  return resp.json() as Promise<T>
}

function authHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

export function fetchMachines(): Promise<GachaMachine[]> {
  return gachaFetch<GachaMachine[]>('/gacha/machines')
}

export function generatePack(token: string, packType: string): Promise<GeneratePackResponse> {
  return gachaFetch<GeneratePackResponse>('/gacha/generate-pack', {
    method: 'POST', headers: authHeaders(token),
    body: JSON.stringify({ pack_type: packType }),
  })
}

export function submitTx(token: string, signedTransaction: string): Promise<SubmitTxResponse> {
  return gachaFetch<SubmitTxResponse>('/gacha/submit-tx', {
    method: 'POST', headers: authHeaders(token),
    body: JSON.stringify({ signed_transaction: signedTransaction }),
  })
}

export function openPack(token: string, memo: string): Promise<OpenPackResult> {
  return gachaFetch<OpenPackResult>('/gacha/open-pack', {
    method: 'POST', headers: authHeaders(token),
    body: JSON.stringify({ memo }),
  })
}

// ── Polling (puro, testeable) ───────────────────────────────────────────────

export function defaultDelayMs(attempt: number): number {
  return Math.min(2000 * 2 ** attempt, 30000)
}

export async function pollOpenPack(
  open: () => Promise<OpenPackResult>,
  opts: { maxAttempts?: number; delayMs?: (attempt: number) => number } = {},
): Promise<OpenPackResult> {
  const maxAttempts = opts.maxAttempts ?? 8
  const delayMs = opts.delayMs ?? defaultDelayMs
  let last: OpenPackResult = { pending: true }
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    last = await open()
    if (!last.pending) return last
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs(attempt)))
    }
  }
  return last
}
```

- [ ] **Step 5: Verificar que pasa + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: todo verde.

- [ ] **Step 6: Commit**

```bash
git add src/wallet/useWallet.ts src/onchain/gachaClient.ts src/onchain/gachaClient.test.ts
git commit -m "feat(onchain): cliente del proxy gacha + firma de tx base64 prefirmada"
```

---

### Task 5: Frontend — `GachaScreen`

**Files:**
- Create: `src/ui/screens/onchain/GachaScreen.tsx`

Pantalla con tres estados internos: `'machines' | 'opening' | 'result'`. Sigue el estilo visual de las otras pantallas on-chain (COLORS/FONTS de `src/ui/theme`, paneles oscuros con borde `COLORS.border`, botones acento `COLORS.green`). Respeta `prefers-reduced-motion` con el hook ya usado en BattleBoard (`useReducedMotion` de framer-motion).

- [ ] **Step 1: Implementar `src/ui/screens/onchain/GachaScreen.tsx`**

```tsx
// Pantalla Gacha (modo on-chain): listar máquinas, comprar un pack,
// abrirlo con reveal animado por rareza y mandar al usuario a su colección
// para batir la carta. La atestación NO ocurre aquí: la hace el flujo
// existente de CollectionScreen cuando seleccione la carta nueva.
import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useWallet } from '../../../wallet/useWallet'
import {
  fetchMachines, generatePack, submitTx, openPack, pollOpenPack,
  GachaDisabledError, type GachaMachine, type OpenPackResult,
} from '../../../onchain/gachaClient'
import { COLORS, FONTS } from '../../theme'

interface Props {
  token: string
  /** Vuelve a la colección (con la carta nueva ya en la wallet). */
  onGoToCollection: () => void
  onBack: () => void
}

const RARITY_COLOR: Record<string, string> = {
  Epic: '#c084fc', Rare: '#5ad1ff', Uncommon: COLORS.green, Common: COLORS.muted,
}

type Phase =
  | { kind: 'machines' }
  | { kind: 'opening'; step: 'firmando' | 'enviando' | 'abriendo' }
  | { kind: 'result'; result: Extract<OpenPackResult, { pending: false }> }
  | { kind: 'pending'; memo: string }

export function GachaScreen({ token, onGoToCollection, onBack }: Props) {
  const reduced = useReducedMotion() ?? false
  const { signTransactionBase64 } = useWallet()
  const [machines, setMachines] = useState<GachaMachine[] | null>(null)
  const [disabled, setDisabled] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'machines' })

  useEffect(() => {
    fetchMachines()
      .then(setMachines)
      .catch((e) => (e instanceof GachaDisabledError ? setDisabled(true) : setError(String(e))))
  }, [])

  async function buy(machine: GachaMachine) {
    setError(null)
    try {
      setPhase({ kind: 'opening', step: 'firmando' })
      const pack = await generatePack(token, machine.code)
      const signed = await signTransactionBase64(pack.transaction)
      setPhase({ kind: 'opening', step: 'enviando' })
      await submitTx(token, signed)
      setPhase({ kind: 'opening', step: 'abriendo' })
      const result = await pollOpenPack(() => openPack(token, pack.memo))
      if (result.pending) {
        setPhase({ kind: 'pending', memo: pack.memo })
      } else {
        setPhase({ kind: 'result', result })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase({ kind: 'machines' })
    }
  }

  async function retryOpen(memo: string) {
    setPhase({ kind: 'opening', step: 'abriendo' })
    const result = await pollOpenPack(() => openPack(token, memo))
    if (result.pending) setPhase({ kind: 'pending', memo })
    else setPhase({ kind: 'result', result })
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const panel: React.CSSProperties = {
    background: COLORS.panel, border: `1px solid ${COLORS.border}`,
    borderRadius: 12, padding: 16,
  }

  if (disabled) {
    return (
      <Shell onBack={onBack}>
        <div style={panel}>
          <p style={{ color: COLORS.text }}>El Gacha no está disponible.</p>
          <p style={{ color: COLORS.muted, fontSize: 13 }}>
            Falta configurar la API key del Gacha en el backend (GACHA_API_KEY).
          </p>
        </div>
      </Shell>
    )
  }

  if (phase.kind === 'opening') {
    const labels = { firmando: 'Firma la transacción en tu wallet…', enviando: 'Enviando a Solana…', abriendo: 'Abriendo el pack…' }
    return (
      <Shell onBack={onBack}>
        <motion.div
          style={{ ...panel, textAlign: 'center', padding: 40 }}
          animate={reduced ? {} : { scale: [1, 1.03, 1] }}
          transition={{ repeat: Infinity, duration: 1.2 }}
        >
          <div style={{ fontSize: 40 }}>🎰</div>
          <p style={{ color: COLORS.text, fontFamily: FONTS.mono }}>{labels[phase.step]}</p>
        </motion.div>
      </Shell>
    )
  }

  if (phase.kind === 'pending') {
    return (
      <Shell onBack={onBack}>
        <div style={{ ...panel, textAlign: 'center' }}>
          <p style={{ color: COLORS.text }}>El pack se está procesando on-chain…</p>
          <button onClick={() => retryOpen(phase.memo)} style={btnStyle(COLORS.green)}>
            Seguir esperando
          </button>
        </div>
      </Shell>
    )
  }

  if (phase.kind === 'result') {
    const r = phase.result
    const color = RARITY_COLOR[r.rarity] ?? COLORS.muted
    return (
      <Shell onBack={onBack}>
        <motion.div
          initial={reduced ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 20 }}
          style={{ ...panel, textAlign: 'center', border: `1px solid ${color}88`, boxShadow: `0 0 24px ${color}44` }}
        >
          <div style={{ fontSize: 12, fontFamily: FONTS.mono, color, letterSpacing: '.2em' }}>
            {r.rarity.toUpperCase()}
          </div>
          {r.image && (
            <img src={r.image} alt={r.name ?? 'carta'} style={{ maxWidth: 220, borderRadius: 8, margin: '12px auto' }} />
          )}
          <div style={{ color: COLORS.text, fontFamily: FONTS.orbitron, fontSize: 18 }}>{r.name}</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
            <button onClick={onGoToCollection} style={btnStyle(COLORS.green)}>
              Crear desafío con esta carta
            </button>
            <a href="https://gacha.collectorcrypt.com" target="_blank" rel="noreferrer"
               style={{ ...btnStyle(COLORS.muted), textDecoration: 'none' }}>
              Vender de vuelta (buyback)
            </a>
          </div>
        </motion.div>
      </Shell>
    )
  }

  return (
    <Shell onBack={onBack}>
      {error && <p style={{ color: '#ff5c72', fontFamily: FONTS.mono, fontSize: 13 }}>{error}</p>}
      {machines === null && !error && <p style={{ color: COLORS.muted }}>Cargando máquinas…</p>}
      <div style={{ display: 'grid', gap: 12 }}>
        {machines?.map((m) => (
          <div key={m.code} style={{ ...panel, display: 'flex', gap: 14, alignItems: 'center' }}>
            {m.image && <img src={m.image} alt="" style={{ width: 64, borderRadius: 8 }} />}
            <div style={{ flex: 1 }}>
              <div style={{ color: COLORS.text, fontWeight: 700 }}>{m.name}</div>
              <div style={{ color: COLORS.muted, fontSize: 12, fontFamily: FONTS.mono }}>
                {m.price} USDC
                {m.ev != null && <> · EV ${m.ev}</>}
                {' · '}
                {Object.entries(m.odds).map(([k, v]) => `${k} ${v}%`).join(' · ')}
              </div>
            </div>
            <button onClick={() => buy(m)} style={btnStyle(COLORS.green)}>Abrir pack</button>
          </div>
        ))}
      </div>
    </Shell>
  )
}

function Shell({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 16 }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: COLORS.muted, cursor: 'pointer', fontFamily: FONTS.mono, marginBottom: 12 }}>
        ← volver
      </button>
      <h2 style={{ color: COLORS.text, fontFamily: FONTS.orbitron, letterSpacing: '.06em' }}>GACHA</h2>
      {children}
    </div>
  )
}

function btnStyle(color: string): React.CSSProperties {
  return {
    background: `${color}22`, border: `1px solid ${color}66`, color,
    borderRadius: 10, padding: '10px 18px', cursor: 'pointer',
    fontFamily: FONTS.mono, fontSize: 14,
  }
}
```

Ajustar al implementar: nombres exactos de `COLORS`/`FONTS` según `src/ui/theme.ts` (usar los mismos que CollectionScreen) y el patrón de botones existente si difiere.

- [ ] **Step 2: Verificar typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: limpio.

- [ ] **Step 3: Commit**

```bash
git add src/ui/screens/onchain/GachaScreen.tsx
git commit -m "feat(ui): GachaScreen — máquinas, compra firmada y reveal por rareza"
```

---

### Task 6: Frontend — navegación en `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Añadir la pantalla al flujo on-chain**

En `src/App.tsx`:

1. Tipo de pantallas (línea ~43):
```ts
type OnchainScreen = 'connect' | 'collection' | 'lobby' | 'battle' | 'gacha'
```

2. Lazy import junto a los demás:
```ts
const GachaScreen = lazy(() =>
  import('./ui/screens/onchain/GachaScreen').then((m) => ({ default: m.GachaScreen }))
)
```

3. En `renderOnchainScreen()` añadir la rama (requiere `authToken`):
```tsx
    if (onchainScreen === 'gacha' && authToken) {
      return (
        <GachaScreen
          token={authToken}
          onGoToCollection={() => setOnchainScreen('collection')}
          onBack={() => setOnchainScreen('collection')}
        />
      )
    }
```

4. Punto de entrada: en `CollectionScreen` añadir una prop opcional `onOpenGacha?: () => void` que App pasa como `() => setOnchainScreen('gacha')`, y dentro de `CollectionScreen` un botón secundario «🎰 Gacha — abre un pack» junto al header/acciones existentes (mismo estilo de botón secundario que su botón "volver"). Mantener el cambio mínimo: un botón, sin tocar la lógica de la pantalla.

- [ ] **Step 2: Verificar + suite completa**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: todo verde (87+ tests).

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx src/ui/screens/onchain/CollectionScreen.tsx
git commit -m "feat(ui): entrada Gacha en el flujo on-chain"
```

---

### Task 7: Documentación + checklist devnet

**Files:**
- Modify: `docs/ONCHAIN.md`
- Modify: `backend/README.md` (si existe sección de config; si no, crearla)

- [ ] **Step 1: Documentar config y validación manual**

En `backend/README.md` documentar las nuevas variables:
```
GACHA_BASE_URL  (default https://dev-gacha.collectorcrypt.com; producción https://gacha.collectorcrypt.com)
GACHA_API_KEY   (pedir en el Discord de Collector Crypt; sin ella el módulo responde 503)
```

En `docs/ONCHAIN.md` añadir sección «Gacha (devnet)» con el checklist manual:
1. Conseguir `GACHA_API_KEY` (Discord de CC) y ponerla en `backend/.env`.
2. USDC devnet del faucet `https://spl-token-faucet.com/?token-name=USDC-Dev` (mint `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr`).
3. App → modo on-chain → conectar wallet → Colección → «Gacha» → abrir pack (50 USDC) → firmar → reveal.
4. «Crear desafío con esta carta» → la carta nueva aparece en Colección → atestación del oráculo OK → crear batalla.

- [ ] **Step 2: Commit**

```bash
git add docs/ONCHAIN.md backend/README.md
git commit -m "docs: configuración y checklist devnet del Gacha"
```

---

### Task 8: Verificación final

- [ ] **Step 1: Suites completas**

Run:
```bash
cd backend && python3 -m pytest -q && cd .. && npx vitest run && npx tsc --noEmit && npm run build
```
Expected: todo verde.

- [ ] **Step 2: Smoke local sin API key**

Run: `cd backend && python3 -m uvicorn app.main:app --port 8080` y `curl -s localhost:8080/gacha/machines`
Expected: `{"detail":"gacha_disabled"}` con HTTP 503 (modo deshabilitado limpio).
