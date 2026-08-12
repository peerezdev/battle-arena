# Tip en USDC a otro jugador — design

Date: 2026-08-12
Status: implemented

## Objetivo

Que un jugador pueda enviar USDC a **otro jugador** desde el perfil ajeno y desde el chat.

La restricción a jugadores registrados **no es una simplificación, es la defensa**: si el destino
pudiera ser una dirección cualquiera, el tip sería un `/users/me/withdraw` sin mínimo, sin
comisión y sin throttle, o sea una puerta trasera para sacar fondos de la plataforma.

Esa defensa se apoya en un hecho del código, verificado: `current_user` devuelve **siempre** la
wallet embebida derivada del token de identidad de Privy (`main.py:248`), así que la `wallet` de
una fila de `users` es por construcción una wallet delegada nuestra. El dinero que entra por un
tip sigue dentro de la plataforma y solo sale por el withdraw, con sus reglas intactas.

## Contexto (código actual)

- **Transferencia**: `withdraw_usdc(rpc_url, signer, player_wallet_id, player_address,
  operator_wallet_id, operator_address, dest_address, usdc_mint, amount, blockhash)` en
  `services/royale_funding.py:63`. Firma a dos: el emisor autoriza el movimiento de USDC y el
  operador paga la fee. Por debajo usa `build_token_transfer`, que **crea la cuenta de USDC del
  destinatario de forma idempotente** (`services/solana_tx.py:55-87`) y cuya renta paga el
  operador. Sirve tal cual: un tip es un withdraw cuyo destino es la wallet embebida de otro
  jugador. **No hay código nuevo on-chain.**
- **Saldo**: `_require_available(wallet, amount, s)` (`main.py:1059`) compara el saldo on-chain
  contra `reserved_total(s, wallet)` y responde 402 si no llega. Es lo que impide gastar el dinero
  que una batalla en curso tiene comprometido.
- **Throttle**: patrón de `_withdraw_throttle` (`main.py:1211`), ventana + tope por wallet.
- **Alta de usuario**: `get_or_create_user(session, wallet, elo_start)`
  (`services/users.py:23`).
- **Chat**: cada mensaje ya viaja con la `wallet` de quien habla (`main.py:1926`), añadida para
  poder ir a su perfil. El destinatario de un tip desde el chat sale de ahí, sin pedir nada nuevo.
- **Perfil**: `ProfilePage` ya distingue perfil propio de ajeno con `isSelf`
  (`src/ui/screens/Profile/ProfilePage.tsx:30`).
- **Modal de referencia**: `src/ui/components/WithdrawModal.tsx`.

## Decisiones

| | |
|---|---|
| Qué se envía | USDC |
| A quién | Solo a un jugador registrado en `users` |
| Desde dónde | Perfil ajeno y chat |
| Mínimo | Sí, `min_tip_usdc` (1 USDC por defecto). El operador paga la renta de la cuenta USDC (~0,002 SOL) de cada destinatario nuevo; con 0,10 salía barato hacerle gastar SOL a base de propinas minúsculas a cuentas recién creadas. |
| Throttle | Sí, por wallet emisora |
| Comisión | **No.** El dinero sigue dentro de la plataforma y ya pagará comisión al retirarse |
| Bloqueo por batalla en curso | **No.** Basta respetar el saldo reservado, y así se puede dar propina justo al acabar una partida |

## Backend

### `POST /users/me/tip`

Cuerpo: `{"to": "<wallet>", "amount": <float USDC>}`.

Validaciones **en este orden**, que es el que da el mejor error al usuario y el que evita trabajo
inútil:

1. `privy_signer` y operador configurados → si no, 503 `tips_unavailable`.
2. `to` existe en `users` → si no, 404 `ese jugador no tiene cuenta`.
3. `to != wallet` del emisor → si no, 422.
4. `amount > 0` y `amount >= min_tip_usdc` → si no, 422 con el mínimo en el mensaje.
5. `_tip_throttle(wallet)` → si no, 429.
6. `_require_available(wallet, amount_base_units, s)` → 402 si no llega.
7. `withdraw_usdc(...)` con `dest_address` = la wallet del destinatario.
8. Guardar la fila de `Tip` y devolver `{"signature", "amount", "to"}`.

El importe se convierte a unidades base con `int(round(amount * 1_000_000))`, igual que el
withdraw (`main.py:1286`).

El throttle lleva **sus propios contadores**, no los del withdraw: son dos límites con motivos
distintos (el del withdraw protege la renta de ATA del operador; este, del spam social) y
compartirlos haría que dar propinas dejara al jugador sin poder retirar.

### Ajustes nuevos en `config.py`

```python
min_tip_usdc: float = 1.0         # env: MIN_TIP_USDC
tip_rate_limit: int = 10          # env: TIP_RATE_LIMIT
tip_rate_window_s: float = 60.0   # env: TIP_RATE_WINDOW_S
```

El mínimo existe por lo mismo que el del withdraw: si el destinatario aún no tiene cuenta de USDC,
el operador paga su renta (~0,002 SOL), así que sin mínimo se le puede drenar a base de tips
minúsculos a jugadores nuevos.

### Modelo `Tip`

```
id            int, pk
from_wallet   str, index
to_wallet     str, index
amount        int          # unidades base (6 decimales), como el resto del código
signature     str          # firma de la transacción; la prueba
source        str          # 'profile' | 'chat'
created_at    datetime
```

Sin esta tabla un tip solo existiría en la cadena: no habría historial, ni "propinas recibidas" en
el perfil, ni forma de investigar un abuso después. `source` se guarda porque si algún día hay que
capar el spam, lo primero que se querrá saber es por dónde entra.

La fila se escribe **después** de que la transferencia devuelva firma. Si la transferencia falla no
hay fila; si la escritura de la fila falla, el dinero ya se movió y la firma está en los logs, que
es el caso menos malo de los dos.

## Frontend

- **Cliente**: `sendTip(token, toWallet, amount)`, junto al resto de llamadas de usuario.
- **`TipModal`** (compartido, al lado de `WithdrawModal`): destinatario con su alias, saldo
  disponible, campo de importe con atajos, y al terminar el enlace a la transacción. Deshabilitado
  mientras vuela la petición, para no mandar dos.
- **Perfil ajeno**: botón "Enviar tip", visible solo cuando `!isSelf`.
- **Chat**: acción junto al nombre de quien habla, que abre el mismo modal con su wallet.

Los mensajes de error se traducen a algo que el jugador entienda: el 402 dice cuánto tiene
disponible, no "not enough available USDC"; el 404 dice que ese jugador todavía no tiene cuenta.

## Errores

| Código | Cuándo |
|---|---|
| 402 | Saldo disponible insuficiente (ya descontado lo reservado por una batalla) |
| 404 | El destinatario no tiene cuenta |
| 422 | Importe por debajo del mínimo, importe no positivo, o tip a uno mismo |
| 429 | Demasiados tips seguidos |
| 502 | La transferencia falló |
| 503 | Firmante u operador no configurados |

## Tests

- **Puras**: la validación de importe (mínimo, cero, negativo) y la de destinatario (a uno mismo).
- **Endpoint**, con firmante falso: caso feliz (fila escrita, firma devuelta); destinatario que no
  existe; tip a uno mismo; importe bajo el mínimo; throttle al pasarse; y **el caso que de verdad
  importa**: saldo suficiente en cadena pero reservado por una batalla en curso → 402, que es lo
  que impide vaciar la wallet a mitad de partida.
- **Frontend**: el modal con el cliente mockeado (envío correcto, error de saldo, doble clic).

## Fuera de alcance

- Anunciar los tips en el chat ("X ha dado propina a Y").
- Dar propina a quien todavía no tiene cuenta: lo impide la regla de este diseño a propósito.
- Tips en gimmighouls.
