# Battle Arena — Oráculo de pricing

Servicio off-chain de la **Fase 1** que da valor a las cartas para el combate. Resuelve un `mint` de NFT de Collector Crypt → obtiene su **valor asegurado** y su **grade** → firma una **atestación ed25519** en el formato canónico EXACTO que verifica el programa Anchor. El cliente incrusta esa firma como instrucción Ed25519 en la transacción `initialize_battle`/`join_battle`, y el contrato la verifica por introspección.

**Estado:** MVP. Fuente de valor = solo `insuredValue` (mock para dev/tests, API real de Collector Crypt en producción). Sin dinero real.

## Arranque

```bash
cd oracle
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pytest -q                       # 24 tests, totalmente offline (HTTP mockeado)

# servidor (mock por defecto):
uvicorn app.main:app --port 8787
# fuente real:
PRICING_SOURCE=collectorcrypt uvicorn app.main:app --port 8787
```

## Endpoints

- `GET /health` → `{ "status": "ok" }`
- `GET /pubkey` → `{ "oracle_pubkey": "<base58>" }` — la clave a registrar on-chain (campo `oracle` de `Battle`).
- `GET /attest?mint=<pubkey>&battle=<pubkey>` →
  ```json
  {
    "mint": "<base58>", "value_usd": 1200, "grade": 9, "grading_company": "PSA",
    "ts": 1700000000, "message_hex": "…", "signature_hex": "…", "oracle_pubkey": "<base58>"
  }
  ```
  - **`battle` es obligatorio** (base58, debe decodificar a 32 bytes). La firma liga la atestación al PDA de batalla concreto, impidiendo reutilizarla en otra batalla (anti-replay).
  - `409` si la carta no puede valorarse (sin `insuredValue` / sin grade / mint no encontrado). `422` si `mint` o `battle` no son pubkeys válidas (no decodifican a 32 bytes).
  - El cliente construye la instrucción Ed25519 de la tx con `message_hex` + `signature_hex` + `oracle_pubkey`, con índices auto-referenciales `0xFFFF` (igual que en los tests litesvm del contrato), y la pone ANTES de la instrucción del programa, pasando `ed25519_ix_index`.

## Decisión de valor: solo `insuredValue` (resistente a manipulación)

El "poder" de una carta lo define **únicamente su valor asegurado** (`insuredValue` de Collector Crypt), fijado por un tercero. **No** se usa `listing.price` (lo fija el propio jugador → manipulable) ni la estimación PSA. Una carta sin `insuredValue` **no puede jugar** (se rechaza). Es el coste de que nadie pueda autoasignarse poder en un juego con apuestas. Hay un test explícito (`test_extract_no_fallback_to_listing_price`) que prueba que, aun habiendo precio de listado, sin `insuredValue` se rechaza.

> `insuredValue` es la fuente **v1**, intercambiable luego por el motor de pricing cross-platform del SPEC (el "moat") sin tocar el resto del servicio.

## Configuración (env / `.env`)

| Var | Default | Qué |
|---|---|---|
| `PRICING_SOURCE` | `mock` | `mock` (determinista, dev/tests) o `collectorcrypt` (API real) |
| `ORACLE_KEY_PATH` | `oracle_key.json` | semilla ed25519 (32 bytes hex). Se genera si no existe (**solo dev**). En producción, fuera del repo. |
| `CC_BASE_URL` | `https://api.collectorcrypt.com` | API de Collector Crypt (pública, sin auth) |
| `PRICING_CACHE_TTL` | `120` | TTL (s) de la caché por mint (respeta el WAF de CC) |

La clave del oráculo **nunca se commitea** (`.gitignore` cubre `oracle_key.json`, `.env`, `.venv`).

## Fuente de datos (Collector Crypt)

`GET {CC_BASE_URL}/marketplace?search={mint}` (pública). Se filtra el item con `nftAddress == mint` exacto (la búsqueda es por subcadena) y se extrae `insuredValue` + `gradeNum` + `gradingCompany`. Mapeo tomado de la integración real en MarketAgg.

## Garantía de no-desincronización con el contrato

El mensaje canónico es `mint(32) || value_usd(8 LE u64) || grade(1) || ts(8 LE i64) || battle(32)` = **81 bytes** — idéntico a `attestation_msg` del contrato. El campo `battle` liga la firma al PDA de la batalla concreta (anti-replay). Un **vector de equivalencia compartido** (`tests/fixtures/attestation_vectors.json`) lo verifican **a la vez** el test Python (`test_shared_vector_matches`) y un test Rust del contrato (`shared_attestation_vector_matches`). Si alguien cambia el formato en un lado, ambos tests rompen.

## Arquitectura

```
oracle/app/
  main.py             # FastAPI: /health, /pubkey, /attest (factory create_app + build_default_app)
  attestation.py      # build_message (canónico) + sign_attestation (ed25519)
  keys.py             # keypair ed25519 (carga/genera/persiste)
  config.py           # settings por env
  pricing/
    base.py           # CardValue, PricingSource, parse_insured_value/parse_grade, ValueUnavailable
    mock.py           # MockPricingSource (determinista)
    collector_crypt.py# CollectorCryptSource (API real, solo insuredValue, caché TTL)
```

## Riesgos / pendientes (pre-producción)

- **Disponibilidad = liveness**: si el oráculo cae, no se pueden crear batallas. Producción querrá redundancia / rotación de clave.
- **Binding por batalla**: RESUELTO. El endpoint `/attest` exige el parámetro `battle` (PDA de la batalla) y lo incluye en el mensaje firmado, impidiendo el reuso de una atestación en otra batalla.
- **Esquema CC**: el mapeo de campos está tomado de MarketAgg; conviene confirmarlo contra una respuesta real (el parser es tolerante a variantes de envoltorio).
