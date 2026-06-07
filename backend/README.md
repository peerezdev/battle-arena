# Battle Arena — Backend (ELO + lobby de partidas abiertas)

Backend de orquestación de la **Fase 1**: usuarios identificados por **wallet**, rating **ELO** derivado *solo* de batallas liquidadas on-chain, y un **lobby de partidas abiertas** (modelo desafío) donde cada partida muestra la diferencia de nivel con el creador y respeta los límites de ELO que éste fije.

**Estado:** MVP. Corre sobre un lector de cadena mock (`MockChainSource`); el lector Solana real está esqueletado, a validar contra devnet. Sin dinero real.

## Arranque

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pytest -q                          # 32 tests, totalmente offline
uvicorn app.main:app --port 8080   # SQLite local (battlearena.db, gitignored)
```

## Modelo: lobby abierto, sin matchmaking

1. El creador lanza on-chain `initialize_battle` (deposita) y **registra** la partida en el backend (`POST /matches`, autenticado). El backend **verifica vía el lector de cadena** que la Battle existe, está en `Created` y `player_a == creador`.
2. `GET /matches/open?viewer=<wallet>` lista las partidas abiertas con la apuesta, el ELO del creador, **tu diferencia de nivel** (`elo_diff` + `gap_label`) y si eres **`joinable`** (tu ELO dentro de `[min_elo, max_elo]`).
3. Quien quiera se une on-chain (`join_battle`). `POST /matches/{battle}/sync` reconcilia el estado: marca rival cuando alguien entra, y al liquidarse **aplica el ELO una sola vez** (idempotente) y guarda historial.

El **ELO es informativo/aviso**, no una cola de emparejamiento.

## Endpoints

| Método | Ruta | Auth | Qué |
|---|---|---|---|
| GET | `/health` | — | ping |
| GET | `/auth/nonce?wallet=` | — | nonce a firmar |
| POST | `/auth/verify {wallet, signature_hex}` | — | verifica firma ed25519 → token de sesión |
| POST | `/users/me/alias {alias}` | ✓ | fija alias |
| GET | `/users/{wallet}` | — | perfil (lectura pura; default 1200 si no existe) |
| GET | `/users/{wallet}/history` | — | historial de rating |
| POST | `/matches {battle_pubkey, min_elo?, max_elo?}` | ✓ | registra partida abierta (verificada on-chain) |
| GET | `/matches/open?viewer=` | — | lobby con diferencia de nivel y `joinable` |
| POST | `/matches/{battle}/sync` | — | reconcilia estado on-chain (aplica ELO al liquidar) |
| GET | `/elo/compare?a=&b=` | — | comparación de ELO + `gap_label` |
| GET | `/leaderboard?limit=` | — | top por ELO |

`GET /users` y `GET /elo/compare` son **lecturas puras**: no crean usuarios. Un usuario se persiste cuando actúa (registra partida, recibe rating, fija alias).

## Decisiones clave

- **Identidad = wallet + firma.** Login challenge-response: `GET /auth/nonce` → firmar `"BattleArena auth: <nonce>"` con la wallet → `POST /auth/verify` → token Bearer. Nonce de **un solo uso**; token con TTL. Las acciones que cambian estado usan el token (no se confía en una wallet del body → no puedes actuar por otra).
- **ELO solo desde batallas liquidadas on-chain.** El resultado (ganador/empate) se lee de la cuenta `Battle` (`Settled`/`Closed`) vía `ChainSource`. Trustless: nadie reporta resultados. Elo estándar (inicio 1200, K=32, empate 0.5).
- **Sin matchmaking automático**: lobby tipo desafío (crear → listar → unirse).
- **Límite de ELO del creador (`min_elo`/`max_elo`)** = **gate off-chain** (capa de lobby). El backend/UI marcan `joinable=false` fuera de rango, pero el contrato no conoce el ELO — técnicamente alguien podría unirse on-chain saltándose el lobby. Aceptado para el MVP; hacerlo garantía dura sería una mejora futura del contrato.

## Configuración (env / `.env`)

| Var | Default | Qué |
|---|---|---|
| `DATABASE_URL` | `sqlite:///battlearena.db` | SQLite en dev; Postgres en prod (misma capa SQLAlchemy) |
| `CHAIN_SOURCE` | `mock` | `mock` o `solana` (real, esqueletado) |
| `SOLANA_RPC_URL` | devnet | RPC para el lector real |
| `PROGRAM_ID` | — | program id del contrato |
| `ELO_START` / `ELO_K` | 1200 / 32 | parámetros ELO |
| `SESSION_TTL` | 3600 | TTL del token (s) |

## Arquitectura

```
backend/app/
  main.py             # FastAPI: factory create_app + endpoints + deps (db, current_wallet)
  config.py, db.py    # settings + SQLAlchemy (Base, engine, session)
  models.py           # User, Match, RatingHistory
  elo.py              # expected_score, updated_ratings, gap_label (puro)
  auth.py             # AuthService (nonce, verify firma ed25519, token)
  chain/
    base.py           # BattleState, ChainSource, BattleNotFound
    mock.py           # MockChainSource (dev/tests)
    solana.py         # SolanaChainSource (esqueleto, a validar en devnet)
  services/
    users.py          # get_or_create_user, set_alias, leaderboard, history, read_user_view
    matches.py        # register_match, list_open, sync_match (+ ELO idempotente)
```

## Riesgos / pendientes (pre-producción)

- **Lector Solana real esqueletado**: decodificar la cuenta Anchor `Battle` en Python debe validarse contra una batalla real en devnet; el MVP usa `MockChainSource`. Riesgo aislado tras la interfaz `ChainSource`.
- **Límite de ELO no es garantía on-chain** (documentado arriba).
- **Token de sesión** opaco en memoria para el MVP; producción querrá JWT firmado + rotación, y persistencia/expiración robusta.
- **Anti-colusión / win-trading** (cuentas que se enfrentan solo entre sí para mover ELO) fuera del MVP; el ELO trustless on-chain evita resultados falsos, no la colusión.
- **Postgres**: la capa es SQLAlchemy; en prod cambiar `DATABASE_URL` y verificar las columnas `DateTime(timezone=True)`.
