# Comandos de chat, empezando por `/tip` — design

Date: 2026-08-14
Status: approved-pending-review

## Objetivo

Comandos escritos en el chat, al estilo de Discord: `/comando arg1 arg2`, con autocompletado por
argumento. El primero es `/tip <usuario|wallet> <cantidad>`.

La pieza de comandos se construye como **registro**, no como un `if` para `/tip`: añadir `/help` o
`/roll` mañana tiene que ser una entrada más, no otra pantalla.

## Contexto (código actual)

- **La propina ya existe entera**: `POST /users/me/tip` y `TipModal`
  (`src/ui/components/TipModal.tsx`), con su validación de mínimo, saldo reservado, royale en
  juego y throttle. Este comando **no reimplementa nada de eso**: es un atajo para llegar al modal.
- **Están APAGADAS** por el interruptor de ayer: `tips_enabled` en el backend y `TIPS_ENABLED`
  (`src/featureFlags.ts`) en el frontend, los dos en false.
- **El autocompletado de menciones** ya existe (`MentionAutocomplete.tsx`, `mentions.ts`) y se
  reutiliza: misma lista, mismo teclado.
- **La presencia** da los conectados por WebSocket (`presence.users`).
- **NO existe ninguna búsqueda de usuarios.** Solo `GET /users/{wallet}`, que va al revés.
- `users.alias` tiene índice único en minúsculas (`ux_users_alias_lower`, `models.py:25`), así que
  buscar por alias es barato.

## Decisiones

| | |
|---|---|
| Qué hace Enter | Abre el `TipModal` **ya relleno**; el jugador confirma ahí |
| Autocompletado del destinatario | Conectados **y desconectados** |
| Fuente | Endpoint nuevo `GET /users/search` |
| Un texto que empiece por `/` | **Nunca** se envía como mensaje |
| Con las propinas apagadas | `/tip` no aparece y escribirlo dice que no está disponible |

### Por qué el modal y no enviar directo

Es dinero e irreversible. El modal ya traduce cada error a algo accionable (saldo, mínimo, royale
en juego, sesión), y enviar desde el chat obligaría a duplicar toda esa traducción en otro sitio,
que es justo como se desincronizan los mensajes.

## Backend

### `GET /users/search?q=&limit=8`

**Requiere sesión** (mismo token que el chat) y lleva throttle por wallet, como el de las propinas.
No es coherente con `GET /users/{wallet}`, que es público, y es a propósito: aquella devuelve UNA
fila que ya conoces; esta ejecuta una búsqueda, y dejarla abierta pone una consulta al alcance de
cualquiera contra un backend de un solo proceso.

- **`q` vacío** → primera página: **conectados primero** (los sabe `_chat_mgr.online_users()`),
  después el resto por alias.
- **`q` con letras** → **búsqueda por PREFIJO**, con rango, en alias y en wallet.
- **`limit` con tope duro de 8**, se pida lo que se pida. Un desplegable no puede enseñar miles.

Responde `[{wallet, alias, online}]`. `online` sale de la presencia, no de la base.

#### Por qué prefijo y con rango, y no `LIKE`

Medido con `EXPLAIN QUERY PLAN` sobre la base real:

| Consulta | Plan |
|---|---|
| `lower(alias) LIKE '%an%'` | `SCAN users` |
| `lower(alias) LIKE 'an%'` | `SCAN users` |
| `lower(alias) >= 'an' AND lower(alias) < 'ao'` | **`SEARCH users USING INDEX ux_users_alias_lower`** |

O sea que `LIKE` **no usa el índice ni siquiera por prefijo**: SQLite no aplica esa optimización a
un índice de expresión. Solo el rango lo aprovecha. Una versión anterior de este documento decía lo
contrario, y era falso.

Con 16 usuarios da igual; con 100.000, un escaneo por búsqueda deja al backend —un proceso, consultas
síncronas— sin atender nada más mientras dura. Es la forma del incidente que documenta
`src/ui/useAliases.ts`, entrando por otra puerta.

El precio de buscar por prefijo: escribir `ana` encuentra a `anabel` pero **no** a `juanana`. Es lo
que hace casi todo el mundo, y se acepta a cambio de que la consulta sea barata para siempre.

El cliente además frena: espera de **250 ms** tras dejar de teclear y caché por consulta.

#### Se declara `def`, no `async def`

FastAPI ejecuta un endpoint **`def` en su pool de hilos** y uno **`async def` en el bucle de
eventos**. Con la base de datos síncrona (SQLAlchemy clásico, sin `AsyncSession` ni `aiosqlite`),
un `async def` que consulta la base **bloquea el bucle entero** mientras dura: el proceso deja de
atender todo, incluido `/health`. Eso es literalmente lo que pasó a las 14:30.

Medido en este repositorio: **62 endpoints `async def`, 0 síncronos**, y **28 de ellos no esperan
nada** (`get_user` entre ellos, el del incidente). Quitarles el `async` es borrar una palabra y que
FastAPI los mueva al pool, pero son 28 sitios y va aparte, con su propio ciclo. Lo que sí se aplica
aquí es no añadir el número 63.

Nota, porque es contraintuitivo: convertir la base a asíncrona **no** arreglaría esto. Con SQLite
no hay espera que soltar —es un fichero, no un servidor—, y `aiosqlite` hace lo mismo en un hilo
por debajo. La vía correcta con esta base es el pool de hilos, no `async`.

### Lo que este diseño acepta a sabiendas

- **La base de jugadores pasa a ser listable.** Con `q` vacío devolviendo a todos, cualquiera con
  sesión puede paginar quién juega y con qué wallet. Hoy hay que conocer la wallet para consultar
  a alguien. Las wallets ya son públicas en la cadena y el ranking enseña a los mejores, así que no
  se revela un secreto, pero sí cambia de "consultable de uno en uno" a "descargable".
- **El freno vive en el cliente.** Si alguien quita la espera o la caché en una refactorización, el
  patrón malo vuelve sin que salte nada. El throttle del servidor es la red de debajo.
- **Se puede pagar a quien no era**, con dos alias parecidos. Lo mitigan el modal, que pide
  confirmar, y la wallet debajo del nombre en la lista. No desaparece.

## Frontend

### El registro de comandos (`src/ui/screens/Hub/commands.ts`)

```ts
interface Comando {
  nombre: string                    // 'tip'
  descripcion: string               // lo que se lee en la lista
  args: { nombre: string; tipo: 'usuario' | 'texto' }[]
  disponible: () => boolean         // /tip: TIPS_ENABLED
}
```

Y un parser puro, que es lo que se prueba:

```ts
parseComando(texto, cursor) →
  | null                                        // no empieza por '/'
  | { nombre: string; args: string[]; argActivo: number; desde: number }
```

`argActivo` es lo que permite ofrecer usuarios en el primer argumento y nada en el segundo. Se
calcula con el CURSOR, no con el final del texto, igual que en las menciones.

### En el chat

- Escribir `/` abre la lista de comandos disponibles.
- En el primer argumento de `/tip`, la lista pasa a ser de usuarios (`GET /users/search`), con un
  punto verde en los conectados. Dar propina a un desconectado es válido, el dinero llega igual,
  pero conviene verlo.
- Se reutiliza `MentionAutocomplete`: mismo teclado (flechas, Enter, Escape) y mismo aspecto. Gana
  una marca opcional de conectado.
- Enter con la lista abierta elige. Enter con el comando completo abre el modal.
- Un comando desconocido (`/loquesea`) responde en el chat, **en local**, sin mandar nada al
  servidor.

### Rellenar el `TipModal`

`TipModal` **borra el importe** cada vez que cambia `open` o `to.wallet` (el bloque de `resetKey`,
`TipModal.tsx:88-95`), así que no basta con pasarle una prop: el reset la pisaría.

Gana `amountInicial?: string`, y ese valor entra en la `resetKey`. Así abrir el modal dos veces
seguidas con importes distintos rellena las dos, y el reset sigue haciendo su trabajo (que existe
por un fallo real: sin él, una propina pendiente de delegación acababa pagándose al destinatario
anterior).

## Errores

Todos se responden **en el chat**, sin abrir el modal ni llamar al backend:

| Caso | Qué se dice |
|---|---|
| `/tip` sin argumentos | Cómo se usa: `/tip <user> <amount>` |
| Usuario no encontrado | Que no existe ese jugador |
| Cantidad no numérica o ≤ 0 | Que la cantidad no vale |
| `/tip` con las propinas apagadas | Que no está disponible ahora |
| Comando desconocido | Que no existe, y cuáles hay |
| Sin sesión | Los comandos no se ofrecen |

Lo que **no** se valida aquí: mínimo, saldo, royale en juego. Eso ya lo dice el modal, y repetirlo
sería mantener dos verdades.

## Tests

- **Parser**: `/tip` solo, con un argumento, con dos, con espacios de más; `argActivo` según dónde
  esté el cursor; texto que no empieza por `/`; comando desconocido.
- **Búsqueda**: `q` vacío devuelve conectados primero; filtra por alias sin distinguir mayúsculas;
  filtra por principio de wallet; el tope de 8 se respeta aunque se pida más.
- **Freno**: teclear rápido no dispara una petición por tecla (se espera a que pare).
- **Chat**: `/` abre la lista de comandos; en el primer argumento ofrece usuarios; un texto que
  empieza por `/` no se envía como mensaje; con las propinas apagadas `/tip` no aparece.
- **Modal**: se abre con destinatario e importe puestos; abrirlo dos veces con importes distintos
  rellena los dos.

## Fuera de alcance

- `/help`, y cualquier comando que no sea `/tip`.
- Historial de comandos con flecha arriba.
- Autocompletar el importe.
