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

Sin autenticación, como el resto de lecturas de perfil.

- **`q` vacío** → primera página: **conectados primero** (los sabe `_chat_mgr.online_users()`),
  después el resto por alias. Eso es el "enséñame el listado" de antes de escribir nada.
- **`q` con letras** → filtra por alias que lo contenga (insensible a mayúsculas, apoyado en
  `ux_users_alias_lower`) y por wallet que empiece por `q`.
- **`limit` con tope duro de 8**, se pida lo que se pida. Un desplegable no puede enseñar miles, y
  el tope es también lo que mantiene barata la consulta.

Responde `[{wallet, alias, online}]`. `online` viene de la presencia, no de la base.

**Este endpoint es el punto delicado del diseño.** `src/ui/useAliases.ts` documenta que una ráfaga
contra `/users/{wallet}` tumbó producción: el backend corre en UN proceso y consulta la base de
forma síncrona. Lo que se hace aquí es distinto —**una** consulta indexada y acotada, no decenas en
paralelo—, pero el cliente además la frena: mínimo de espera de **250 ms** tras dejar de teclear y
caché por consulta. Sin ese freno esto es exactamente la misma forma de fallo.

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
