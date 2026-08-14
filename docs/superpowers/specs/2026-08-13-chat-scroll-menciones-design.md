# Chat: empezar por lo último y mencionar a los conectados — design

Date: 2026-08-13
Status: approved-pending-review

Dos cosas independientes del chat, que se entregan por separado. La primera es un defecto de
comportamiento; la segunda, funcionalidad nueva.

## Parte 1 — El chat empieza abajo y sigue el ritmo

### El problema

Al entrar, el chat enseña los mensajes **más antiguos**. No es que el scroll falle: es que **no
existe**. El contenedor de mensajes (`ChatDock.tsx:599`) tiene `overflowY: 'auto'`, la lista va del
más viejo al más nuevo (`useChat.ts` añade al final), y no hay ni un `ref` ni una llamada que lo
desplace. Así que se queda donde nace, arriba.

### Comportamiento

- **Al entrar y al recibir el historial**: colocado al final, sin animación.
- **Mensaje nuevo estando abajo**: baja suave.
- **Mensaje nuevo habiendo subido a leer**: NO se mueve nada, y aparece un botón flotante
  *"N mensajes nuevos"* que al pulsarlo baja del todo. Es lo que hacen Discord, Slack y Twitch, y
  evita lo único que de verdad molesta: perder el sitio mientras lees.
- **Al reabrir el panel colapsado** o al abrir el chat a pantalla completa en móvil: al final.

"Estar abajo" es un margen de **40 px**, no el fondo exacto:

```
scrollHeight - scrollTop - clientHeight <= 40
```

Con el fondo exacto, un píxel de inercia del ratón o del rebote táctil ya saca del modo seguir y el
chat deja de moverse sin que el jugador haya hecho nada.

### Cómo

Un hook propio, `src/ui/screens/Hub/useStickToBottom.ts`, que recibe la referencia del contenedor y
el número de mensajes, y devuelve `{ pegadoAlFondo, nuevosSinVer, bajarDelTodo }`. Va aparte para
poder probarlo sin montar el `ChatDock` entero, que arrastra socket, drops y perfil.

## Parte 2 — Menciones a los conectados

### Decisión de partida

Solo se puede mencionar a **quien está conectado en ese momento**. No es una limitación: es lo que
hace que la mención sirva, porque el aviso solo llega a quien está mirando. Y elimina lo más
peligroso del diseño anterior, un endpoint de búsqueda consultado en cada tecla:
`src/ui/useAliases.ts` documenta que una ráfaga contra `/users/{wallet}` **tumbó producción**, con
el backend en un proceso y consultas síncronas. Aquí no hay ni una petición nueva.

### Backend

**Presencia.** `ConnectionManager` (`backend/app/chat.py:94-113`) guarda hoy un `set` de sockets.
Pasa a guardar `socket → {wallet, nombre}`; el wallet y el nombre ya se calculan al conectar
(`main.py:2038-2049`), solo que se tiran.

Con eso:
- `online_users()` nuevo: lista de `{wallet, name}`, **sin duplicados por wallet**.
- El aviso `{"type": "presence", "online": N}` que ya se emite (`main.py:2054, 2075, 2078`) gana
  un campo `users`. No hace falta canal nuevo.
- `online_count()` pasa a contar **wallets distintas**, no sockets. Hoy quien tenga dos pestañas
  cuenta dos veces; es un arreglo que sale gratis con este cambio.

Los anónimos (sin token) siguen contando en `online` pero **no aparecen en `users`**: no se les
puede mencionar porque no hay a quién avisar.

**Mensajes.** `save_chat_message` (`chat.py:18`) y el modelo `ChatMessage` ganan `mentions`: JSON
con una lista de `{wallet, label}`. Es columna nueva sobre tabla existente, así que necesita
`app/db.py`, no basta con `create_all`.

**Validación, en el servidor.** El cliente manda las menciones, así que el servidor no se fía:
- Solo se aceptan wallets **conectadas en ese instante**.
- Máximo **5 por mensaje**, para que nadie se fabrique un `@todos` a mano.
- Lo que no pase el filtro se descarta en silencio; el mensaje se envía igual, sin esa mención.

### Frontend

- `useChat` expone `onlineUsers` a partir del aviso de presencia.
- **Autocompletado**: al escribir `@` se abre una lista con los conectados, filtrando por nombre
  **y por wallet**. Flechas para moverse, Enter para elegir, Escape para cerrar. Quien no tenga
  alias sale por su wallet abreviada, y se puede mencionar así.
- **Al enviar**, los `@etiqueta` se resuelven a wallets con la lista de presencia que ya está en
  memoria. Cero peticiones.
- **Al pintar**, la mención va resaltada y **enlaza al perfil**, igual que el nombre de quien
  habla. Si el mensaje te menciona a ti, se destaca entero.
- **Aviso**: si te mencionan con el chat colapsado, o estando arriba leyendo, salta un toast con
  acción para ir al mensaje.

### Por qué `mentions` va aparte del texto

Guardar solo `@juan` dentro del texto tiene dos fallos. El día que Juan se cambie el alias, el
mensaje miente. Y para volver a enlazarlo habría que resolver **nombre → wallet**, que es
justamente la búsqueda que hemos decidido no construir.

Guardando `{wallet, label}` al lado: el texto conserva lo que se dijo entonces, y el enlace sigue
apuntando a quien era. Al pintar se buscan las apariciones de `@label` y se enlazan a su `wallet`.

## Errores y casos límite

| Caso | Qué pasa |
|---|---|
| Mencionado se desconecta antes de enviar | El servidor descarta esa mención; el mensaje se envía igual |
| Dos conectados con el mismo alias | No puede pasar: `ux_users_alias_lower` es único |
| Mención a uno mismo | Se permite; no se avisa a nadie |
| Mensaje sin `mentions` (los ya guardados) | Se pinta como hoy, texto plano |
| Sesión cerrada | Sale en `online` pero no en `users`: no es mencionable |

## Tests

- **`useStickToBottom`**, con el contenedor simulado: se coloca abajo al entrar; baja con mensaje
  nuevo estando abajo; **NO** baja habiendo subido, y ahí cuenta los no vistos; el margen de 40 px
  se respeta en los dos sentidos.
- **Presencia**: `online_users` sin duplicados por wallet; `online_count` cuenta wallets y no
  sockets (dos pestañas del mismo jugador = 1); los anónimos no salen en `users`.
- **Validación de menciones**: se descarta la wallet no conectada; se recorta a 5; un mensaje con
  menciones inválidas se envía igual.
- **Autocompletado**: filtra por nombre y por wallet; Enter inserta; Escape cierra sin insertar.
- **Pintado**: la mención enlaza al perfil correcto; el mensaje que te menciona se destaca; un
  mensaje viejo sin `mentions` se pinta plano.

## Fuera de alcance

- Mencionar a desconectados.
- Avisos que sobrevivan a recargar la página (no hay tabla de menciones sin leer).
- `@aquí` y `@todos`.
