# Integración del Gacha de Collector Crypt

**Fecha:** 2026-06-10
**Estado:** Aprobado (conversación, 2026-06-10)

## Problema / objetivo

BattleArena exige poseer ya una carta gradeada para jugar on-chain. El Gacha de
Collector Crypt es la puerta de entrada barata: abrir un pack desde la app,
sacar una carta gradeada (NFT con `insuredValue` inmediato) y batirla al
momento. Cierra el funnel pull → batalla y añade retención.

## Investigación (verificada 2026-06-10)

- API documentada en `docs.collectorcrypt.com/gacha/api`. Base producción
  `https://gacha.collectorcrypt.com`, **devnet `https://dev-gacha.collectorcrypt.com`**.
- Toda llamada requiere header `x-api-key`; la clave se solicita en el Discord
  de Collector Crypt (confirmado por el repo oficial
  [gacha-starter](https://github.com/daxherrera/gacha-starter)).
- Flujo: `POST /api/generatePack` (tx parcialmente firmada, 50 USDC,
  `packType` p.ej. `pokemon_50`) → jugador firma → `POST /api/submitTransaction`
  → `POST /api/openPack {memo}` → `nft_address`, `nftWon` (metadata), `roll`,
  `rarity` (Epic/Rare/Uncommon/Common). Respuesta puede ser
  `WAITING_FOR_WEBHOOK` (pendiente → reintentar openPack).
- `GET /api/machines`: máquinas con `code`, `name`, `price`, `odds`,
  `tierRanges`, `stock`, `ev`, `instantBuyback`.
- La carta sacada aparece en `api.collectorcrypt.com/marketplace?search={mint}`
  con `insuredValue` inmediato (CC lo usa para su buyback de 72 h) →
  **el oráculo y el programa Anchor no cambian** (atestación de 81 bytes igual).
- VRF propio (ECVRF secp256k1 RFC 9381) verificable en
  `/api/vrf/verify?memo=...` — fuera del MVP.
- USDC devnet: faucet `spl-token-faucet.com`, mint
  `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr`.

## Decisiones de alcance (usuario)

1. **Integración completa**: abrir packs desde BattleArena (devnet primero).
2. **Lobby normal**: la carta de Gacha es una carta gradeada más; sin modo
   separado ni filtro. El edge logarítmico capado ya equilibra valores.
3. La `x-api-key` vive **solo en el backend** (proxy); nunca en el bundle web.

## Fuera del MVP (YAGNI)

Yolo packs (multi-compra), gifts, turbo mode, buyback in-app (enlace externo a
gacha.collectorcrypt.com), verificación VRF in-app, packs comprados/regalados
(flujo de firma de mensaje), puntos/freeSpins.

## Diseño

### Componente 1 — Backend: módulo proxy `gacha`

`backend/app/services/gacha.py` (cliente httpx) + endpoints en `main.py`
(mismo estilo que el resto: funciones dentro de `build_app`, `Depends`).

Config nueva en `Settings`:
- `gacha_base_url: str = "https://dev-gacha.collectorcrypt.com"`
- `gacha_api_key: str = ""` (vacío ⇒ Gacha deshabilitado)

Endpoints:
| Nuestro endpoint | Upstream | Auth | Notas |
|---|---|---|---|
| `GET /gacha/machines` | `GET /api/machines` | pública | caché en memoria 60 s; expone solo campos usados (code, name, price, odds, stock, ev, image) |
| `POST /gacha/generate-pack` | `POST /api/generatePack` | sesión wallet | body `{pack_type}`; `playerAddress` se fija a la wallet autenticada (nunca del body) |
| `POST /gacha/submit-tx` | `POST /api/submitTransaction` | sesión wallet | body `{signed_transaction}` (base64, validar tamaño ≤ 2 KB) |
| `POST /gacha/open-pack` | `POST /api/openPack` | sesión wallet | body `{memo}`; el backend registra memo→wallet al generar el pack y rechaza abrir memos de otra wallet (403) |

Errores: sin `gacha_api_key` ⇒ 503 `{"detail":"gacha_disabled"}`. Upstream
4xx/5xx/timeout ⇒ 502 con detalle saneado (nunca reenviar la respuesta cruda).
`WAITING_FOR_WEBHOOK` se reenvía tal cual (el frontend reintenta con backoff).
Rate limit: ventana simple en memoria por wallet (p.ej. 10 req/min al módulo
gacha), igual de simple que el limiter del oráculo.

Persistencia mínima: tabla `gacha_packs` (memo PK, wallet, pack_type,
created_at, opened_at NULL, nft_address NULL) — sirve para el binding
memo↔wallet y como historial.

### Componente 2 — Frontend: pantalla Gacha (modo on-chain)

- `src/onchain/gachaClient.ts`: cliente fino del proxy (machines,
  generatePack, submitTx, openPack con reintentos ante WAITING_FOR_WEBHOOK).
- `src/ui/screens/onchain/GachaScreen.tsx`: 
  - Lista de máquinas: precio, odds por rareza, stock, EV.
  - Comprar: generate-pack → firmar la tx base64 con la wallet AppKit →
    submit-tx → open-pack (polling con backoff hasta resultado).
  - Reveal animado por rareza (reutiliza el lenguaje visual del clash:
    charge → impacto → carta; color por rareza). Respeta
    `prefers-reduced-motion`.
  - Resultado: carta (imagen, nombre, rareza) + CTA **«Crear desafío con esta
    carta»** → navega al flujo de lobby existente con el mint preseleccionado
    (la atestación ya funciona). Enlace externo «Vender de vuelta (buyback)»
    a gacha.collectorcrypt.com.
  - Si `/gacha/machines` devuelve 503: estado deshabilitado con explicación.
- Entrada: pestaña/botón «Gacha» junto a Colección/Lobby tras conectar wallet.

### Componente 3 — Sin cambios

Oráculo, programa Anchor, SDK de instrucciones y motor de juego: intactos.

## Flujo de datos

```
GachaScreen → GET  /gacha/machines                    → CC /api/machines (caché 60s)
GachaScreen → POST /gacha/generate-pack {pack_type}    → CC /api/generatePack  (guarda memo↔wallet)
wallet firma tx base64
GachaScreen → POST /gacha/submit-tx {signed_transaction} → CC /api/submitTransaction
GachaScreen → POST /gacha/open-pack {memo}  (reintentos) → CC /api/openPack → nft_address + rarity
CTA → flujo lobby existente (oráculo atesta insuredValue del mint vía marketplace API)
```

## Manejo de errores

- Key ausente → 503 gacha_disabled (frontend: modo deshabilitado).
- Upstream caído/429/timeout → 502 saneado; frontend muestra reintento.
- `WAITING_FOR_WEBHOOK` → el frontend reintenta open-pack (backoff 2s/4s/8s…,
  máx ~2 min; después botón «seguir esperando»; el memo queda en historial).
- Firma rechazada por el usuario → cancelación limpia (el pack no se generó
  on-chain; no hay cobro sin firma).
- Memo de otra wallet → 403.

## Seguridad

- `x-api-key` solo server-side; nunca en el bundle ni en logs.
- `playerAddress` forzado a la wallet de la sesión (evita generar packs a
  nombre de terceros con nuestra key).
- Binding memo↔wallet en DB antes de permitir open-pack.
- Validación de tamaño/base64 en `signed_transaction`.
- Respuestas upstream nunca reenviadas crudas (whitelist de campos).

## Testing

- **Backend (pytest + respx):** machines (caché y mapping), generate-pack
  (fija playerAddress, guarda memo), submit-tx, open-pack (éxito, pendiente,
  memo ajeno → 403), sin key → 503, upstream 500 → 502, rate limit.
- **Frontend:** typecheck/build; lógica de reintentos del cliente con tests
  unitarios si se extrae pura.
- **Manual (devnet, requiere API key del Discord de CC):** USDC del faucet →
  comprar pack en dev-gacha vía la app → reveal → crear desafío con la carta
  → atestación y batalla completa.

## Estructura de archivos

```
backend/app/config.py                      (modificar — gacha_base_url, gacha_api_key)
backend/app/services/gacha.py              (nuevo — cliente httpx + caché + binding)
backend/app/models.py                      (modificar — tabla gacha_packs)
backend/app/main.py                        (modificar — 4 endpoints /gacha/*)
backend/tests/test_gacha.py                (nuevo)
src/onchain/gachaClient.ts                 (nuevo)
src/ui/screens/onchain/GachaScreen.tsx     (nuevo)
src/ui/screens/onchain/…navegación         (modificar — entrada «Gacha»)
```

## Riesgos abiertos

- Dependencia de la disponibilidad/ToS de la API del Gacha (misma clase de
  dependencia que ya aceptamos con la API de marketplace de CC).
- La API key tarda en llegar (Discord) → todo lo de backend/frontend se
  desarrolla y testea con mocks; la validación devnet queda gateada por la key.
- El DTO del Gacha puede cambiar; los tests respx fijan el contrato que usamos.
- `pokemon_50` cuesta 50 USDC también en devnet (faucet lo cubre).
