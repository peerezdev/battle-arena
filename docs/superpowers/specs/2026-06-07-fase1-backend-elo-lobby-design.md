# Fase 1 (ciclo 3) — Backend: ELO + lobby de partidas abiertas

**Fecha:** 2026-06-07
**Estado:** Diseño aprobado, listo para plan de implementación
**Alcance:** El backend de orquestación: usuarios identificados por wallet, rating **ELO**, y un **lobby de partidas abiertas** (modelo desafío) donde cada partida muestra la diferencia de nivel con el creador y respeta los límites de ELO que éste fije.

## Objetivo

Dar la capa social/discovery sobre las batallas on-chain: que un jugador **cree una partida abierta** (apostando), que aparezca listada para todos, que cada potencial rival vea **su diferencia de ELO** con el creador (aviso de nivel) y pueda unirse si cumple los **límites de ELO** del creador. El ELO se deriva **solo** de batallas liquidadas on-chain, así que no es falseable.

## Decisiones aprobadas

1. **Identidad = wallet + firma.** Usuario = pubkey de Solana. Auth challenge-response: nonce del servidor → el cliente lo firma con la wallet → token de sesión. Las acciones que cambian estado requieren ese token. Alias mostrable opcional.
2. **ELO solo desde batallas liquidadas on-chain.** El backend deriva ganador/empate leyendo la cuenta `Battle` (estado `Settled`/`Closed` + `winner`/`is_draw`) vía un **lector de cadena abstraído** (`ChainSource`: mock para dev/tests, lector Solana real para devnet). Trustless: nadie reporta resultados.
3. **Sin matchmaking automático.** Lobby abierto tipo desafío: crear → listar → unirse. El ELO es **informativo/aviso**, no una cola.
4. **El creador fija límites de ELO** (`min_elo`/`max_elo` opcionales, cotas absolutas). Es una regla **off-chain** (capa de lobby), no una garantía on-chain (el contrato no conoce el ELO). Documentado como tal.

## No-objetivos (otros ciclos / futuro)

- Matchmaking por cola / emparejado automático.
- Frontend/wallet adapter (es otro ciclo; aquí solo API).
- Anti-colusión / detección de win-trading avanzada (mención en el SPEC; fuera del MVP).
- Hacer el límite de ELO una garantía on-chain (mejora futura del contrato).
- Despliegue real / indexer continuo de `getProgramAccounts` (el lector real se deja esqueletado).

## Stack

Python / FastAPI, **SQLite** en dev (SQLAlchemy 2.x; Postgres en prod vía la misma capa), PyNaCl (verificación de firmas ed25519), based58 (pubkeys), pytest. Servicio nuevo en `backend/`. Testeable 100% offline con `MockChainSource` y peticiones firmadas en los tests.

## Identidad / auth

- `GET /auth/nonce?wallet=<pubkey>` → `{ nonce }` (aleatorio por sesión; el backend lo guarda con TTL corto, asociado a la wallet). *(El nonce se genera con un RNG del servidor; en tests se inyecta un `nonce_fn` determinista.)*
- `POST /auth/verify { wallet, signature_hex }` → el backend reconstruye el mensaje de auth (p.ej. `"BattleArena auth: <nonce>"`), verifica la firma ed25519 contra `wallet`, y emite un **token de sesión** (string opaco firmado/persistido con TTL). → `{ token }`.
- Endpoints autenticados leen `Authorization: Bearer <token>` → resuelven la wallet.
- `POST /users/me/alias { alias }` (auth) → fija alias (validado: longitud, caracteres).

## ELO

- Elo estándar. Constantes (config): `ELO_START=1200`, `ELO_K=32`. Empate = score 0.5 para ambos.
- `expected(a, b) = 1 / (1 + 10**((b-a)/400))`; `new_a = a + K*(score_a - expected(a,b))`, redondeado a entero.
- Se aplica **una sola vez por batalla** (flag `elo_applied` en `matches`) → idempotente aunque se llame `sync` varias veces.
- Usuarios nuevos (primera vez que aparecen) se crean con `ELO_START`.

## Lobby de partidas abiertas

- **Crear/registrar:** `POST /matches { battle_pubkey, min_elo?, max_elo? }` (auth). El backend llama a `ChainSource.get_battle(battle_pubkey)`, exige `phase == 'Created'` y `player_a == wallet del token` (el creador es quien dice ser y la batalla on-chain existe). Persiste el match con `status='open'`, `creator`, `stake`, `min_elo`, `max_elo`. Rechaza si la batalla no existe / no está en Created / el creador no coincide.
- **Listar:** `GET /matches/open?viewer=<wallet?>` → lista de matches `open`, cada uno con: `battle_pubkey`, `creator`, `creator_alias`, `creator_elo`, `stake`, `min_elo`, `max_elo`, y si `viewer` está dado: `viewer_elo`, `elo_diff = viewer_elo - creator_elo`, `gap_label`, `joinable` (¿`viewer_elo` dentro de `[min_elo, max_elo]`?).
  - `gap_label` por `abs(diff)`: `<100 parejo`, `100..300 notable`, `>300 gran diferencia`.
- **Sincronizar:** `POST /matches/{battle_pubkey}/sync` → relee `ChainSource.get_battle`:
  - si `player_b` ya está y `status=='open'` → `status='joined'`, guarda `opponent`.
  - si `phase in ('Settled','Closed')` y `!elo_applied` → determina `winner`/`is_draw`, **aplica ELO una vez**, `status='settled'`, `elo_applied=true`, sella historial.
  - idempotente.
- **Comparar ELO (feature central):** `GET /elo/compare?a=<wallet>&b=<wallet>` → `{ elo_a, elo_b, diff, gap_label }`.

## Lector de cadena (`ChainSource`)

```python
class BattleState(TypedDict):
    battle: str
    player_a: str
    player_b: Optional[str]   # None si nadie se unió
    stake: int
    phase: str                # 'Created'|'Committing'|'Revealing'|'RoundResolved'|'Settled'|'Closed'
    winner: Optional[str]     # wallet ganadora, o None
    is_draw: bool

class ChainSource(Protocol):
    async def get_battle(self, battle: str) -> BattleState: ...   # BattleNotFound si no existe
```

- **`MockChainSource`**: dict en memoria de batallas (sembradas en tests; con helpers para "avanzar" una batalla a joined/settled).
- **`SolanaChainSource`** (esqueleto, no es la ruta testeada): vía RPC `getAccountInfo(battle_pubkey)` + decodificar la cuenta Anchor `Battle` (discriminador de 8 bytes + layout Borsh: `player_a`, `player_b`, …, `phase`, `winner`, `is_draw`, …). El mapeo de offsets se documenta tomándolo de `onchain/.../state.rs`. Se valida contra devnet cuando el programa esté desplegado.

## Modelo de datos (SQLAlchemy)

- **`users`**: `wallet` (PK, base58), `alias` (nullable), `elo` (int, default 1200), `games_played` (int, default 0), `created_at`.
- **`matches`**: `battle_pubkey` (PK), `creator` (FK users.wallet), `opponent` (nullable), `stake` (int), `min_elo` (nullable), `max_elo` (nullable), `status` ('open'|'joined'|'settled'), `winner` (nullable), `is_draw` (bool), `elo_applied` (bool default false), `created_at`, `settled_at` (nullable).
- **`rating_history`** (para el historial): `id`, `wallet`, `battle_pubkey`, `elo_before`, `elo_after`, `result` ('win'|'loss'|'draw'), `ts`.
- `GET /users/{wallet}` → `{ wallet, alias, elo, games_played }`. `GET /users/{wallet}/history` → de `rating_history`.

## Endpoints (resumen)

`GET /health` · `GET /auth/nonce` · `POST /auth/verify` · `POST /users/me/alias` · `GET /users/{wallet}` · `GET /users/{wallet}/history` · `POST /matches` · `GET /matches/open` · `POST /matches/{battle}/sync` · `GET /elo/compare` · `GET /leaderboard` (top por ELO).

## Cumplimiento off-chain del límite de ELO

El backend **no endosa** (y la UI oculta/gris) una partida para un viewer fuera de `[min_elo,max_elo]` (`joinable=false`), pero como `join_battle` es on-chain y el contrato no conoce el ELO, un actor podría unirse saltándose el lobby. Aceptado para el MVP (el lobby es la vía normal). Mejora futura: añadir el gate al contrato o exigir una firma de "endoso" del backend en `join_battle`.

## Estrategia de test (pytest)

- **Auth**: nonce → firma real con PyNaCl (keypair de test) → verify emite token; firma inválida → 401; token requerido en endpoints protegidos.
- **ELO**: cálculo (caso conocido: 1200 vs 1200, gana A → +16/−16 con K=32), empate (0.5), idempotencia (aplicar dos veces no duplica), creación de usuario nuevo con 1200.
- **Lobby**: `POST /matches` verifica vía `MockChainSource` (rechaza si no Created / creador no coincide / no existe); `GET /matches/open` calcula `elo_diff`, `gap_label` y `joinable` respecto a `min_elo/max_elo`; bordes de los umbrales.
- **Sync**: open→joined cuando aparece player_b; joined→settled aplica ELO una vez y escribe historial; doble sync no re-aplica.
- **Compare/leaderboard**: diff y gap_label; orden por ELO.
- Todo offline con `MockChainSource` y DB SQLite en memoria/temp por test.

## Riesgos / notas

- **Límite de ELO no es hard on-chain** (documentado arriba).
- **Lector real de cadena** es esqueleto: decodificar la cuenta Anchor `Battle` en Python debe validarse contra una batalla real en devnet; el MVP usa Mock. Riesgo aislado tras la interfaz.
- **Auth con token**: para el MVP, token opaco con TTL en DB/memoria; producción querrá JWT firmado y rotación.
- **`elo_applied` evita doble conteo** pero asume que `sync` es el único camino que aplica ELO; mantenerlo así.
- **Anti-colusión/win-trading** (cuentas que se enfrentan solo entre sí para mover ELO) queda fuera del MVP; el ELO trustless on-chain mitiga el resultado falso, no la colusión.
