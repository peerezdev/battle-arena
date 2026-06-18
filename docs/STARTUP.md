# BattleArena — Puesta en marcha de los servicios

Cómo levantar cada servicio de BattleArena en local (devnet). Tres servicios que se
ejecutan + un programa on-chain que solo se compila/despliega.

## Mapa de servicios

| Servicio  | Carpeta    | Puerto | Arranque                                   | Entorno          |
|-----------|------------|--------|--------------------------------------------|------------------|
| Oráculo   | `oracle/`  | 8787   | `uvicorn app.main:app --port 8787`         | `oracle/.env`    |
| Backend   | `backend/` | 9090   | `uvicorn app.main:app --port 9090`         | `backend/.env`   |
| Frontend  | raíz       | 5173   | `npm run dev`                              | `.env` (raíz)    |
| Programa on-chain | `onchain/` | — | `cargo build-sbf` / `anchor deploy` (devnet) | `onchain/Anchor.toml` |

**Orden recomendado de arranque:** Oráculo → Backend → Frontend. El programa on-chain
no es un servicio que corra: se compila/despliega una vez y el frontend/backend apuntan
a él por su Program ID.

## Requisitos

- **Node** ≥ 20 (probado con v24) y **npm**.
- **Python 3.9+** (los venvs del repo usan 3.9.6).
- **Toolchain Solana/Anchor** (solo si vas a compilar/desplegar el programa): `solana`,
  `anchor`, `cargo build-sbf` (probado con solana-cargo-build-sbf 3.1.10).
- Los venvs ya existen en `backend/.venv` y `oracle/.venv`. Si no, créalos (ver más abajo).

## Setup inicial (una sola vez)

### 1. Variables de entorno
Cada servicio lee su `.env` (gitignored). Copia el ejemplo y rellena:

```bash
cp .env.example .env                 # frontend (raíz)
cp backend/.env.example backend/.env
cp oracle/.env.example oracle/.env
```

- **`.env` (raíz, frontend):** `VITE_PRIVY_APP_ID`, `VITE_SOLANA_RPC`, `VITE_PROGRAM_ID`,
  `VITE_ORACLE_URL=http://localhost:8787`, `VITE_BACKEND_URL=http://localhost:9090`,
  `VITE_STAKE_MINT`, `VITE_TREASURY`, `VITE_ORACLE_PUBKEY`, `VITE_CC_COLLECTION_MINT`
  (opc.), `VITE_DAS_RPC` (opc., RPC con DAS para el inventario).
- **`backend/.env`:** `DATABASE_URL` (por defecto SQLite local), `CHAIN_SOURCE`,
  `SOLANA_RPC_URL`, `PROGRAM_ID`, `ELO_START`, `ELO_K`, `SESSION_TTL`, `CORS_ORIGINS`
  (p.ej. `["http://localhost:5173"]`), `GACHA_BASE_URL` (vacío ⇒ gacha deshabilitado),
  `GACHA_API_KEY` (opcional; solo si el entorno lo requiere, p.ej. mainnet con key),
  `PRIVY_APP_ID`, `PRIVY_JWKS_URL`.
- **`oracle/.env`:** `PRICING_SOURCE` (`mock` por defecto, o `collectorcrypt`),
  `ORACLE_KEY_PATH` (por defecto `oracle_key.json`), `CC_BASE_URL`, `PRICING_CACHE_TTL`,
  `RATE_LIMIT_PER_MIN`, `CORS_ORIGINS`.

> El `VITE_ORACLE_PUBKEY` del frontend **debe** coincidir con la clave pública del oráculo
> (el frontend rechaza atestaciones de oráculos desconocidos). Consulta `oracle/README.md`
> para obtener el pubkey del oráculo y cópialo al `.env`.

### 2. Dependencias

```bash
# Frontend (raíz)
npm install

# Backend
python3 -m venv backend/.venv && backend/.venv/bin/pip install -r backend/requirements.txt

# Oráculo
python3 -m venv oracle/.venv && oracle/.venv/bin/pip install -r oracle/requirements.txt
```

(Si los venvs ya existen, salta este paso.)

## Arranque por servicio

### Oráculo (puerto 8787)
Firma atestaciones ed25519 del `insured_value` de las cartas. En `mock` es determinista
(no necesita API key). La clave ed25519 se autogenera en `oracle_key.json` si no existe
(**solo dev**; nunca se commitea).

```bash
cd oracle
.venv/bin/uvicorn app.main:app --port 8787
# Fuente de precios real (cuando haya key de CC):
# PRICING_SOURCE=collectorcrypt .venv/bin/uvicorn app.main:app --port 8787
```

Healthcheck: `curl -s http://localhost:8787/health` (o consulta `oracle/README.md` para el
endpoint del pubkey).

### Backend (puerto 9090)
FastAPI + SQLAlchemy (SQLite local). Inicializa la BD al arrancar. Sirve lobby/ELO, el
proxy del gacha y el chat de lobby por WebSocket. Auth vía Privy identity token.

```bash
cd backend
.venv/bin/uvicorn app.main:app --port 9090
```

> **Importante:** arráncalo **desde `backend/`** — `config.py` lee `.env` con ruta relativa.

Healthcheck: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9090/health` → `200`.

Notas:
- **Gacha:** habilitado sin API key en devnet (keyless). Los endpoints `/gacha/*` funcionan
  con solo `GACHA_BASE_URL` configurado. Configura `GACHA_API_KEY` solo si un entorno futuro
  lo requiere (p.ej. mainnet). Para deshabilitar el gacha completamente, deja `GACHA_BASE_URL`
  vacío (los endpoints responderán `503`).
- **Privy:** sin `PRIVY_APP_ID`, los endpoints autenticados responden `503`. Con él, `401`
  si falta token (correcto).

### Frontend (puerto 5173)
Vite + React.

```bash
npm run dev          # http://localhost:5173
# otros:
npm run build        # build de producción (tsc -b && vite build)
npm test             # tests (vitest)
```

> Pruébalo en **`http://localhost:5173`**, no a través de un túnel https: el chat conecta a
> `ws://localhost:9090` y el navegador bloquearía el contenido mixto desde https.

### Programa on-chain (`onchain/`, no es un servicio)
Anchor. Program ID actual: `89qGDjXGcV9zi3968DtRLNzBn5KXhYmSGJkjKntksCdk`.

```bash
cd onchain
cargo build-sbf            # compila el .so
cargo test                # tests LiteSVM in-process (no necesita validador)
# Desplegar a devnet (requiere wallet con SOL de devnet):
# solana config set --url devnet && anchor deploy
```

Detalles de despliegue/IDL en `docs/ONCHAIN.md`.

## Quick start (todo de golpe)

Tres terminales (foreground, fácil de ver logs y cortar con Ctrl-C):

```bash
# Terminal 1 — Oráculo
cd oracle && .venv/bin/uvicorn app.main:app --port 8787

# Terminal 2 — Backend
cd backend && .venv/bin/uvicorn app.main:app --port 9090

# Terminal 3 — Frontend
npm run dev
```

Verificación rápida:
```bash
curl -s http://localhost:8787/health        # oráculo
curl -s http://localhost:9090/health        # backend → {"status":"ok"}
# abre http://localhost:5173 en el navegador
```

## Troubleshooting

- **Puerto ocupado:** `lsof -ti tcp:9090 | xargs kill` (cambia el puerto según el servicio).
- **El backend no lee el `.env`:** asegúrate de arrancarlo desde `backend/` (ruta relativa).
- **El chat no deja escribir:** activa los *identity tokens* en el dashboard de Privy
  (User management → Authentication → Advanced → "Return user data in an identity token") y
  prueba en `http://localhost:5173` (no en túnel https).
- **No aparece la embedded wallet / el balance es el de Phantom:** cierra sesión y vuelve a
  entrar para que Privy provisione la embedded (config `createOnLogin: 'all-users'`).
- **Inventario (perfil) vacío:** en devnet necesita `VITE_CC_COLLECTION_MINT` (mint de
  colección de CC en devnet) y un `VITE_DAS_RPC` con soporte DAS (p.ej. Helius); con el RPC
  público de devnet no hay DAS y el inventario sale vacío (de forma controlada).
- **Gacha responde 503:** ocurre solo si `GACHA_BASE_URL` está vacío (kill-switch). En devnet
  no se requiere `GACHA_API_KEY`; el gacha funciona sin ella.

## Seguridad (recordatorio)
- `oracle_key.json`, los `.env` y los `.venv` están en `.gitignore` y **nunca** se commitean.
- El `PRIVY_APP_SECRET` vive solo en `backend/.env` (server-side), nunca en el frontend.
- En producción: `https`/`wss` (no `http`), clave del oráculo fuera del repo, y revisar el
  hardening pendiente antes de mainnet.
