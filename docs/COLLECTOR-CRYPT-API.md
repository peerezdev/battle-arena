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

El orden de validación de `freePack`, medido: tipo de máquina → firma → puntos.

### `POST /api/freePack`

```json
{"publicKey": "...", "packType": "...", "turbo": false, "transactionSignature": "<base64>"}
```

Canjea una tirada gratis y devuelve un `memo`, que se abre con el mismo `openPack` que uno de pago.

Lo medido, que conviene saber:

- **`transactionSignature` no se envía a la cadena.** Vale cualquier transacción firmada por esa
  wallet en base64 — le pasamos un memo vacío y lo acepta. Actúa como prueba de propiedad de la
  wallet, no como pago. No hay reto ni caducidad.
- **`altPlayerAddress` se acepta en el cuerpo pero se ignora.** La carta va **siempre** a
  `publicKey`. Comprobado on-chain. Por eso los puntos del escrow no se pueden convertir en cartas
  para un jugador: el sobre gratis lo recibe el escrow.
- No todas las máquinas lo admiten.

### `GET /api/user/bonusTransfers?wallet=`

Historial de transferencias de puntos.

### `POST /api/user/transferBonusPoints` (y `/prepare`)

La vía teórica para mover puntos de una wallet a otra — sería la solución a los 3 millones varados
en los escrows. **No nos sirve: `/prepare` devuelve 401.** Sin resolverlo desde el servidor, no hay
forma de mover los puntos.

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
