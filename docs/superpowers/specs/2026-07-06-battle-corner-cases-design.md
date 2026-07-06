# Corner cases de Pack Battle / Battle Royale — diseño

**Fecha:** 2026-07-06
**Alcance:** backend (pytest). Frontend en una tanda posterior.

## Contexto

El backend ya cubre bien los happy paths y muchos voids (~130 tests), pero una
auditoría del flujo completo encontró tres agujeros con dinero real:

1. **Pull pagada y nunca resuelta.** Si un jugador firma y paga su pull y
   Collector Crypt no la abre dentro del presupuesto de polling
   (`open_max_attempts × open_delay ≈ 60s`), la batalla se anula, pero
   `refund_pack_void` / `refund_royale_void` solo devuelven pulls con
   `nft_address` o `auto_sold`. El jugador pierde lo pagado; si la carta se
   mintea tarde, cae al escrow (`alt_player_address`) y queda huérfana.
2. **Royale + restart no implementado.** `_resume_orphaned_battles` (startup,
   `main.py`) solo retoma pack battles; una royale huérfana en `running` queda
   así para siempre: sin ganador, buy-ins bloqueados, y `royale_locked_total`
   contándola indefinidamente en el balance del usuario.
3. **Carrera cancel-vs-join.** El endpoint de cancel toma el snapshot de
   jugadores a refundear ANTES de llamar a `cancel_battle`; un jugador que
   entra entre el snapshot y el flip de estado se queda sin refund.

Decisiones tomadas con el usuario:

- Bloques backend primero; frontend después.
- El resume de royale **continúa la partida** (no void-por-defecto).
- Las pulls sin resolver se **reconcilian** re-consultando el memo (no solo se
  documentan).

## Bloque 1 — Reconciliación de pulls sin resolver

### Componente

Nuevo módulo `backend/app/services/reconcile.py`:

```
async def reconcile_unresolved_pulls(session, battle, *, gacha,
                                     sleep_fn=None, max_attempts=5, delay=3.0) -> int
```

- Para cada `BattlePull` del battle con `memo` y sin `nft_address`: re-consulta
  `gacha.open_pack(memo)` con polling acotado. Si resuelve, persiste
  `nft_address / insured_value / grade / rarity / year / name / auto_sold /
  buyback_amount` (mismos campos que el engine).
- Devuelve cuántas pulls quedaron resueltas. **Nunca lanza** (misma filosofía
  que refund/settle: reintentos acotados + log sin secretos).

```
async def reconcile_and_refund_voided(session, battle, *, gacha, <closures on-chain>) -> None
```

- Orquesta: `reconcile_unresolved_pulls` y después el refund correspondiente al
  modo (`refund_pack_void` / `refund_royale_void`). Al ejecutar la
  reconciliación ANTES del refund, el refund existente ya ve la pull completa y
  la devuelve con su mecánica actual, sin cambios en su lógica.

### Idempotencia: columna `BattlePull.refunded`

- Nueva columna booleana (default `False`).
- `refund_pack_void` / `refund_royale_void` la ponen a `True` cuando el
  transfer/USDC de esa pull se envía con éxito, y **saltan** pulls ya
  `refunded` — así el barrido de startup puede re-ejecutar refunds sin
  duplicar transferencias.
- Los barridos posteriores pueden re-ejecutar `refund_royale_void` completo:
  las pulls individuales están guardadas por `refunded`, los buybacks marcan
  `refunded` al completarse, y el reparto de sobrante (split entre vivos) lee
  el balance ACTUAL del escrow — tras el void original queda ~0, así que una
  re-ejecución solo reparte dinero nuevo (p. ej. el buyback de una carta
  reconciliada tarde).

### Puntos de ejecución

1. **Void en caliente** (la batalla se anula durante la ejecución normal): el
   wiring (`run_pack_battle_live` / `run_royale_live`) ejecuta la
   reconciliación antes del refund; si quedan pulls sin resolver, programa una
   tarea diferida (`asyncio.create_task` + sleep de ~5 min) que reintenta
   reconciliar + refundear las pendientes.
2. **Startup**: además del resume, un barrido busca batallas `voided` con
   pulls (memo sin `nft_address`, o resueltas pero no `refunded`) e intenta
   reconciliar + refundear. Sin límite temporal hacia atrás: la tabla es
   pequeña y la condición del filtro es precisa.
3. **Resume de royale** (Bloque 2) la usa para la ronda interrumpida.

## Bloque 2 — Resume de Battle Royale (continúa la partida)

### Componentes

- `resume_royale(...)` en `royale_engine.py` (I/O inyectado, como `run_royale`).
- `resume_royale_live(...)` en `pack_orchestration.py` (mismas closures que
  `run_royale_live`).
- `main.py`: el startup lanza `resume_royale_live` para royales huérfanas en
  `running` (sustituye el warning "royale resume not automated yet").

### Reconstrucción de estado (todo desde la DB)

- `players` = `BattlePlayer` por `joined_at`; `remaining` = sin
  `eliminated_round`; `accumulated[w]` = suma de `insured_value` de las pulls
  resueltas de `w`.
- Ronda en curso `R` = última `BattleRound.round_number` + 1 (o 1 si no hay).
- `round_nfts` de la ronda `R` se reconstruye con las pulls resueltas de `R`
  (ordenadas por `joined_at` del jugador, igual que el loop original) para que
  el client seed del tie-break sea idéntico al que habría salido sin restart.

### Ronda interrumpida

Para cada jugador de `remaining` en orden:

- **Ya tiene pull resuelta en R** → se salta (no re-tira, no re-fondea).
- **Tiene pull con memo sin resolver en R** → reconciliación (Bloque 1) sobre
  ese memo. Si resuelve → se usa y se continúa. Si no resuelve → **void** +
  `reconcile_and_refund_voided` (no se puede re-tirar: la pull pudo haberse
  pagado; re-generar otra cobraría dos veces).
- **No tiene pull en R** → fondear + tirar como en el loop normal, con el
  guard anti doble-fondeo (abajo).

Completada la ronda R → eliminación normal (mismo código) → el loop continúa
rondas siguientes hasta settle. Settle y fee reutilizan
`settle_cards_to_winner` / `collect_battle_fee`; `battle.fee_charged` ya
protege contra doble cobro si el restart pilló el settle a medias.

### Guards específicos de resume

- **Anti doble-fondeo:** antes de `distribute`, si `confirm_usdc(w,
  price_base)` ya es `True` (el distribute pre-crash llegó), se salta el
  distribute. Trade-off aceptado: un jugador que casualmente tuviera ≥
  price_base propio pagaría esa pull de su bolsillo una vez; en la práctica
  las wallets embebidas no acumulan saldo suelto.
- **Seed de SOL:** si el escrow ya tiene SOL (`sol_balance > 0`), no se
  re-siembra.
- **Check de fondeo total:** NO se re-ejecuta en resume (parte del pool ya se
  distribuyó; el expected del check original ya no aplica). Un escrow
  realmente drenado hará fallar el primer distribute/confirm → void limpio +
  refund.
- Cualquier excepción del loop → void + `reconcile_and_refund_voided`, igual
  que `run_royale`.

## Bloque 3 — Fixes menores + catálogo de tests

### Fix: carrera cancel-vs-join (royale)

En `cancel_pack_battle` (`main.py`), leer la lista de jugadores a refundear
DESPUÉS de que `cancel_battle` valide y flipee `lobby → cancelled`. Así un
join que se cuele antes del flip queda incluido en los refunds, y uno
posterior al flip falla en `join_battle` (status ya no es `lobby`) y se
auto-refundea por el camino existente.

### Catálogo de tests nuevos (además de los de los bloques 1 y 2)

Pack Battle:

- Void a mitad de bundle (pull k falla tras k−1 éxitos) → refund devuelve las
  cartas ya sacadas a sus dueños (integración run + refund).
- Restart entre el fill y la creación del escrow (running, sin escrow, sin
  pulls) → resume anula limpio, refund no-op, reservas liberadas.
- Restart a mitad de settle (algunas cartas ya transferidas) → resume no
  re-transfiere (queda `transferred=False` + log de stuck para las que ya
  salieron del escrow), el sweep barre lo que quede y la fee no se cobra dos
  veces.
- Empate sin `server_seed` → `voided` (nivel engine).
- Todos los pulls auto-sold → ganador por insured_value, ninguna carta se
  transfiere, sweep al ganador.

Battle Royale:

- Resume entre rondas → continúa y settlea con el ganador determinista
  esperado.
- Resume a mitad de ronda → los que ya tiraron no repiten; los que no, tiran;
  eliminación y client seed idénticos a los de una partida sin restart.
- Resume con pull sin resolver que resuelve al re-poll → continúa.
- Resume con pull sin resolver que nunca resuelve → void + refund completo.
- Guard anti doble-fondeo: jugador ya fondeado no recibe segundo distribute.
- Startup lanza el resume para royales huérfanas (nivel API, como
  `test_pack_lobby_api`).
- Escrow drenado al resume → void limpio.

Reconciliación:

- Void en caliente con pull sin resolver → la tarea diferida reconcilia y
  devuelve la carta/buyback al puller.
- Barrido de startup sobre una batalla `voided` antigua con pull reconciliable
  → refund solo de lo pendiente (`refunded` evita duplicados).
- `refunded` idempotente: segundo barrido no re-transfiere nada.

Cancel:

- Jugador que entra durante el cancel queda refundeado (post-fix).

## Manejo de errores

Todo lo nuevo sigue la filosofía existente: reconcile/refund/resume **nunca
lanzan** hacia el caller del startup, reintentos acotados con `sleep_fn`
inyectable, logs con wallet + battle id + error (sin secretos).

## Fuera de alcance (esta tanda)

- Tests de frontend (vitest): reveal de batalla anulada, WaitingRoom tras
  restart, etc. — siguiente tanda.
- Múltiples workers de uvicorn: los locks (`_buyin_lock`), rate-limits y
  tasks en memoria son por-proceso; el despliegue actual es single-worker.
  Documentado como limitación conocida, no se arregla aquí.
- Migración de DB formal: la columna `refunded` se añade al modelo; en SQLite
  dev se recrea/altera manualmente como en cambios de esquema anteriores.
