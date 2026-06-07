# Fase 1 (ciclo 2) — Servicio de oráculo de pricing

**Fecha:** 2026-06-07
**Estado:** Diseño aprobado, listo para plan de implementación
**Alcance:** El servicio off-chain que firma atestaciones de valor `(mint, value_usd, grade, ts)` con ed25519, en el formato canónico EXACTO que verifica el programa Anchor de la Fase 1 (ciclo 1).

## Objetivo

Construir el oráculo que da valor a las cartas para el combate. Resuelve un `mint` de NFT de Collector Crypt → obtiene su **valor asegurado** y su **grade** → firma una atestación que el cliente incrusta como instrucción Ed25519 en la transacción `initialize_battle`/`join_battle`, y que el programa verifica por introspección. Cierra el lazo de confianza: hace que el programa on-chain sea utilizable por un cliente real.

## Decisiones aprobadas

1. **Fuente de valor: SOLO `insuredValue`** (valor asegurado, fijado por un tercero). No se usa `listing.price` (autoasignable por el jugador → manipulable) ni la estimación PSA. Una carta sin `insuredValue` **no puede valorarse → se rechaza** (no puede jugar). Resistencia a manipulación es el criterio rector: el jugador no puede autoasignarse "poder".
2. **Fuente de datos: API REST de Collector Crypt** (`https://api.collectorcrypt.com`, pública, sin auth), no la metadata on-chain. Confirmado por la integración existente en MarketAgg (`packages/adapters/src/collectorCrypt/`): los atributos de valor/grade viven en la API, no en el JSON Metaplex.
3. **Stack: Python / FastAPI** (alineado con el backend de la Fase 1 del SPEC). El cliente CC se reimplementa (es un único GET público); MarketAgg es la referencia del mapeo de campos y de las lecciones de rate-limit.

## No-objetivos (otros ciclos)

- Motor de pricing cross-platform / TCG Pricing Intelligence (el SPEC lo cita como el "moat"; aquí `insuredValue` es la fuente v1, intercambiable después).
- Backend de ELO/matchmaking/historial.
- Frontend/wallet, despliegue on-chain, dinero real.
- Estimación PSA y precio de mercado (descartados como fuente por la decisión 1).

## Arquitectura

Servicio nuevo en `oracle/` (Python/FastAPI, venv, pytest).

```
oracle/
  pyproject.toml | requirements.txt
  app/
    main.py            # FastAPI: endpoints /health, /pubkey, /attest
    attestation.py     # mensaje canónico + firma ed25519
    keys.py            # carga/genera el keypair ed25519 del oráculo
    pricing/
      base.py          # PricingSource (interfaz) + tipos (CardValue)
      mock.py          # MockPricingSource (determinista, dev/tests)
      collector_crypt.py  # CollectorCryptSource (API real)
    config.py          # settings (env): PRICING_SOURCE, ORACLE_KEY_PATH, CC_BASE_URL, cache TTL
  tests/
    test_attestation.py
    test_pricing_mock.py
    test_pricing_cc.py
    test_api.py
    fixtures/
      cc_card_sample.json        # forma real de una respuesta CC (de MarketAgg)
      attestation_vectors.json   # input -> message hex (compartido con el test Rust del contrato)
  README.md
```

### Mensaje canónico (idéntico al contrato)

`message = mint(32 bytes) || value_usd(8 bytes LE u64) || grade(1 byte u8) || ts(8 bytes LE i64)` — exactamente lo que produce `attestation_msg` en `onchain/programs/battle_arena/src/oracle.rs`. El oráculo firma este `message` con su clave ed25519. **Garantía de no-desincronización:** un fixture `attestation_vectors.json` (input → message hex esperado) es verificado por el test Python **y** por un test Rust añadido al módulo `oracle` del contrato. Si alguien cambia el formato en un lado, ambos tests rompen.

### Modelo de valor

- `insuredValue` viene como **string** (p.ej. `"125"`, `"124.50"`). Se parsea a número y se **redondea al dólar entero más cercano (half-up)** → `value_usd: u64`. Se rechaza si es nulo/ausente/≤ 0 o no parseable (`ValueUnavailable`).
- `gradeNum` (1-10) → `grade: u8`. Nulo → rechazo (sin grade no hay Solidez). `gradingCompany` (PSA/CGC/BGS) se incluye informativo en la respuesta; el contrato solo usa el número (`Solidez = grade·10`).
- `ts = now` (unix, i64). El oráculo es la fuente de frescura; el contrato rechaza `ts` > 5 min.

### `PricingSource` (interfaz)

```python
class CardValue(TypedDict):
    mint: str
    value_usd: int       # dólares enteros, > 0
    grade: int           # 1..=10
    grading_company: str  # 'PSA'|'CGC'|'BGS'

class PricingSource(Protocol):
    async def get_value(self, mint: str) -> CardValue: ...   # lanza ValueUnavailable si no se puede valorar
```

- **`MockPricingSource`**: valores deterministas derivados del mint (para dev/tests sin red). Configurable con un dict de overrides.
- **`CollectorCryptSource`**: `GET {CC_BASE_URL}/marketplace?search={mint}` → filtra el item con `nftAddress == mint` exacto (la búsqueda es por subcadena) → extrae `insuredValue`, `gradeNum`, `gradingCompany`. Aplica la **decisión 1** (solo insuredValue). Errores → `ValueUnavailable`. Caché en memoria por mint con TTL corto (default 120 s) para respetar el WAF de CC. Sin auth.

### Endpoints (FastAPI)

- `GET /health` → `{ status: "ok" }`.
- `GET /pubkey` → `{ oracle_pubkey: "<base58>" }` (la clave a registrar on-chain).
- `GET /attest?mint=<pubkey>` → `200`:
  ```json
  {
    "mint": "<base58>", "value_usd": 1200, "grade": 9, "grading_company": "PSA",
    "ts": 1780000000, "message_hex": "…", "signature_hex": "…", "oracle_pubkey": "<base58>"
  }
  ```
  - `404`/`422` si el mint es inválido o no existe; `409`/`422` (`ValueUnavailable`) si no hay `insuredValue` o `gradeNum`. El cliente usa `message_hex`+`signature_hex`+`oracle_pubkey` para construir la instrucción Ed25519 de la tx (índices auto-referenciales 0xFFFF, como en los tests litesvm).

### Gestión de claves

Keypair ed25519 del oráculo cargado de fichero (`ORACLE_KEY_PATH`, p.ej. 32 bytes de semilla en base58/hex) o generado y persistido si no existe (solo dev). En producción la clave vive fuera del repo y su pubkey se registra en el `Battle` on-chain. Nunca se commitea la clave.

## Estrategia de test (pytest)

- **`test_attestation.py`**: el mensaje construido casa byte-a-byte con `attestation_vectors.json`; la firma verifica con la pubkey (nacl); cambia con value/grade/ts/mint. Determinismo.
- **Vector compartido**: añadir un test en `onchain/programs/battle_arena/src/oracle.rs` que cargue `attestation_vectors.json` (copiado/symlink a una ruta accesible por el crate, o duplicado con un check de igualdad) y asserte que `attestation_msg(mint, value, grade, ts)` produce el mismo `message hex`. Así Python y Rust no se desincronizan.
- **`test_pricing_mock.py`**: determinista; overrides.
- **`test_pricing_cc.py`**: parsea `cc_card_sample.json` (forma real) → extrae value/grade/company; filtra `nftAddress` exacto entre varios resultados de `search`; rechaza cuando `insuredValue` es null/ausente; rechaza cuando `gradeNum` es null; redondeo half-up de `"124.50"`→125 y `"124.49"`→124. HTTP mockeado (respx/httpx mock) — sin red real en CI.
- **`test_api.py`** (FastAPI TestClient): `/attest` happy path con MockPricingSource; `/pubkey`; mint inválido → 422; `ValueUnavailable` → 409/422; la firma del endpoint verifica.

## Riesgos / notas

- **`insuredValue` solo en cartas vaulteadas**: muchas cartas quedarán fuera (no pueden jugar). Es el coste de la resistencia a manipulación; aceptado en la decisión 1. Documentar en errores claros al cliente.
- **Redondeo a dólares enteros**: el edge solo depende de ratios, así que perder los centavos no afecta al balance; se documenta y se testea el redondeo.
- **Rate-limit del WAF de CC**: para lookups de un mint es 1 request; con caché TTL y backoff ante 403/5xx es suficiente. No barremos el catálogo.
- **Frescura/anti-replay**: el `ts` lo pone el oráculo; el contrato ya rechaza atestaciones viejas (5 min). El binding por-batalla (nonce) queda como mejora pre-mainnet (ya anotado en los riesgos residuales del contrato).
- **Disponibilidad del oráculo = liveness del juego**: si el oráculo cae, no se pueden crear batallas. Para MVP es aceptable; producción querrá redundancia/rotación de clave.
