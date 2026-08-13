/**
 * Qué se le dice al jugador cuando un canje de tirada gratis falla.
 *
 * El backend devuelve CÓDIGOS, no frases, y el texto se escribe aquí. Es el mismo criterio que en
 * el modal de propinas, y nace de lo contrario: durante meses el aviso enseñaba el `detail` del
 * backend tal cual, así que un jugador podía leer `gacha_disabled`, `signer_unavailable` o
 * `too many gacha requests`, en una mezcla de español e inglés, y hasta el error crudo de
 * Collector Crypt cuando cambiaban su API ("Missing or invalid nonce").
 *
 * Cada mensaje dice QUÉ pasa y QUÉ hacer, y solo prometen reintentar los que se arreglan
 * reintentando.
 */
import { GachaDisabledError, GachaHttpError } from '../../../onchain/gachaClient'

const POR_CODIGO: Record<string, string> = {
  machine_no_free_spins: 'This machine does not offer free packs.',
  machine_out_of_cards: 'This machine just ran out of cards.',
  machine_unavailable: 'This machine is not available right now.',
  // El backend lo escribe con espacio en `_machine_price`, compartido con las tiradas de pago.
  'machine unavailable': 'This machine is not available right now.',
  gacha_disabled: 'The gacha is closed right now.',
  signer_unavailable: 'Free packs are unavailable right now. Try again later.',
  upstream_error: 'Collector Crypt could not process the claim. Try again in a moment.',
  rate_limited: 'Too many spins in a row. Give it a minute.',
  'too many gacha requests': 'Too many spins in a row. Give it a minute.',
}

const GENERICO = 'Could not claim your free pack. Try again in a moment.'

/** Los puntos que faltan los sabe el servidor, así que viajan pegados al código. */
function faltanPuntos(codigo: string): string | null {
  const m = /^not_enough_points:(\d+)$/.exec(codigo)
  if (!m) return null
  return `You need ${Number(m[1]).toLocaleString('en-US')} more points for a free pack here.`
}

export function mensajeDeCanje(e: unknown): string {
  if (e instanceof GachaDisabledError) return POR_CODIGO.gacha_disabled
  if (e instanceof GachaHttpError) {
    const codigo = e.message.trim()
    return faltanPuntos(codigo) ?? POR_CODIGO[codigo] ?? mensajePorEstado(e.status)
  }
  return GENERICO
}

/** Red de seguridad: un código que no conozcamos no puede dejar al jugador sin explicación, y el
 *  estado HTTP ya distingue "es cosa tuya" de "es cosa nuestra". */
function mensajePorEstado(status: number): string {
  if (status === 401 || status === 403) return 'Log in again to claim your free pack.'
  if (status === 429) return POR_CODIGO.rate_limited
  if (status === 503) return POR_CODIGO.signer_unavailable
  if (status >= 500) return POR_CODIGO.upstream_error
  return GENERICO
}
