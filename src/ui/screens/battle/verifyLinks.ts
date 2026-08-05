/**
 * Los enlaces con los que un jugador comprueba una tirada por su cuenta.
 *
 * Son dos, y hacen falta los dos:
 *
 *   · **Solscan** — la transacción de COMPRA del sobre. Ahí dentro va el memo, como instrucción
 *     spl-memo, y ahí firma la wallet del jugador. Es la prueba de autoría.
 *   · **VRF de Collector Crypt** — qué salió en esa tirada y que el sorteo fue el que dicen.
 *
 * Por qué no basta el segundo. El VRF de CC atribuye la tirada a la `altPlayerAddress`, que en una
 * batalla es la wallet de la partida, no la del jugador. Así que enseña QUÉ tocó pero no A QUIÉN.
 * Quién la pagó solo lo demuestra la transacción, y por eso van juntos: el memo es el hilo que
 * une las dos mitades.
 */
export const SOLSCAN = 'https://solscan.io'
const CC_DEVNET = 'https://dev-gacha.collectorcrypt.com'
const CC_MAINNET = 'https://gacha.collectorcrypt.com'

/** La transacción en Solscan. `null` si esa tirada no tiene firma guardada (ver abajo). */
export function solscanTxUrl(signature: string | null | undefined, isDevnet: boolean): string | null {
  if (!signature) return null
  return `${SOLSCAN}/tx/${signature}${isDevnet ? '?cluster=devnet' : ''}`
}

/**
 * El VRF de esa tirada.
 *
 * El memo se manda SIN el sufijo `:open`. On-chain viaja como `cc-<uuid>:open`, pero el endpoint
 * espera solo el `cc-<uuid>` — con el sufijo no encuentra nada y parece que el memo no existe. Se
 * recorta aquí por si alguna vez llega con él.
 *
 * Y el host tiene que ser el de la red donde se hizo la tirada: un memo de devnet consultado
 * contra mainnet tampoco aparece.
 */
export function ccVrfUrl(memo: string | null | undefined, isDevnet: boolean): string | null {
  if (!memo) return null
  const limpio = memo.split(':')[0]
  return `${isDevnet ? CC_DEVNET : CC_MAINNET}/api/vrf/verify?memo=${encodeURIComponent(limpio)}`
}
