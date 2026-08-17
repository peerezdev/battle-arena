# Battle Arena — Backend (ELO + lobby de partidas abiertas)

Backend de orquestación de la **Fase 1**: usuarios identificados por **wallet**, rating **ELO** derivado *solo* de batallas liquidadas on-chain, y un **lobby de partidas abiertas** (modelo desafío) donde cada partida muestra la diferencia de nivel con el creador y respeta los límites de ELO que éste fije.

**Estado:** MVP. Corre sobre un lector de cadena mock (`MockChainSource`); el lector Solana real está esqueletado, a validar contra devnet. Sin dinero real.

## Arranque

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pytest -q                          # 32 tests, totalmente offline
uvicorn app.main:app --port 9090   # SQLite local (battlearena.db, gitignored)
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
| GET | `/auth/privy/me` | ✓ (Bearer identity token) | sub del usuario de Privy |
| POST | `/users/me/alias {alias}` | ✓ | fija alias |
| GET | `/users/search?q=&limit=` | ✓ | jugadores cuyo alias o wallet EMPIEZA por `q`; con `q` vacía, los conectados primero y luego los que tienen alias. Tope duro de 8 y throttle propio. Alimenta el autocompletado de `/tip` en el chat |
| POST | `/users/me/tip` | ✓ | propina en USDC a otro jugador registrado, mínimo MIN_TIP_USDC, limitada por TIP_RATE_LIMIT, respeta saldo reservado, bloqueada mientras juegas una royale, sin comisión. Al terminar avisa al destinatario por su websocket (`type: "tip"`), dirigido y nunca por broadcast: quién le da dinero a quién no se publica. Si el aviso falla, se registra y la propina sigue siendo un 200, porque el dinero ya se movió. |
| GET | `/users/{wallet}` | — | perfil (lectura pura; default 1200 si no existe) |
| GET | `/users/{wallet}/history` | — | historial de rating |
| POST | `/matches {battle_pubkey, min_elo?, max_elo?}` | ✓ | registra partida abierta (verificada on-chain) |
| GET | `/matches/open?viewer=` | — | lobby con diferencia de nivel y `joinable` |
| POST | `/matches/{battle}/sync` | — | reconcilia estado on-chain (aplica ELO al liquidar) |
| GET | `/elo/compare?a=&b=` | — | comparación de ELO + `gap_label` |
| GET | `/leaderboard?limit=` | — | top por ELO |

### WebSocket `/ws/chat`

El token va en la query (`?token=`). Marcos del servidor al cliente:

| `type` | Contenido | Notas |
|---|---|---|
| `history` | `messages[]` | Los últimos 50, al conectar |
| `message` | `{user, wallet?, text, ts, mentions?}` | Uno nuevo |
| `presence` | `{online, users[]}` | Al entrar o salir cualquiera |
| `drop`, `drops_history` | tiradas del gacha | |
| `error` | `login_required`, `rate_limited` | |
| `tip` | `{from, fromName, amount}` | SOLO al destinatario (`send_to_wallet`), nunca broadcast: quién le da dinero a quién no se publica |

**`presence.users`** es `[{wallet, name}]` y es la lista de **mencionables**: sin duplicados (dos
pestañas del mismo jugador son una entrada) y **sin anónimos**, porque a quien no ha iniciado
sesión no hay forma de avisarle. `online` sí los cuenta: están mirando aunque no puedan hablar.

**`mentions`** es `[{wallet, label}]` y viaja en los dos sentidos. Va **aparte del texto** a
propósito: guardar solo `@juan` dentro del mensaje haría que mintiera el día que Juan se cambie el
alias, y volver a enlazarlo exigiría resolver nombre → wallet, una búsqueda que no existe (y que no
se quiere: una ráfaga de consultas por tecleo ya tumbó producción una vez).

Del cliente al servidor: `{text, mentions?}`. **El servidor no se fía de `mentions`**: descarta las
wallets que no estén conectadas en ese instante y recorta a 5 (`_menciones_validas`). Lo descartado
se tira en silencio y el mensaje se envía igual.

`GET /users` y `GET /elo/compare` son **lecturas puras**: no crean usuarios. Un usuario se persiste cuando actúa (registra partida, recibe rating, fija alias).

## Decisiones clave

- **Identidad = identity token de Privy.** El frontend manda el identity token de Privy como Bearer; el backend lo verifica (JWKS ES256, `aud`=App ID) y extrae la **embedded Solana wallet** de `linked_accounts` (`current_user`). Esa dirección es la identidad para ELO/matches. Las acciones que cambian estado usan el token (no se confía en una wallet del body).
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
| `GACHA_BASE_URL` | `https://dev-gacha.collectorcrypt.com` | URL base del API del Gacha; producción: `https://gacha.collectorcrypt.com` |
| `GACHA_API_KEY` | — | API key para el Gacha (solicitar en Discord de Collector Crypt); sin ella, `/gacha/*` responde 503 con `gacha_disabled` |

## Arquitectura

```
backend/app/
  main.py             # FastAPI: factory create_app + endpoints + deps (db, current_user)
  config.py, db.py    # settings + SQLAlchemy (Base, engine, session)
  models.py           # User, Match, RatingHistory
  elo.py              # expected_score, updated_ratings, gap_label (puro)
  privy.py            # PrivyVerifier (verifica identity/access token, extrae embedded Solana wallet)
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
- **28 endpoints son `async def` y no esperan nada** (entre ellos `get_user`, el del incidente del
  14:30). Con la base de datos síncrona, un `async def` que consulta **bloquea el bucle de eventos**
  y deja el proceso sin atender nada, ni `/health`; declarados `def`, FastAPI los ejecuta en su pool
  de hilos. Quitarles el `async` es borrar una palabra en cada uno, pero hay que comprobar
  endpoint a endpoint que de verdad no esperan nada. Ojo con la intuición: pasar la base a
  asíncrona NO lo arregla — con SQLite no hay espera que soltar y `aiosqlite` hace lo mismo en un
  hilo por debajo. `GET /users/search` ya se declaró `def` a propósito.
- **La búsqueda de usuarios va por PREFIJO con RANGO, nunca con `LIKE`.** Medido con
  `EXPLAIN QUERY PLAN`: `LIKE` hace `SCAN` de la tabla entera **incluso por prefijo**, porque SQLite
  no aplica esa optimización a un índice de expresión; solo el rango usa `ux_users_alias_lower`.
  Hay un test que comprueba el plan de la consulta: si alguien la cambia, se pone rojo.
- **Anti-colusión / win-trading** (cuentas que se enfrentan solo entre sí para mover ELO) fuera del MVP; el ELO trustless on-chain evita resultados falsos, no la colusión.
- **Postgres**: la capa es SQLAlchemy; en prod cambiar `DATABASE_URL` y verificar las columnas `DateTime(timezone=True)`.
