import { ccCardImageUrl } from '../../../onchain/gachaClient'
import type { RevealVM } from './battleReveal'

export interface Pnl {
  /** Etiqueta del modo, ya en mayúsculas: 'PACK BATTLE' o 'BATTLE ROYALE'. */
  mode: string
  /** Wallet del ganador. El nombre lo resuelve quien pinta, que es el que tiene los alias. */
  winner: string
  /** Lo que pagó por entrar, en dólares. */
  entry: number
  /** Lo que se lleva: el valor tasado de TODAS las cartas de la partida. */
  payout: number
  /** payout − entry. Puede ser negativo (ver abajo). */
  profit: number
  /** payout / entry, o `null` si no hubo entrada que multiplicar (partida gratis). */
  multiple: number | null
  /** La carta más cara del botín, para el fondo. `null` si ninguna trae imagen. */
  background: string | null
}

/** El dominio público, en un solo sitio: lo firma la tarjeta y lo enlaza el tuit. */
export const SITE_DOMAIN = 'collectorarena.xyz'
export const SITE_URL = `https://${SITE_DOMAIN}`

const ETIQUETA: Record<string, string> = { pack: 'PACK BATTLE', royale: 'BATTLE ROYALE' }

/**
 * Los números de la tarjeta de resultado de un ganador.
 *
 * Devuelve `null` mientras no haya ganador: la tarjeta es SOLO para quien gana, así que sin
 * partida liquidada no hay nada que enseñar.
 *
 * `profit` puede salir negativo, y se devuelve tal cual. Ganar no garantiza ganar dinero: el
 * ganador se lleva todas las cartas, pero si entre todas valen menos que su entrada, el balance
 * es una pérdida. Enseñar siempre un "+" sería mentir en la única cifra que la tarjeta existe
 * para contar.
 */
export function pnlOf(vm: RevealVM): Pnl | null {
  if (vm.status !== 'settled' || !vm.winner) return null

  const botin = vm.players.flatMap((p) => p.cards)
  const payout = botin.reduce((s, c) => s + (c.insuredValue ?? 0), 0)
  const entry = vm.entry

  // La más cara con imagen: es la que cuenta la historia de la partida.
  const mejor = botin
    .filter((c) => c.nftAddress)
    .sort((a, b) => (b.insuredValue ?? 0) - (a.insuredValue ?? 0))[0]

  return {
    mode: ETIQUETA[vm.mode] ?? String(vm.mode).toUpperCase(),
    winner: vm.winner,
    entry,
    payout,
    profit: payout - entry,
    multiple: entry > 0 ? payout / entry : null,
    background: mejor?.nftAddress ? ccCardImageUrl(mejor.nftAddress) : null,
  }
}
