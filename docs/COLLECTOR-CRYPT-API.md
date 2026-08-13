# La API de Collector Crypt — lo que sabemos

Notas de lo aprendido usando la API de CC, incluida la parte que **no está documentada** y la que
está documentada pero **se comporta distinto**. Todo lo de aquí está medido contra la API real, no
deducido; donde no lo esté, se dice.

Su documentación oficial: <https://docs.collectorcrypt.com/>

| | devnet | mainnet |
|---|---|---|
| Gacha | `https://dev-gacha.collectorcrypt.com` | `https://gacha.collectorcrypt.com` |
| Metadatos NFT | `https://nft-dev.collectorcrypt.com` | `https://nft.collectorcrypt.com` |

Los hosts **no son intercambiables**: un memo de devnet consultado contra el host de mainnet no
aparece. Es la causa de una hora perdida creyendo que el VRF no funcionaba.

`gacha_base_url` vacío deshabilita el gacha entero — es el kill-switch.

---

## Lo más importante: `altPlayerAddress` NO es solo entrega

La documentación lo presenta como "a dónde mandar la carta". En la práctica **también se lleva los
puntos y la atribución del VRF**. Para CC, quien hizo la tirada es la `altPlayerAddress`.

Consecuencias que nos han mordido:

- **Los puntos del gacha se van al escrow.** En las Pack Battle y Royale el escrow es la
  `altPlayerAddress`, así que los puntos de todas las tiradas de batalla los ha acumulado el
  escrow, no el jugador. En devnet quedaron **3.069.133 puntos gastables repartidos en 57
  escrows**. Troceados así, solo **6 wallets** llegan a los 100.000 de una tirada gratis en la
  máquina más barata: unas 19 tiradas rescatables de 3 millones de puntos. En las máquinas caras,
  ninguna llega.

  **Y no se pueden mover a otra wallet.** `transferBonusPoints` solo transfiere puntos recibidos
  por transferencia, no los ganados con tiradas: ver su sección más abajo. Esos puntos se gastan
  donde están o no se gastan.
- **El feed público de CC atribuye la tirada al escrow.** Un jugador que mire su historial en CC no
  ve sus tiradas de batalla. Las ve el escrow.
- **El VRF también.** `GET /api/vrf/verify` devuelve la wallet del escrow, no la del jugador.

La atribución de verdad se hace con la cabecera `x-api-key`, que identifica al integrador. Nosotros
no mandamos ninguna (devnet es keyless), así que no tenemos forma de decirle a CC "esta tirada es
de este usuario" por la vía de la API.

**Cómo se demuestra entonces que una tirada es de un jugador:** por la cadena. Ver la sección del
memo, más abajo. Es la única prueba que no depende de creerse ni nuestra base ni la de CC.

---

## Endpoints documentados

| Método | Ruta | Notas |
|---|---|---|
| GET | `/api/status` | `code → status`; `open` = máquina disponible. Lo leemos **fail-open**: si falla, se asume disponible. |
| GET | `/api/machines` | catálogo de máquinas |
| GET | `/api/getNfts` | cartas de una máquina; el valor sale **solo** de `insuredValue` |
| POST | `/api/generatePack` | devuelve `memo` + `transaction` sin firmar |
| POST | `/api/generateYoloPacks` | varios sobres de golpe |
| POST | `/api/submitTransaction` | CC la envía y **paga la fee** |
| POST | `/api/openPack` | abre por `memo`; `WAITING_FOR_WEBHOOK` = reintentar |
| GET | `/api/buyback/available`, POST `/api/buyback` | recompra |
| GET | `/api/getAllWinners` | feed público |
| GET | `/api/vrf/verify?memo=` | ver abajo |

### El flujo de una tirada

```
generatePack  →  transacción sin firmar
                 la firma el JUGADOR (nunca sale la clave)
submitTransaction  →  CC la manda a la cadena y paga la fee
openPack(memo)     →  la carta
```

Nosotros solo firmamos; **la fee de la tirada la paga CC**, no el operador.

### `/api/vrf/verify`

Dos trampas, las dos costaron tiempo:

1. El memo que se le pasa va **sin el sufijo `:open`**. El memo on-chain es `cc-<uuid>:open`; al
   endpoint se le da `cc-<uuid>`.
2. El host tiene que ser el de la red donde se hizo la tirada.

Aun acertando las dos, lo que devuelve atribuye la tirada a la `altPlayerAddress`.

---

## Endpoints NO documentados

Salieron mirando la pestaña de red de su propia web. **Pueden cambiar o desaparecer sin aviso**:
todo lo que leemos de ellos va con `.get` y valor por defecto, nunca por índice.

### `GET /api/freeSpins?wallet=`

| campo | qué es |
|---|---|
| `points` | puntos acumulados |
| `usedPoints` | ya gastados en tiradas gratis → **lo gastable es la resta** |
| — | esa resta es lo **gastable en tiradas**, y NO es lo transferible: ver `transferBonusPoints` |
| `freeSpinsLeftToday` | tope diario restante |
| `freeSpinsLeft`, `pointsPerSpin`, `pointsUntilNextSpin` | **ver el aviso de abajo** |

**Es de la WALLET, no de la máquina.** Acepta `wallet` y nada más: le pasamos `packType`, `machine`
y `code` y la respuesta no cambia.

**Cuidado con `freeSpinsLeft` y `pointsPerSpin`.** Parecen la respuesta a "¿cuántas tiradas gratis
tengo?", pero vienen calculados **siempre sobre una máquina de 50 $**. Una tirada gratis no cuesta
lo mismo en todas: cuesta 100.000 puntos en la de 50 $ y **sube en proporción al precio**, así que
en la de 5.000 $ son 10 millones. Leerlos tal cual anunciaba tres tiradas gratis en una máquina
donde no llegaba ni para una.

La fórmula, tal cual la usa su propia web:

```js
requeridos = Math.round(100_000 * (precio / 50))
disponible = points - usedPoints
tiradas    = Math.floor(disponible / requeridos)
resto      = disponible % requeridos
hastaLaSig = (resto === 0 && disponible > 0) ? 0 : requeridos - resto
```

Comprobada contra una wallet real de 364.060 puntos: la API dice `freeSpinsLeft: 3` y
`pointsUntilNextSpin: 35.940`, que es exactamente lo que da la fórmula **para el precio base**. En
la de 250 $ esos mismos puntos no dan ninguna.

Nosotros la tenemos dos veces a propósito: `tiradas_gratis()` en `app/services/gacha.py` —la
puerta— y `tiradasGratis()` en `src/ui/screens/gacha/freeSpins.ts` —lo que se pinta—.

### Qué máquinas dan tiradas gratis

Dos condiciones, y ninguna es del jugador:

- **`machine.freeSpins`**, en `/api/machines`. Muchas no las dan: en devnet 3 de 9, en mainnet 16
  de 43. Pedir una en la que no → `400 "Invalid pack type"`.
- **`freePacksStatus`**, en `/api/status`. Interruptor **global** de CC: en `closed` no hay tiradas
  gratis en ninguna máquina.

El orden de validación de `freePack`, medido: **nonce** → tipo de máquina → firma → puntos.

### `POST /api/generateFreePack` + `POST /api/freePack`

**CC endureció este canje sin avisar, y nos lo rompió entero** (2026-08-13). Antes bastaba una
transacción firmada cualquiera; ahora hay un reto de dos pasos. Con el formato viejo responde
`400 {"error":"Missing or invalid nonce"}`, y ninguna tirada gratis se puede canjear.

**Y SOLO EN MAINNET.** Devnet sigue con el contrato viejo: allí `/api/generateFreePack` **no
existe** (404) y `/api/freePack` acepta el formato de antes. Comprobado también en su frontend, que
en devnet manda el cuerpo sin `nonce` y no llama a `generateFreePack` en ninguna parte: es un
despliegue suyo que va por detrás.

Exigir el nonce en las dos redes dejó devnet con un 502 y ninguna tirada gratis, así que el código
lo decide en caliente: `generate_free_pack` devuelve `None` cuando el endpoint da 404, y entonces
la prueba vuelve a ser el `build_memo_tx` de siempre. El 404 se distingue del resto de fallos con
`GachaEndpointMissing`; cualquier otro error se propaga, porque tratar una caída de CC como "esta
red es la vieja" mandaría el formato antiguo a mainnet y el jugador vería el error del nonce.

Cuando devnet se actualice no habrá que tocar nada: en cuanto `generateFreePack` deje de dar 404,
el canje pasa solo al flujo nuevo.

```
POST /api/generateFreePack  {publicKey, packType}   →  {nonce, expiry}   (minutos)
POST /api/freePack          {publicKey, packType, turbo, transactionSignature, nonce}  →  {memo}
```

El `nonce` viaja por **dos vías a la vez**, y CC comprueba las dos:

1. En el cuerpo de `/api/freePack`.
2. **Dentro de la transacción firmada**, como contenido de una instrucción memo que además lleva
   la wallet en sus cuentas **marcada como firmante**. Esa marca es lo que ata el nonce a la
   wallet: sin ella el memo sería un texto que podría haber escrito cualquiera.

La transacción replica la de su web: transferencia de 0 lamports de la wallet a sí misma, más el
memo con el nonce. Lo construye `build_free_pack_proof_tx` en `app/services/solana_tx.py`;
`build_memo_tx`, con su texto fijo, **ya no sirve para esto**.

El orden de validación, medido: **el nonce se comprueba antes que la firma** (con una firma basura
y sin nonce, el error es el del nonce).

Lo demás sigue igual:

- **`transactionSignature` no se envía a la cadena.** Actúa como prueba de propiedad, no como
  pago.
- **`altPlayerAddress` se acepta en el cuerpo pero se ignora.** La carta va **siempre** a
  `publicKey`. Comprobado on-chain. Por eso los puntos del escrow no se pueden convertir en cartas
  para un jugador: el sobre gratis lo recibe el escrow.
- No todas las máquinas lo admiten.

### `GET /api/user/bonusTransfers?wallet=`

Historial de transferencias de puntos.

### `POST /api/user/transferBonusPoints` (y `/prepare`)

Mueve puntos de una wallet a otra. **Funciona, y sabemos usarlo desde el servidor** — pero no
sirve para rescatar los puntos de los escrows, por el motivo del final de esta sección.

Aquí decía antes que `/prepare` devolvía 401 y que no había forma de resolverlo. Era un
diagnóstico equivocado: el 401 venía de mandar un token con el `aud` de otra red.

**El orden de validación**, medido: enviarse a uno mismo → importe mínimo → autorización. Como la
autorización se comprueba la última, un 401 aquí ya garantiza que el cuerpo era válido.

- **Mínimo 1.000 puntos** por transferencia.
- **No se puede enviar a uno mismo.**

#### La autorización: un JWT de Privy que emitimos nosotros

La cabecera es `Authorization: Bearer <JWT>`, un token de Privy de **la app de CC**, y CC lo ata al
`fromWallet`: con el token de otra wallet responde 401 aunque el cuerpo sea correcto.

No hace falta que nadie inicie sesión a mano. El token se emite por servidor con el login
Sign-In-With-Solana de Privy, firmando el mensaje con la wallet:

```
POST auth.privy.io/api/v1/siws/init          {address}                → nonce
     firmar el mensaje con la wallet (Privy: signMessage, base64)     → signature
POST auth.privy.io/api/v1/siws/authenticate  {message, signature, …}  → token (24 h)
```

Tres cosas que hacen fallar el login si faltan:

- La cabecera `origin` con el host de CC, o Privy responde `403 missing_origin`.
- Un `User-Agent` de navegador: sin él, 403 de Cloudflare. Es el mismo tropiezo que ya
  documentamos en `privy_signer._wallet`.
- El **texto exacto** del mensaje. Cualquier variación da `invalid_data`. Es el de la web de CC:

```
<host> wants you to sign in with your Solana account:
<address>

You are proving you own <address>.

URI: https://<host>
Version: 1
Chain ID: mainnet
Nonce: <nonce>
Issued At: <ISO-8601>
Resources:
- https://privy.io
```

**Cada red de CC tiene su propia app de Privy**, y confundirlas es exactamente el 401 que nos
costó el diagnóstico anterior:

| red | `privy-app-id` |
|---|---|
| mainnet | `cmdgt21w400lgky0mkn069jui` |
| devnet | `cmcwv1wi201tnjm0mmexyzxyi` |

**En devnet no se puede**: su app tiene lista blanca y el login responde
`401 allowlist_rejected` para cualquier wallet nuestra. Esto es **solo mainnet**.

#### El flujo

```
prepare(fromWallet, toWallet, amount)   →  {nonce, expiry (~5 min), transferable}
firmar un memo con la wallet            →  prueba de propiedad
transferBonusPoints(… nonce, signedTransaction)  →  {transferred, newBonusPoints, newPointsRemaining}
```

El `signedTransaction` es un memo firmado que no se envía a la cadena, con el `build_memo_tx` de
toda la vida y su texto fijo. **Ojo, que aquí las dos pruebas de propiedad ya NO son la misma**:
`freePack` pasó a exigir el nonce dentro del memo (ver su sección) y esta no. Comprobado el
2026-08-13: el envío de puntos sigue aceptando el memo simple.

#### La bolsa "bonus" es un CUPO, y es lo que limita cuánto se puede enviar

`transferable` **no es** `points - usedPoints`, y tampoco es "lo recibido por transferencia", que
es lo que decía aquí antes. El modelo real, medido:

- Cada wallet tiene un **cupo de envío** (`newBonusPoints` en la respuesta) que **lo crean las
  transferencias RECIBIDAS** y que **baja exactamente lo que se envía**.
- Lo que se puede mandar está acotado por ese cupo, pero **los puntos en sí pueden ser de
  tiradas**: con cupo de sobra se envían puntos ganados jugando.

Los números, de tres envíos reales desde `8QDBKx8…`:

| | enviado | cupo después |
|---|---|---|
| ids 6127 + 6129 | 1.000 + 44.534 | 347.773 → 302.239 |
| id 6239 | 74.153 | 302.239 → 228.086 |

El último es la prueba de que no hace falta haber recibido esos puntos: entre el segundo envío y el
tercero esa wallet **no recibió ninguna transferencia**, solo ganó puntos tirando, y aun así los
pudo mandar. Lo que se agotó en el segundo envío fue lo gastable, no el cupo.

Al revés también se comprobó: `2cdajp4Y…` (29.175 puntos) y `EweRxQsf…` (160.841), que **nunca han
recibido una transferencia**, tienen cupo 0 y dan `transferable: 0` con el error explícito
`you can send up to 0`.

**Consecuencia, que no cambia: los ~3 millones varados en los escrows no se pueden rescatar.** Los
escrows nunca han recibido una transferencia, así que su cupo es cero. La pregunta que abría la
sección de `altPlayerAddress` sigue cerrada en negativo, pero por el cupo, no por el origen de los
puntos.

Y para cualquier función de "enviar puntos": lo enviable hay que leerlo de `prepare`, nunca
calcularlo con la fórmula de `freeSpins`.

#### Después de un envío, `points - usedPoints` puede quedar NEGATIVO

Medido: `transferable` (74.153) llegó a ser mayor que `points - usedPoints` (72.299), y tras el
envío la resta quedó en **-1.854**. O sea que la fórmula de `freeSpins` no es la contabilidad que
usa CC para transferir, y puede quedar por debajo de cero.

No rompe nada nuestro porque los tres sitios que la calculan acotan a cero por su cuenta
(`free_spins()` en `app/services/gacha.py`, y `tiradas_gratis()` / `tiradasGratis()`), pero
quien escriba un cuarto tiene que saberlo.

### `getPoints`

Ojo con los dos campos, que **no son lo mismo**:

- `totalPoints` → puntos ganados **en toda la vida** de la wallet. No es lo que se puede gastar.
- `pointsRemaining` → lo gastable.

Confundirlos infla la cifra: en devnet la diferencia era 3.269.133 frente a 3.069.133.

---

## El memo, y por qué es la única prueba

Cada tirada lleva un `memo` (`cc-<uuid>`) que **viaja dentro de la transacción de compra** como
instrucción `spl-memo`, visible en los logs de cualquier explorador. Y esa transacción **la firma
el jugador**.

O sea: en la cadena, para siempre y sin depender de nosotros, están juntos el identificador de la
tirada y la firma de quien la pagó. Eso es lo que demuestra que la tirada es suya, aunque CC se la
atribuya al escrow.

Al ser el memo un UUID, ir de la tirada a su transacción es **determinista**, no arqueología:
basta buscar en el historial de firmas del jugador la que lo contiene. Es lo que hace
`backend/scripts/backfill_pull_signatures.py` para las tiradas anteriores a la columna
`battle_pulls.tx_signature`.

Único límite: `getSignaturesForAddress` pagina hacia atrás de 1000 en 1000, así que una wallet con
muchísimo movimiento puede tener la tirada más atrás de lo que se recorre. La prueba sigue en la
cadena; solo que no la hemos localizado.

---

## Cosas sueltas que cuestan tiempo si no se saben

- **Valor de una carta: solo `insuredValue`.** Ningún otro campo.
- **Mainnet entrega NFTs de Metaplex CORE**, no SPL ni cNFT — con `PermanentFreezeDelegate` de CC.
  No tienen cuenta de token, así que **no hay renta de ATA que recuperar** (los 2.039.280 lamports
  solo aplican a los SPL).
- **En devnet el USDC es un mint propio** (`Gh9Zw…`), no el de circle.
- `openPack` puede responder `WAITING_FOR_WEBHOOK`: no es un error, es "todavía no, reintenta".
