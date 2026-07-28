import { RARITY } from '../../theme'
import { PACK_W, PACK_H } from './GachaPackTilt'

// Guion y tablas de la ceremonia del gacha. Aparte del componente porque exportar
// constantes y funciones junto a uno rompe el Fast Refresh.

export const ORDER = ['common', 'uncommon', 'rare', 'epic'] as const
export type Rarity = typeof ORDER[number]

export const RARITY_HEX: Record<Rarity, string> = {
  common: RARITY.common, uncommon: RARITY.uncommon, rare: RARITY.rare, epic: RARITY.epic,
}

export const ROW = 38   // alto de fila de la casilla; debe cuadrar con el alto del .reelItem de abajo

// La carta se monta EXACTAMENTE con las medidas del sobre: el sobre se abre y en su sitio
// aparece una carta del mismo tamaño, sin salto. Vienen importadas y no copiadas para que no
// puedan separarse. De paso encajan mejor: una losa PSA es ~0.60 de proporción y el sobre 0.583,
// mucho más cerca que el 0.715 que tenía la caja antes.
export const CARD_W = PACK_W
export const CARD_H = PACK_H

// ⏱️  RITMO DE LA CEREMONIA DEL GACHA
//
// Igual que en las batallas: cada número es lo que DURA esa fase, no el instante en que ocurre.
// Se encadenan, así que se toca uno y lo de después se desplaza solo.
//
//   year ──▶ grade ──▶ [ruleta de rareza] ──▶ ┐
//     ├─ Epic:  ──band──▶ ──epicWait──▶ [gira] ──epicTurn──▶ de cara ─┐
//     ├─ Rare:  ──band──▶ [voltea] ──rareTurn──▶ de cara ─────────────┤
//     └─ resto: [voltea] ──plainTurn──▶ de cara ───────────────────────┘
//                                                    └─ ──gap──▶ [contador] ──count──▶ ──hold──▶
export const PHASE = {
  year: 800,        // la fila del año, sola
  grade: 800,       // luego el grado
  band: 600,        // la franja entra y se sostiene antes de que la carta se mueva
  epicWait: 600,    // Epic: lo que espera con la franja puesta antes de arrancar a girar
  epicTurn: 1800,   // Epic: lo que tarda el giro en dejarla de cara
  rareTurn: 800,    // Rare: lo que dura su volteo
  plainTurn: 1000,  // Common y Uncommon: lo que dura su volteo (no llevan franja)
  gap: 250,         // respiro entre la carta de cara y el contador
  count: 1600,      // lo que tarda el contador en llegar al valor
  hold: 1800,       // lo que se queda todo en pantalla antes de cerrar
}

/** Lo que tarda la casilla en parar, por rareza. Escala a propósito: una común para casi en
 *  seco y una épica coquetea con las bajas antes de deslizarse. Es lo que hace que una épica se
 *  SIENTA distinta sin añadir etapas nuevas. */
export const SPIN_MS: Record<Rarity, number> = { common: 2500, uncommon: 3000, rare: 3000, epic: 3000 }

export interface GachaTimeline {
  yearAt: number | null
  gradeAt: number | null
  /** La fila de rareza entra y la ruleta arranca a la vez. */
  reelAt: number
  reelMs: number
  /** Instante en que la ruleta para: ahí se sabe la rareza. */
  rarityAt: number
  bandAt: number | null
  turnAt: number
  turnMs: number
  faceUpAt: number
  countAt: number
  doneAt: number
}

/**
 * Duraciones → instantes. Las filas que la carta no trae no reservan tiempo: sin año, todo lo
 * demás sube en bloque en vez de dejar un hueco muerto.
 */
export function buildGachaTimeline(
  { hasYear, hasGrade, rarity }: { hasYear: boolean; hasGrade: boolean; rarity: Rarity | null },
): GachaTimeline {
  let t = 0
  const yearAt = hasYear ? t : null
  if (hasYear) t += PHASE.year
  const gradeAt = hasGrade ? t : null
  if (hasGrade) t += PHASE.grade

  const reelAt = t
  const reelMs = SPIN_MS[rarity ?? 'common']
  const rarityAt = reelAt + reelMs          // la ruleta para: ya se sabe qué ha tocado

  const band = rarity === 'rare' || rarity === 'epic'
  const bandAt = band ? rarityAt : null
  const turnAt = band ? rarityAt + PHASE.band + (rarity === 'epic' ? PHASE.epicWait : 0) : rarityAt
  const turnMs = rarity === 'epic' ? PHASE.epicTurn : band ? PHASE.rareTurn : PHASE.plainTurn
  const faceUpAt = turnAt + turnMs

  const countAt = faceUpAt + PHASE.gap
  return { yearAt, gradeAt, reelAt, reelMs, rarityAt, bandAt, turnAt, turnMs, faceUpAt, countAt,
    doneAt: countAt + PHASE.count + PHASE.hold }
}

export function norm(rarity: string | null | undefined): Rarity | null {
  const k = (rarity ?? '').toLowerCase()
  return (ORDER as readonly string[]).includes(k) ? (k as Rarity) : null
}

/** Elige al azar evitando `prev`: dos nombres iguales seguidos rompen la ilusión de rodillo —
 *  parece que se ha atascado, no que está girando. */
export function pickNot(prev: Rarity | undefined, pool: readonly Rarity[] = ORDER): Rarity {
  const opts = pool.filter((k) => k !== prev)
  return opts[Math.floor(Math.random() * opts.length)]
}

/** Tira de nombres de la casilla. Termina SIEMPRE en la rareza real; lo anterior es relleno.
 *  En rareza alta las dos previas se fuerzan a common/uncommon: es el bait — parece que va a
 *  parar en una mala y luego se desliza a la buena. */
export function buildReelStrip(target: Rarity, n = 14): Rarity[] {
  const items: Rarity[] = []
  for (let i = 0; i < n; i++) items.push(pickNot(items[i - 1]))
  if (target === 'epic' || target === 'rare') {
    const low: readonly Rarity[] = ['common', 'uncommon']
    items[n - 2] = pickNot(items[n - 3], low)
    items[n - 1] = pickNot(items[n - 2], low)
  }
  // El ganador tampoco puede repetir al anterior: sin bait, el relleno podría acabar en él.
  if (items[n - 1] === target) items[n - 1] = pickNot(target, ORDER.filter((k) => k !== items[n - 2]))
  items.push(target)
  return items
}
