# Tiradas de gacha conducidas por servidor

**Fecha:** 2026-07-20
**Estado:** diseño aprobado, pendiente de plan de implementación

## Objetivo

Mover la ejecución de las tiradas de gacha del navegador al servidor, como ya hacen Pack
Battle y Battle Royale. El servidor valida el saldo, reserva el USDC, y ejecuta las tiradas
en una tarea de fondo con firma delegada de Privy. El jugador puede cerrar la pestaña: las
tiradas se completan igual y las cartas acaban en su cuenta.

Esto resuelve tres problemas a la vez:

1. **Fondos reservados sin liberar.** Reservar USDC desde un flujo conducido por el
   navegador exigiría un TTL con barrido, porque el navegador puede desaparecer y dejar la
   reserva viva para siempre. Con el servidor conduciendo, un `finally:` garantiza la
   liberación, igual que en batallas.
2. **Sin validación de servidor.** Hoy todas las tiradas pasan por `POST /gacha/yolo`, que
   **no** comprueba ni saldo ni si la máquina está apagada. Solo lo comprueba el frontend,
   que es bypasseable con `curl`.
3. **Fragilidad del cliente.** Fallos de firma, 429 a mitad del bucle o un poll abortado
   dejan la tirada a medias sin que el usuario sepa qué pasó.

## Fuera de alcance

El **sub-proyecto B** (sistema de "interacciones no vistas": resumen al volver a la página,
ocultar el USDC hasta verlas, elegir reveal completo o resultado directo en batallas) se
diseña por separado. Este spec solo garantiza que el resultado de una tirada quede
**persistido y consultable**, que es lo que B necesitará.

## Contexto (estado actual)

- Todas las tiradas usan `POST /gacha/yolo`
  ([backend/app/main.py:610](../../../backend/app/main.py#L610)), incluso al abrir un solo
  sobre: `GachaVault` solo importa `generateYoloPacks` y no ramifica por cantidad
  ([src/ui/screens/gacha/GachaVault.tsx:182](../../../src/ui/screens/gacha/GachaVault.tsx#L182)).
- `/gacha/yolo` **no** llama a `_machine_price` (409 si la máquina está Off) ni a
  `_require_available` (402 si no hay saldo). `POST /gacha/generate-pack`
  ([backend/app/main.py:406](../../../backend/app/main.py#L406)) sí hace ambas, igual que la
  creación y el join de batallas.
- El navegador firma cada tx con la wallet embebida (`signTransactionBase64`) y hace él
  mismo el bucle de `submit-tx` + `open-pack`.
- El servidor **ya sabe** ejecutar una tirada por su cuenta:
  [pack_engine.py:141-156](../../../backend/app/services/pack_engine.py#L141) hace
  `generate_pack` → `signer.sign_solana(wallet_id, tx)` → `submit_tx` → `open_pack` para
  cada jugador de una batalla.
- `GachaPack` ([backend/app/models.py:75](../../../backend/app/models.py#L75)) ya persiste
  el resultado de cada sobre: `nft_address`, `insured_value`, `name`, `opened_at`, `price`.
- `Reservation` ([backend/app/models.py:162](../../../backend/app/models.py#L162)) +
  `reserve()` / `reserved_total()` / `release_reservations()` ya implementan el ledger de
  retenciones. `_require_available` (saldo on-chain − reservado) lo aplican tanto las
  batallas como `POST /users/me/withdraw`
  ([backend/app/main.py:782](../../../backend/app/main.py#L782)), así que **reservar bloquea
  el retiro** sin trabajo adicional.
- Existe el patrón `useDelegationGate` / `DelegationGate`, usado hoy por el retiro de USDC y
  el de NFTs, para exigir delegación antes de una acción que firma el servidor.
- El WebSocket es anónimo y global: `ConnectionManager` solo expone `connect`, `disconnect`
  y `broadcast` ([backend/app/chat.py:89](../../../backend/app/chat.py#L89)). No hay envío
  dirigido a un usuario.

## Decisiones tomadas

| Decisión | Elección | Motivo |
|---|---|---|
| Qué significa "reembolso" | **Liberar la reserva** (contable, sin mover USDC) | Los sobres no ejecutados nunca llegaron a pagar. El gacha no tiene escrow: el dinero va directo del jugador a CC, un pago por sobre. No hay nada que devolver on-chain. |
| Fallo definitivo de un sobre | **Abortar el resto** | Los fallos aquí son casi siempre sistémicos (CC caído, sin saldo, delegación revocada). Seguir solo quema más fallos. Encaja con el resumen "7 de 10". |
| Progreso en el cliente | **Polling de un endpoint** | No toca el WS compartido (que exigiría autenticarlo y añadir envío por usuario), y el mismo endpoint sirve luego al sub-proyecto B. |
| Reinicio del backend a media tirada | **Abortar y liberar**, no reanudar | Los sobres pendientes nunca pagaron. Coherente con la política de fallo. |
| Tabla de reservas | **Reusar `Reservation`** con `battle_id = "gacha:{pull_id}"` | Funciona sin migración y `release_reservations()` sirve sin cambios. El coste es de nomenclatura: el campo se llama `battle_id` guardando algo que no es una batalla. Renombrarlo a `ref_id` queda como mejora opcional, fuera de este spec. |

## Arquitectura

### 1. `POST /gacha/pull` — validar, reservar, lanzar

Body `{machine_code: str, count: int, turbo: bool}`. Auth: `wallet` vía `current_user` y
`wallet_id` vía `current_user_id`.

Validaciones **síncronas antes de responder**, para que el usuario vea el error al instante:

| Comprobación | Respuesta si falla |
|---|---|
| `privy_signer` configurado | `503 gacha_unavailable` |
| `_machine_price(machine_code)` — máquina encendida | `409 máquina no disponible` |
| `_require_available(wallet, count × precio)` | `402 USDC disponible insuficiente` |

Si todo pasa, en una sola transacción de DB:

1. Crea `GachaPull(status="running")`.
2. Crea **`count` filas** `Reservation(wallet, battle_id=f"gacha:{pull_id}", amount=price_each)`
   — una por sobre, no una sola por el total. Ver "Liberación incremental" más abajo.
3. `asyncio.create_task(_run_pull_bg(pull_id))`.
4. Responde **`202 {pull_id}`**.

Consume **1 hit** del rate-limit del gacha (`_gacha_throttle`), igual que hoy `/gacha/yolo`.

### 2. `_run_pull_bg(pull_id)` — el worker

Para cada sobre `i` de `count`:

```
pack   = await gacha.generate_pack(player_address=wallet, pack_type=machine_code, turbo=turbo)
signed = await signer.sign_solana(wallet_id, pack["transaction"])
await gacha.submit_tx(signed)          # ← el dinero sale on-chain AQUÍ
release_one_reservation(s, f"gacha:{pull_id}")   # ← libera UNA fila (= este sobre)
res    = await gacha.open_pack(pack["memo"])
persistir en GachaPack (nft_address, insured_value, name, opened_at, price, pull_id)
```

**Liberación incremental:** la reserva se crea como `count` filas de `price_each`, y se
libera **una fila** en cuanto el `submit_tx` de ese sobre confirma. Ese es el momento exacto
en que el USDC sale de la wallet, así que el saldo on-chain ya lo refleja. Sin esto habría
doble contabilidad: tras enviar 3 de 10 sobres el saldo sería $70 y la reserva seguiría
siendo $100, dando un disponible de −$30.

Se hace con filas y no con importes parciales porque el esquema de `Reservation` no soporta
liberación parcial: `release_reservations(session, battle_id)` marca como `released` **todas**
las activas de ese id. Con una fila por sobre, "liberar un sobre" y "liberar el resto" son la
misma operación sobre distinto número de filas, sin tocar el esquema.

**Nueva función en `reservations.py`:** `release_one_reservation(session, ref_id) -> int`,
que marca como `released` la fila activa más antigua de ese `ref_id` y devuelve su importe
(0 si no quedaban). Es la única adición al servicio de reservas.

**Reintentos:** 3 intentos por sobre con espera creciente. Si un sobre falla
definitivamente: `status="aborted"`, se guarda `error`, y **no se intentan los siguientes**.

**Cierre garantizado:**

```python
finally:
    release_reservations(s, f"gacha:{pull_id}")   # libera lo no gastado
    marcar GachaPull como done|aborted + finished_at
```

Un `finally:` se ejecuta siempre, aunque el worker reviente. Es la misma red que usan las
batallas ([main.py:709](../../../backend/app/main.py#L709),
[735](../../../backend/app/main.py#L735)) y es lo que hace innecesario un TTL.

### 3. `GET /gacha/pull/{id}` — estado y resultados

Autenticado. Devuelve `403` si la tirada no pertenece a la wallet que consulta.

```json
{
  "id": "...", "status": "running|done|aborted",
  "count": 10, "done": 7, "turbo": true,
  "results": [ { "nft_address": "...", "name": "...", "insured_value": 12.5,
                 "rarity": "Rare", "auto_sold": false, "buyback_amount": null } ],
  "refunded_base_units": 30000000,
  "error": "..."
}
```

**No se aplica `_gacha_throttle`**: el cliente lo consulta en bucle mientras dura la tirada.
Es exactamente el error que causó los 429 (`open-pack` estaba throttleado y se polleaba).

Este endpoint es el que el sub-proyecto B usará para el resumen al volver.

### 4. Resume al arrancar

Réplica de `_resume_orphaned_battles`
([main.py:1336](../../../backend/app/main.py#L1336)). En `@app.on_event("startup")`: por
cada `GachaPull` en `running`, liberar su reserva y marcarlo `aborted`. No se reanuda.

Un sobre que quedó pagado pero sin abrir permanece como `GachaPack` con `opened_at = NULL`,
que es el estado "pendiente" que ya existe hoy y que el usuario puede reintentar abrir.

### 5. Frontend

- `handleYolo` pasa a: `POST /gacha/pull` → polling de `GET /gacha/pull/{id}` → alimentar el
  overlay de progreso y el reveal **con los resultados del servidor**. Los componentes de
  reveal y de resumen no cambian de forma: reciben los mismos campos que hoy.
- La acción se envuelve en `gate.requireDelegation(...)`.
- El check de saldo del cliente pasa de comparar contra el saldo bruto a comparar contra
  **`disponible = usdc − reservado`** (`reserved` ya lo sirve `GET /users/me/balance`), con
  el mensaje "USDC disponible insuficiente". Esto es UX; la protección real es la del
  servidor.

**Consecuencia aceptada:** el gacha pasa a **exigir delegación**, igual que los retiros de
USDC y de NFTs. Quien la rechace no podrá tirar; hoy sí puede, porque firma su navegador.

### 6. Limpieza

`POST /gacha/yolo` y `generateYoloPacks` del cliente quedan sin uso y **se eliminan**. Es
justo el endpoint sin validaciones que motivó este trabajo: mantener dos caminos al dinero,
uno de ellos abierto, es peor que borrarlo.

`POST /gacha/generate-pack` (la ruta HTTP) **se conserva sin cambios**. Hoy su único llamante
es `GachaScreen`, que vive en `OnchainFlow` y no está ruteado en `App.tsx`, así que está sin
uso — pero **sí valida** máquina y saldo, con lo que no es un agujero y borrarla no es
urgente. Queda fuera de alcance.

Nótese que el motor de batallas **no** usa esa ruta: llama directamente al método del
servicio `GachaService.generate_pack`
([pack_engine.py:141](../../../backend/app/services/pack_engine.py#L141)), que no se ve
afectado por ningún cambio de rutas.

**No hace falta cablear `turbo` en ninguna ruta HTTP.** El método del servicio ya lo acepta
(`generate_pack(..., turbo: bool = False)`,
[gacha.py:115](../../../backend/app/services/gacha.py#L115)) y el worker se lo pasa
directamente. El cableado de `GeneratePackBody` que se barajó antes de este diseño es
innecesario.

## Modelos

**Nuevo `GachaPull`:**

| Campo | Tipo | Notas |
|---|---|---|
| `id` | str, PK | uuid |
| `wallet` | str, index | dueño |
| `machine_code` | str | |
| `count` | int | sobres pedidos |
| `turbo` | bool | |
| `price_each` | int | USDC base units por sobre |
| `status` | str, index | `running` \| `done` \| `aborted` |
| `error` | str, nullable | motivo del abort |
| `created_at` | datetime | |
| `finished_at` | datetime, nullable | |

**`GachaPack`** += `pull_id: str, nullable, index` (nullable para las filas históricas).

**`Reservation`**: sin cambios de esquema. Se crean `count` filas con
`battle_id = "gacha:{pull_id}"` y `amount = price_each`, para permitir la liberación
incremental descrita arriba.

## Manejo de errores

| Situación | Comportamiento |
|---|---|
| Máquina Off / sin saldo / sin signer | Rechazo síncrono (409 / 402 / 503). No se crea ni tirada ni reserva. |
| Fallo puntual de CC en un sobre | 3 reintentos con espera creciente |
| Fallo definitivo de un sobre | `aborted`, no se siguen los demás, `finally` libera lo no gastado |
| Excepción inesperada en el worker | `finally` libera igual; `status=aborted` con `error` |
| Reinicio del backend a media tirada | Resume de arranque: `aborted` + liberar |
| Sobre pagado pero sin abrir | Queda `opened_at = NULL` → vía de pendientes existente |
| Delegación revocada | `sign_solana` falla → cuenta como fallo de sobre → abort |

## Tests

- **Validación:** 409 con máquina Off; 402 cuando `saldo − reservado < count × precio`; 503
  sin `privy_signer`. En los tres casos no se crea `GachaPull` ni `Reservation`.
- **Reserva:** se crean `count` filas de `price_each` (retención total `count × precio`);
  `POST /users/me/withdraw` devuelve 402 mientras están activas.
- **`release_one_reservation`:** libera exactamente una fila y devuelve su importe; sobre un
  `ref_id` sin filas activas devuelve 0 sin reventar.
- **Liberación incremental:** tras N `submit_tx` confirmados, la reserva restante es
  `(count − N) × precio` (no hay doble contabilidad).
- **Abort:** un sobre que falla 3 veces deja `status=aborted`, `done < count`, los sobres
  restantes sin intentar, y la reserva liberada por completo.
- **`finally`:** una excepción inesperada en el worker libera la reserva igualmente.
- **Resume:** un `GachaPull` en `running` al arrancar queda `aborted` con la reserva
  liberada.
- **Aislamiento:** `GET /gacha/pull/{id}` de otra wallet devuelve 403.
- **Turbo:** `turbo=true` se propaga hasta `generate_pack`; los sobres auto-vendidos llegan
  con `auto_sold=true` y no requieren llamada a buyback.
