# Servicio de oráculo de pricing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir un servicio FastAPI que resuelva un mint de NFT de Collector Crypt a su valor asegurado + grade y firme una atestación ed25519 en el formato canónico exacto que verifica el programa Anchor.

**Architecture:** Servicio Python en `oracle/`. La fuente de valor está desacoplada tras una interfaz `PricingSource` (impl `mock` para dev/tests, impl `collector_crypt` que llama a la API pública real). El módulo `attestation` construye el mensaje canónico (`mint||value_le||grade||ts_le`) y lo firma con ed25519 (PyNaCl). Un endpoint `/attest` orquesta: pricing → construir mensaje → firmar → responder. Un fixture de vectores compartido garantiza que el formato del mensaje no se desincroniza del test Rust del contrato.

**Tech Stack:** Python 3.9, FastAPI, uvicorn, httpx (cliente CC), PyNaCl (ed25519), based58 (pubkeys Solana), pytest + respx (mock HTTP). venv local.

**Convención de unidades:** `value_usd` = dólares enteros (u64, half-up). `grade` = entero 1..=10 (u8). `ts` = unix seconds (i64). Mensaje LE para los enteros, mint en bytes crudos (base58-decode, 32 bytes).

---

## File Structure

```
oracle/
  requirements.txt
  .env.example
  .gitignore
  pytest.ini
  app/
    __init__.py
    config.py            # Settings desde env
    keys.py              # carga/genera keypair ed25519
    attestation.py       # build_message + sign + AttestationResult
    pricing/
      __init__.py
      base.py            # CardValue, PricingSource (Protocol), ValueUnavailable
      mock.py            # MockPricingSource
      collector_crypt.py # CollectorCryptSource (API real)
    main.py              # FastAPI app: /health, /pubkey, /attest
  tests/
    __init__.py
    conftest.py
    fixtures/
      cc_card_sample.json
      attestation_vectors.json
    test_attestation.py
    test_pricing_mock.py
    test_pricing_cc.py
    test_api.py
  README.md
onchain/programs/battle_arena/tests/fixtures/attestation_vectors.json  # copia para el test Rust
onchain/programs/battle_arena/src/oracle.rs  # +test que valida el vector compartido
```

**Comandos base** (todos desde `oracle/` salvo nota):
```bash
cd /Users/mauro/Desarrollos/BattleArena/oracle
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pytest -q
```

---

## Task 1: Scaffold del proyecto Python

**Files:**
- Create: `oracle/requirements.txt`, `oracle/.gitignore`, `oracle/pytest.ini`, `oracle/.env.example`, `oracle/app/__init__.py`, `oracle/tests/__init__.py`, `oracle/app/config.py`, `oracle/tests/test_smoke.py`

- [ ] **Step 1: requirements + config files**

Create `oracle/requirements.txt`:
```
fastapi==0.110.0
uvicorn==0.29.0
httpx==0.27.0
pynacl==1.5.0
based58==0.1.1
pydantic==2.6.4
pydantic-settings==2.2.1
pytest==8.1.1
pytest-asyncio==0.23.6
respx==0.21.1
```

Create `oracle/.gitignore`:
```
.venv/
__pycache__/
*.pyc
.env
oracle_key.json
.pytest_cache/
```

Create `oracle/pytest.ini`:
```ini
[pytest]
asyncio_mode = auto
testpaths = tests
```

Create `oracle/.env.example`:
```
# fuente de pricing: mock | collectorcrypt
PRICING_SOURCE=mock
# ruta del keypair ed25519 del oráculo (32 bytes semilla en hex). Se genera si no existe (solo dev).
ORACLE_KEY_PATH=oracle_key.json
# base de la API de Collector Crypt (pública, sin auth)
CC_BASE_URL=https://api.collectorcrypt.com
# TTL de caché de pricing en segundos
PRICING_CACHE_TTL=120
```

Create empty `oracle/app/__init__.py` and `oracle/tests/__init__.py`.

- [ ] **Step 2: config.py**

Create `oracle/app/config.py`:
```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    pricing_source: str = "mock"
    oracle_key_path: str = "oracle_key.json"
    cc_base_url: str = "https://api.collectorcrypt.com"
    pricing_cache_ttl: int = 120


def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 3: smoke test**

Create `oracle/tests/test_smoke.py`:
```python
from app.config import get_settings


def test_settings_defaults():
    s = get_settings()
    assert s.pricing_source in ("mock", "collectorcrypt")
    assert s.cc_base_url.startswith("https://")
```

- [ ] **Step 4: venv + install + run**

Run:
```bash
cd /Users/mauro/Desarrollos/BattleArena/oracle
python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
pytest -q
```
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add oracle/requirements.txt oracle/.gitignore oracle/pytest.ini oracle/.env.example oracle/app/__init__.py oracle/app/config.py oracle/tests/__init__.py oracle/tests/test_smoke.py
git commit -m "chore(oracle): scaffold FastAPI + pytest"
```

---

## Task 2: `pricing/base.py` — tipos e interfaz

**Files:**
- Create: `oracle/app/pricing/__init__.py`, `oracle/app/pricing/base.py`, `oracle/tests/test_pricing_base.py`

- [ ] **Step 1: Escribir test que falla**

Create `oracle/tests/test_pricing_base.py`:
```python
import pytest
from app.pricing.base import ValueUnavailable, parse_insured_value, parse_grade


def test_parse_insured_value_rounds_half_up():
    assert parse_insured_value("125") == 125
    assert parse_insured_value("124.50") == 125
    assert parse_insured_value("124.49") == 124


def test_parse_insured_value_rejects_bad():
    for bad in [None, "", "0", "-5", "abc"]:
        with pytest.raises(ValueUnavailable):
            parse_insured_value(bad)


def test_parse_grade_ok_and_bad():
    assert parse_grade(9) == 9
    for bad in [None, 0, 11, -1]:
        with pytest.raises(ValueUnavailable):
            parse_grade(bad)
```

- [ ] **Step 2: Verificar que falla**

Run: `pytest tests/test_pricing_base.py -q`
Expected: ImportError / módulo no existe.

- [ ] **Step 3: Implementar**

Create `oracle/app/pricing/__init__.py` (empty).

Create `oracle/app/pricing/base.py`:
```python
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
from typing import Optional, Protocol, TypedDict


class ValueUnavailable(Exception):
    """La carta no puede valorarse de forma segura (sin insuredValue / grade)."""


class CardValue(TypedDict):
    mint: str
    value_usd: int        # dólares enteros, > 0
    grade: int            # 1..=10
    grading_company: str  # 'PSA' | 'CGC' | 'BGS' | ''


def parse_insured_value(raw: Optional[str]) -> int:
    if raw is None or str(raw).strip() == "":
        raise ValueUnavailable("insuredValue ausente")
    try:
        d = Decimal(str(raw))
    except (InvalidOperation, ValueError):
        raise ValueUnavailable(f"insuredValue no parseable: {raw!r}")
    dollars = int(d.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if dollars <= 0:
        raise ValueUnavailable(f"insuredValue no positivo: {raw!r}")
    return dollars


def parse_grade(raw: Optional[int]) -> int:
    if raw is None or not isinstance(raw, int) or isinstance(raw, bool):
        raise ValueUnavailable(f"grade inválido: {raw!r}")
    if raw < 1 or raw > 10:
        raise ValueUnavailable(f"grade fuera de rango: {raw!r}")
    return raw


class PricingSource(Protocol):
    async def get_value(self, mint: str) -> CardValue: ...
```

- [ ] **Step 4: Verificar que pasa**

Run: `pytest tests/test_pricing_base.py -q`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add oracle/app/pricing/__init__.py oracle/app/pricing/base.py oracle/tests/test_pricing_base.py
git commit -m "feat(oracle): tipos de pricing + parseo de insuredValue/grade"
```

---

## Task 3: `pricing/mock.py` — fuente determinista

**Files:**
- Create: `oracle/app/pricing/mock.py`, `oracle/tests/test_pricing_mock.py`

- [ ] **Step 1: Escribir test que falla**

Create `oracle/tests/test_pricing_mock.py`:
```python
import pytest
from app.pricing.mock import MockPricingSource
from app.pricing.base import ValueUnavailable


async def test_mock_deterministic():
    src = MockPricingSource()
    a = await src.get_value("MintAAA")
    b = await src.get_value("MintAAA")
    assert a == b
    assert a["value_usd"] > 0
    assert 1 <= a["grade"] <= 10
    assert a["mint"] == "MintAAA"


async def test_mock_overrides():
    src = MockPricingSource(overrides={"X": {"value_usd": 5000, "grade": 10, "grading_company": "PSA"}})
    v = await src.get_value("X")
    assert v["value_usd"] == 5000 and v["grade"] == 10


async def test_mock_unavailable():
    src = MockPricingSource(unavailable={"NOPE"})
    with pytest.raises(ValueUnavailable):
        await src.get_value("NOPE")
```

- [ ] **Step 2: Verificar que falla**

Run: `pytest tests/test_pricing_mock.py -q`
Expected: ImportError.

- [ ] **Step 3: Implementar**

Create `oracle/app/pricing/mock.py`:
```python
import hashlib
from typing import Optional
from .base import CardValue, PricingSource, ValueUnavailable


class MockPricingSource(PricingSource):
    """Valores deterministas derivados del mint. Para dev/tests sin red."""

    def __init__(self, overrides: Optional[dict] = None, unavailable: Optional[set] = None):
        self._overrides = overrides or {}
        self._unavailable = unavailable or set()

    async def get_value(self, mint: str) -> CardValue:
        if mint in self._unavailable:
            raise ValueUnavailable(f"mock: {mint} no disponible")
        if mint in self._overrides:
            o = self._overrides[mint]
            return {"mint": mint, "value_usd": o["value_usd"], "grade": o["grade"],
                    "grading_company": o.get("grading_company", "PSA")}
        h = hashlib.sha256(mint.encode()).digest()
        value = 100 + (int.from_bytes(h[:4], "big") % 100_000)  # 100..100099
        grade = 7 + (h[4] % 4)  # 7..10
        return {"mint": mint, "value_usd": value, "grade": grade, "grading_company": "PSA"}
```

- [ ] **Step 4: Verificar que pasa**

Run: `pytest tests/test_pricing_mock.py -q`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add oracle/app/pricing/mock.py oracle/tests/test_pricing_mock.py
git commit -m "feat(oracle): MockPricingSource determinista"
```

---

## Task 4: `keys.py` — keypair ed25519 del oráculo

**Files:**
- Create: `oracle/app/keys.py`, `oracle/tests/test_keys.py`

- [ ] **Step 1: Escribir test que falla**

Create `oracle/tests/test_keys.py`:
```python
import os
from app.keys import load_or_create_signing_key, pubkey_base58
from nacl.signing import SigningKey


def test_load_or_create_persists(tmp_path):
    p = str(tmp_path / "k.json")
    k1 = load_or_create_signing_key(p)
    assert isinstance(k1, SigningKey)
    assert os.path.exists(p)
    k2 = load_or_create_signing_key(p)  # reload, debe ser la misma
    assert bytes(k1.verify_key) == bytes(k2.verify_key)


def test_pubkey_base58_len(tmp_path):
    k = load_or_create_signing_key(str(tmp_path / "k.json"))
    b58 = pubkey_base58(k)
    assert isinstance(b58, str) and 32 <= len(b58) <= 44
```

- [ ] **Step 2: Verificar que falla**

Run: `pytest tests/test_keys.py -q`
Expected: ImportError.

- [ ] **Step 3: Implementar**

Create `oracle/app/keys.py`:
```python
import json
import os
import based58
from nacl.signing import SigningKey


def load_or_create_signing_key(path: str) -> SigningKey:
    """Carga la semilla de 32 bytes (hex) desde `path`, o genera y persiste una nueva (solo dev)."""
    if os.path.exists(path):
        with open(path) as f:
            data = json.load(f)
        seed = bytes.fromhex(data["seed_hex"])
        return SigningKey(seed)
    key = SigningKey.generate()
    with open(path, "w") as f:
        json.dump({"seed_hex": bytes(key).hex()}, f)
    return key


def pubkey_base58(key: SigningKey) -> str:
    return based58.b58encode(bytes(key.verify_key)).decode()
```

- [ ] **Step 4: Verificar que pasa**

Run: `pytest tests/test_keys.py -q`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add oracle/app/keys.py oracle/tests/test_keys.py
git commit -m "feat(oracle): keypair ed25519 (carga/genera/persiste)"
```

---

## Task 5: `attestation.py` — mensaje canónico + firma + vector compartido

**Files:**
- Create: `oracle/app/attestation.py`, `oracle/tests/test_attestation.py`, `oracle/tests/fixtures/attestation_vectors.json`

- [ ] **Step 1: Crear el fixture de vectores**

Create `oracle/tests/fixtures/attestation_vectors.json`. El mint se da en base58; el mensaje esperado se calculará y se fija aquí tras implementar (ver Step 4). Inicialmente:
```json
[
  {
    "mint": "11111111111111111111111111111111",
    "value_usd": 1200,
    "grade": 9,
    "ts": 1700000000,
    "message_hex": "FILL_AFTER_IMPL"
  }
]
```
(`11111111111111111111111111111111` es el System Program, base58 que decodifica a 32 bytes cero — útil como vector estable.)

- [ ] **Step 2: Escribir test que falla**

Create `oracle/tests/test_attestation.py`:
```python
import json
import os
import based58
from nacl.signing import SigningKey
from app.attestation import build_message, sign_attestation


FIX = os.path.join(os.path.dirname(__file__), "fixtures", "attestation_vectors.json")


def test_message_layout():
    # mint de 32 bytes cero, value 1200, grade 9, ts 1700000000
    mint = "11111111111111111111111111111111"
    msg = build_message(mint, 1200, 9, 1700000000)
    assert len(msg) == 32 + 8 + 1 + 8
    assert msg[:32] == b"\x00" * 32
    assert msg[32:40] == (1200).to_bytes(8, "little")
    assert msg[40] == 9
    assert msg[41:49] == (1700000000).to_bytes(8, "little", signed=True)


def test_message_changes_with_each_field():
    base = build_message("11111111111111111111111111111111", 1200, 9, 1700000000)
    assert base != build_message("11111111111111111111111111111111", 1201, 9, 1700000000)
    assert base != build_message("11111111111111111111111111111111", 1200, 8, 1700000000)
    assert base != build_message("11111111111111111111111111111111", 1200, 9, 1700000001)


def test_signature_verifies():
    key = SigningKey.generate()
    mint = "11111111111111111111111111111111"
    res = sign_attestation(key, mint, 1200, 9, 1700000000)
    # la firma verifica con la verify_key
    msg = bytes.fromhex(res["message_hex"])
    key.verify_key.verify(msg, bytes.fromhex(res["signature_hex"]))
    assert res["message_hex"] == build_message(mint, 1200, 9, 1700000000).hex()


def test_shared_vector_matches():
    with open(FIX) as f:
        vectors = json.load(f)
    for v in vectors:
        msg = build_message(v["mint"], v["value_usd"], v["grade"], v["ts"])
        assert msg.hex() == v["message_hex"], f"vector {v} desincronizado"
```

- [ ] **Step 3: Verificar que falla**

Run: `pytest tests/test_attestation.py -q`
Expected: ImportError / FAIL (incluido `test_shared_vector_matches` por el placeholder).

- [ ] **Step 4: Implementar y rellenar el vector**

Create `oracle/app/attestation.py`:
```python
import based58
from nacl.signing import SigningKey


def build_message(mint_b58: str, value_usd: int, grade: int, ts: int) -> bytes:
    """Mensaje canónico idéntico a attestation_msg del contrato:
    mint(32) || value_usd(8 LE u64) || grade(1) || ts(8 LE i64)."""
    mint_bytes = based58.b58decode(mint_b58.encode())
    if len(mint_bytes) != 32:
        raise ValueError(f"mint no es 32 bytes: {mint_b58}")
    out = bytearray()
    out += mint_bytes
    out += int(value_usd).to_bytes(8, "little", signed=False)
    out += int(grade).to_bytes(1, "little", signed=False)
    out += int(ts).to_bytes(8, "little", signed=True)
    return bytes(out)


def sign_attestation(key: SigningKey, mint_b58: str, value_usd: int, grade: int, ts: int) -> dict:
    msg = build_message(mint_b58, value_usd, grade, ts)
    sig = key.sign(msg).signature
    return {"message_hex": msg.hex(), "signature_hex": sig.hex()}
```

Then compute the real `message_hex` for the fixture and write it in. Run this one-off (from `oracle/` with venv active):
```bash
python -c "from app.attestation import build_message; print(build_message('11111111111111111111111111111111',1200,9,1700000000).hex())"
```
Copy the printed hex into `attestation_vectors.json` replacing `FILL_AFTER_IMPL`.

- [ ] **Step 5: Verificar que pasa**

Run: `pytest tests/test_attestation.py -q`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add oracle/app/attestation.py oracle/tests/test_attestation.py oracle/tests/fixtures/attestation_vectors.json
git commit -m "feat(oracle): mensaje canónico + firma ed25519 + vector de equivalencia"
```

---

## Task 6: Test Rust de equivalencia del vector (sincroniza contrato ↔ oráculo)

**Files:**
- Create: `onchain/programs/battle_arena/tests/fixtures/attestation_vectors.json` (copia exacta del de oracle)
- Modify: `onchain/programs/battle_arena/src/oracle.rs` (añadir test)

> Garantiza que el formato del mensaje del contrato y del oráculo no se desincronizan: el mismo fixture pasa por `attestation_msg` en Rust y debe dar el mismo `message_hex`.

- [ ] **Step 1: Copiar el fixture**

Run (después de Task 5):
```bash
mkdir -p /Users/mauro/Desarrollos/BattleArena/onchain/programs/battle_arena/tests/fixtures
cp /Users/mauro/Desarrollos/BattleArena/oracle/tests/fixtures/attestation_vectors.json \
   /Users/mauro/Desarrollos/BattleArena/onchain/programs/battle_arena/tests/fixtures/attestation_vectors.json
```

- [ ] **Step 2: Escribir el test en `oracle.rs`**

In `onchain/programs/battle_arena/src/oracle.rs`, inside the existing `#[cfg(test)] mod tests`, add:
```rust
#[test]
fn shared_attestation_vector_matches() {
    // El mismo fixture que valida el oráculo Python. mint base58 -> 32 bytes.
    // Vector: System Program (32 ceros), value 1200, grade 9, ts 1700000000.
    let mint = Pubkey::new_from_array([0u8; 32]);
    let msg = attestation_msg(&mint, 1200, 9, 1700000000);
    // hex esperado calculado por build_message del oráculo:
    let expected_hex = include_str!("../tests/fixtures/attestation_vectors.json");
    // parse mínimo: buscar el message_hex del primer vector
    let needle = "\"message_hex\": \"";
    let start = expected_hex.find(needle).unwrap() + needle.len();
    let end = expected_hex[start..].find('"').unwrap() + start;
    let want = &expected_hex[start..end];
    let got = msg.iter().map(|b| format!("{:02x}", b)).collect::<String>();
    assert_eq!(got, want, "el formato del mensaje del contrato y del oráculo se desincronizó");
}
```
Note: si `Pubkey` no está importado en el módulo de tests, añade `use anchor_lang::prelude::Pubkey;` dentro del `mod tests` (o usa el `Pubkey` ya en scope). El path del `include_str!` es relativo a `src/oracle.rs` → `../tests/fixtures/...`.

- [ ] **Step 3: Verificar**

Run:
```bash
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd /Users/mauro/Desarrollos/BattleArena/onchain/programs/battle_arena
cargo test shared_attestation_vector_matches
```
Expected: PASS. Si falla, el formato difiere — corrige el lado que esté mal (el contrato es la fuente de verdad del layout; ajusta el oráculo y regenera el vector si hiciera falta).

- [ ] **Step 4: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add onchain/programs/battle_arena/tests/fixtures/attestation_vectors.json onchain/programs/battle_arena/src/oracle.rs
git commit -m "test(onchain): vector de equivalencia del mensaje compartido con el oráculo"
```

---

## Task 7: `pricing/collector_crypt.py` — fuente real (API CC)

**Files:**
- Create: `oracle/app/pricing/collector_crypt.py`, `oracle/tests/test_pricing_cc.py`, `oracle/tests/fixtures/cc_card_sample.json`

> Campos reales (de MarketAgg): `GET {base}/marketplace?search={mint}` devuelve una lista; cada item tiene `nftAddress` (mint), `insuredValue` (string|null), `gradeNum` (int|null), `gradingCompany` ('PSA'|'CGC'|'BGS'|null). La búsqueda es por subcadena → filtrar `nftAddress == mint` exacto.

- [ ] **Step 1: Fixture con forma real**

Create `oracle/tests/fixtures/cc_card_sample.json` (respuesta de ejemplo con 2 items; el query buscaba "Mint1111..." y devolvió un match exacto y un ruido por subcadena):
```json
{
  "nfts": [
    {
      "id": "card-1",
      "nftAddress": "4zckiFu3N1kbJyZpqks8Qw1TW8bQ69eDDcyi1Qx9pJW",
      "itemName": "Charizard Base Set",
      "gradeNum": 9,
      "gradingCompany": "PSA",
      "gradingID": "119934391",
      "insuredValue": "1200",
      "listing": { "price": 950, "currency": "USDC", "marketplace": "CC" }
    },
    {
      "id": "card-2",
      "nftAddress": "9xxOTHERmintADDRESSxxxxxxxxxxxxxxxxxxxxxxxxx",
      "itemName": "Otra carta (ruido por subcadena)",
      "gradeNum": 7,
      "gradingCompany": "CGC",
      "gradingID": "555",
      "insuredValue": null,
      "listing": null
    }
  ]
}
```
Note: la clave de nivel superior que envuelve la lista puede ser `nfts`, `data`, o la lista directa — el parser debe tolerar las variantes (ver Step 3). Ajusta el fixture si conoces la forma exacta; el parser no debe asumir una sola.

- [ ] **Step 2: Escribir test que falla**

Create `oracle/tests/test_pricing_cc.py`:
```python
import json
import os
import httpx
import respx
import pytest
from app.pricing.collector_crypt import CollectorCryptSource, _extract_card, _items_from_payload
from app.pricing.base import ValueUnavailable

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "cc_card_sample.json")
MINT_OK = "4zckiFu3N1kbJyZpqks8Qw1TW8bQ69eDDcyi1Qx9pJW"


def _payload():
    with open(FIX) as f:
        return json.load(f)


def test_extract_exact_match_and_value():
    items = _items_from_payload(_payload())
    card = _extract_card(items, MINT_OK)
    assert card["value_usd"] == 1200
    assert card["grade"] == 9
    assert card["grading_company"] == "PSA"
    assert card["mint"] == MINT_OK


def test_extract_rejects_when_no_insured_value():
    items = _items_from_payload(_payload())
    with pytest.raises(ValueUnavailable):
        _extract_card(items, "9xxOTHERmintADDRESSxxxxxxxxxxxxxxxxxxxxxxxxx")


def test_extract_rejects_when_mint_absent():
    items = _items_from_payload(_payload())
    with pytest.raises(ValueUnavailable):
        _extract_card(items, "NONEXISTENTMINT")


@respx.mock
async def test_get_value_calls_api():
    route = respx.get("https://api.collectorcrypt.com/marketplace").mock(
        return_value=httpx.Response(200, json=_payload())
    )
    src = CollectorCryptSource(base_url="https://api.collectorcrypt.com", cache_ttl=0)
    v = await src.get_value(MINT_OK)
    assert v["value_usd"] == 1200 and v["grade"] == 9
    assert route.called
    assert route.calls.last.request.url.params["search"] == MINT_OK
```

- [ ] **Step 3: Verificar que falla**

Run: `pytest tests/test_pricing_cc.py -q`
Expected: ImportError.

- [ ] **Step 4: Implementar**

Create `oracle/app/pricing/collector_crypt.py`:
```python
import time
from typing import Any
import httpx
from .base import CardValue, PricingSource, ValueUnavailable, parse_insured_value, parse_grade


def _items_from_payload(payload: Any) -> list:
    """La API puede envolver la lista en 'nfts'/'data' o devolverla directa."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("nfts", "data", "results", "items"):
            v = payload.get(key)
            if isinstance(v, list):
                return v
    return []


def _extract_card(items: list, mint: str) -> CardValue:
    match = next((it for it in items if it.get("nftAddress") == mint), None)
    if match is None:
        raise ValueUnavailable(f"mint no encontrado en CC: {mint}")
    value_usd = parse_insured_value(match.get("insuredValue"))   # SOLO insuredValue (decisión 1)
    grade = parse_grade(match.get("gradeNum"))
    company = match.get("gradingCompany") or ""
    return {"mint": mint, "value_usd": value_usd, "grade": grade, "grading_company": company}


class CollectorCryptSource(PricingSource):
    def __init__(self, base_url: str, cache_ttl: int = 120):
        self._base = base_url.rstrip("/")
        self._ttl = cache_ttl
        self._cache: dict[str, tuple[float, CardValue]] = {}

    async def get_value(self, mint: str) -> CardValue:
        now = time.time()
        cached = self._cache.get(mint)
        if cached and now - cached[0] < self._ttl:
            return cached[1]
        url = f"{self._base}/marketplace"
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                resp = await client.get(url, params={"search": mint},
                                        headers={"accept": "application/json"})
                resp.raise_for_status()
            except httpx.HTTPError as e:
                raise ValueUnavailable(f"error CC API: {e}")
            payload = resp.json()
        card = _extract_card(_items_from_payload(payload), mint)
        if self._ttl > 0:
            self._cache[mint] = (now, card)
        return card
```

- [ ] **Step 5: Verificar que pasa**

Run: `pytest tests/test_pricing_cc.py -q`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add oracle/app/pricing/collector_crypt.py oracle/tests/test_pricing_cc.py oracle/tests/fixtures/cc_card_sample.json
git commit -m "feat(oracle): CollectorCryptSource (API real, solo insuredValue)"
```

---

## Task 8: `main.py` — FastAPI (/health, /pubkey, /attest)

**Files:**
- Create: `oracle/app/main.py`, `oracle/tests/conftest.py`, `oracle/tests/test_api.py`

- [ ] **Step 1: conftest con app de test (MockPricingSource)**

Create `oracle/tests/conftest.py`:
```python
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.pricing.mock import MockPricingSource
from nacl.signing import SigningKey


@pytest.fixture
def client(tmp_path):
    key = SigningKey.generate()
    src = MockPricingSource(
        overrides={"MintA": {"value_usd": 1200, "grade": 9, "grading_company": "PSA"}},
        unavailable={"MintNoVal"},
    )
    app = create_app(signing_key=key, pricing=src, now_fn=lambda: 1700000000)
    return TestClient(app), key
```

- [ ] **Step 2: Escribir test que falla**

Create `oracle/tests/test_api.py`:
```python
import based58


def test_health(client):
    c, _ = client
    r = c.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_pubkey(client):
    c, key = client
    r = c.get("/pubkey")
    assert r.status_code == 200
    assert r.json()["oracle_pubkey"] == based58.b58encode(bytes(key.verify_key)).decode()


def test_attest_happy(client):
    c, key = client
    r = c.get("/attest", params={"mint": "MintA"})
    assert r.status_code == 200
    body = r.json()
    assert body["value_usd"] == 1200 and body["grade"] == 9 and body["ts"] == 1700000000
    # la firma verifica
    key.verify_key.verify(bytes.fromhex(body["message_hex"]), bytes.fromhex(body["signature_hex"]))


def test_attest_unavailable(client):
    c, _ = client
    r = c.get("/attest", params={"mint": "MintNoVal"})
    assert r.status_code == 409
```

- [ ] **Step 3: Verificar que falla**

Run: `pytest tests/test_api.py -q`
Expected: ImportError (create_app no existe).

- [ ] **Step 4: Implementar**

Create `oracle/app/main.py`:
```python
import time
from typing import Callable, Optional
from fastapi import FastAPI, HTTPException, Query
from nacl.signing import SigningKey

from .attestation import sign_attestation, build_message
from .keys import load_or_create_signing_key, pubkey_base58
from .pricing.base import PricingSource, ValueUnavailable
from .pricing.mock import MockPricingSource
from .pricing.collector_crypt import CollectorCryptSource
from .config import get_settings


def create_app(signing_key: SigningKey, pricing: PricingSource,
               now_fn: Callable[[], int] = lambda: int(time.time())) -> FastAPI:
    app = FastAPI(title="Battle Arena — Oráculo de pricing")
    oracle_b58 = pubkey_base58(signing_key)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/pubkey")
    async def pubkey():
        return {"oracle_pubkey": oracle_b58}

    @app.get("/attest")
    async def attest(mint: str = Query(..., min_length=32, max_length=44)):
        try:
            card = await pricing.get_value(mint)
        except ValueUnavailable as e:
            raise HTTPException(status_code=409, detail=str(e))
        ts = now_fn()
        try:
            signed = sign_attestation(signing_key, mint, card["value_usd"], card["grade"], ts)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
        return {
            "mint": mint, "value_usd": card["value_usd"], "grade": card["grade"],
            "grading_company": card["grading_company"], "ts": ts,
            "message_hex": signed["message_hex"], "signature_hex": signed["signature_hex"],
            "oracle_pubkey": oracle_b58,
        }

    return app


def build_default_app() -> FastAPI:
    """Entrypoint de producción/dev: arma la app desde settings de entorno."""
    s = get_settings()
    key = load_or_create_signing_key(s.oracle_key_path)
    pricing: PricingSource = (
        CollectorCryptSource(s.cc_base_url, s.pricing_cache_ttl)
        if s.pricing_source == "collectorcrypt"
        else MockPricingSource()
    )
    return create_app(key, pricing)


app = build_default_app()
```

- [ ] **Step 5: Verificar que pasa**

Run: `pytest tests/test_api.py -q`
Expected: 4 passed.

- [ ] **Step 6: Verificar toda la suite + arranque del server**

Run:
```bash
cd /Users/mauro/Desarrollos/BattleArena/oracle && source .venv/bin/activate
pytest -q
# arranque humo (mock):
PRICING_SOURCE=mock uvicorn app.main:app --port 8787 &
sleep 2; curl -s "http://localhost:8787/attest?mint=11111111111111111111111111111111" | head -c 400; echo
kill %1
```
Expected: toda la suite verde; el curl devuelve un JSON con `signature_hex`.

- [ ] **Step 7: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add oracle/app/main.py oracle/tests/conftest.py oracle/tests/test_api.py
git commit -m "feat(oracle): FastAPI /health /pubkey /attest"
```

---

## Task 9: README del oráculo

**Files:**
- Create: `oracle/README.md`

- [ ] **Step 1: Escribir README**

Create `oracle/README.md` documentando: qué es (oráculo de la Fase 1), arranque (`venv`, `pip install`, `uvicorn app.main:app`), los endpoints (`/health`, `/pubkey`, `/attest?mint=`), la decisión de valor (solo `insuredValue` de Collector Crypt, resistente a manipulación), la config por env (`PRICING_SOURCE=mock|collectorcrypt`, `ORACLE_KEY_PATH`, `CC_BASE_URL`, `PRICING_CACHE_TTL`), cómo el cliente usa la respuesta (construir la instrucción Ed25519 con `message_hex`+`signature_hex`+`oracle_pubkey`, índices auto-referenciales 0xFFFF), y el **vector de equivalencia compartido** con el contrato como garantía de no-desincronización. Nota: clave del oráculo fuera del repo en producción; `insuredValue` es la fuente v1 (intercambiable por pricing real luego).

- [ ] **Step 2: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add oracle/README.md
git commit -m "docs(oracle): README del servicio de oráculo"
```

---

## Self-Review (completado por el autor del plan)

- **Cobertura del spec:** scaffold (Task 1), tipos+parseo insuredValue/grade (2), MockPricingSource (3), keypair ed25519 (4), mensaje canónico+firma+vector (5), equivalencia Rust↔Python (6), CollectorCryptSource API real solo-insuredValue (7), FastAPI /health//pubkey//attest (8), README (9). Decisión "solo insuredValue" implementada en `_extract_card` (solo `parse_insured_value(match['insuredValue'])`, sin fallback). ✔️
- **Placeholders:** el único `FILL_AFTER_IMPL` (Task 5 Step 1) se rellena explícitamente en Step 4 con el comando que calcula el hex; es parte del procedimiento, no un placeholder abandonado. El parser CC tolera variantes de envoltorio porque la clave exacta de la lista no está 100% confirmada (documentado); el fixture es ajustable.
- **Consistencia de tipos:** `CardValue{mint,value_usd,grade,grading_company}`, `PricingSource.get_value(mint)->CardValue`, `build_message(mint_b58,value_usd,grade,ts)->bytes`, `sign_attestation(key,...)->{message_hex,signature_hex}`, `create_app(signing_key,pricing,now_fn)` coherentes entre tasks y tests. El formato del mensaje es idéntico al `attestation_msg` del contrato (mint32||value_le8||grade1||ts_le8) y se ancla con el vector compartido (Task 6). ✔️
- **Riesgo conocido:** la forma exacta del JSON de `GET /marketplace?search=` (clave envolvente y que `insuredValue`/`gradeNum` estén en el top-level del item) está tomada de los tipos de MarketAgg pero debe confirmarse contra una respuesta real; por eso el parser es tolerante y el resolver está aislado y mockeado en tests. La validación contra la API real es un check manual post-implementación (no rompe el CI offline).
