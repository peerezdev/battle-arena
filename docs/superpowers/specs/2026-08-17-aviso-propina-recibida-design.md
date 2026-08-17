# Aviso al recibir una propina — design

Date: 2026-08-17
Status: implemented

## Objetivo

Que a quien recibe una propina le salte un aviso en el momento, diciendo **quién** se la ha
mandado y **cuánto**.

## Estado de partida (comprobado)

- El endpoint `POST /users/me/tip` ya funciona y guarda una fila en `tips`.
- `ConnectionManager` (`backend/app/chat.py`) **ya sabe qué socket es de cada wallet**: se añadió
  para el autocompletado de menciones (`identify`, `online_users`).
- Pero **solo tiene `broadcast`**, que va a todos. No hay envío dirigido.
- `me_tip` y `_chat_mgr` viven los dos dentro de `create_app`, así que el endpoint lo alcanza sin
  fontanería nueva.
- El frontend ya tiene `showToast` y `useChat` ya reparte los marcos del socket por su `type`.

## Decisiones

| | |
|---|---|
| Quién lo ve | **Solo el destinatario** |
| Si está desconectado | Se pierde. El dinero ya está en su wallet |
| Acción al pulsar | Ninguna: solo texto |
| Varias pestañas | Salta en todas |

### Por qué solo al destinatario y nunca a la sala

Ya se decidió que un `/tip` no se publica en el chat: anunciarlo diría a todo el mundo **quién le
da dinero a quién y cuánto**. El aviso hereda esa regla; si se emitiera por `broadcast`, se estaría
publicando por la puerta de atrás.

### Por qué se pierde si no está conectado

Es lo mismo que se decidió para las menciones, y aquí importa menos: **el dinero ya está en su
wallet** con o sin aviso. Guardarlo para enseñárselo al volver exigiría una columna de "visto", su
migración y un endpoint para marcarlo, y no es lo que falta para que esto sirva.

### Por qué salta en todas las pestañas

Deduplicarlo exigiría estado compartido entre pestañas para algo que dura tres segundos. No se
justifica.

## Backend

`ConnectionManager` gana:

```python
async def send_to_wallet(self, wallet: str, msg: dict) -> int:
    """Manda `msg` a TODOS los sockets de esa wallet (puede tener varias pestañas).

    Devuelve a cuántos llegó. Los sockets que fallan se descartan, igual que en `broadcast`: un
    socket muerto no puede impedir que el aviso llegue al resto.
    """
```

En `me_tip`, **después** de que `withdraw_usdc` devuelva firma y la fila de `Tip` esté guardada:

```python
{"type": "tip", "from": wallet, "fromName": <alias o wallet abreviada>, "amount": <float USDC>}
```

Va **envuelto en un try/except que solo registra**. Un fallo al avisar no puede convertirse en un
error para quien envió: la propina ya está hecha y no se puede deshacer, así que responder un 500
después de mover el dinero sería mentir sobre lo que ha pasado.

El nombre lo resuelve el backend, que es quien tiene los alias (`read_user_view`); si no hay
alias, la wallet abreviada con `abbreviate()`, igual que en el chat.

## Frontend

`useChat` reconoce `type === 'tip'` y llama a `showToast` con
**`{fromName} sent you {amount} USDC`**, sin acción.

El aviso solo puede venir del servidor por el socket autenticado, así que nadie puede fabricarse
uno: no hay nada que validar en el cliente.

## Errores y casos límite

| Caso | Qué pasa |
|---|---|
| Destinatario desconectado | `send_to_wallet` devuelve 0 y no pasa nada más |
| Se desconecta justo al enviarse | El socket falla, se descarta, la propina sigue bien |
| Propina a uno mismo | El endpoint ya la rechaza con 422: no llega aquí |
| Falla el aviso | Se registra en el log; la respuesta del tip sigue siendo correcta |
| Propinas apagadas | El endpoint responde 503 antes de todo esto |

## Tests

- **`send_to_wallet`**: llega a las DOS pestañas del mismo jugador; **no llega a nadie más** (es
  lo que impide que la sala se entere); un socket roto no impide el envío al resto; con la wallet
  desconectada devuelve 0 sin reventar.
- **`me_tip`**: un tip correcto dispara el aviso, con el nombre y la cantidad; **si el aviso falla,
  el tip sigue devolviendo 200** y la fila sigue guardada.
- **Frontend**: un marco `tip` lanza el aviso con el texto correcto; un marco desconocido no
  rompe nada.

## Fuera de alcance

- Avisos que sobrevivan a recargar la página.
- Historial de propinas recibidas en el perfil.
- Avisar también a quien envía: ya se lo dice el modal.
