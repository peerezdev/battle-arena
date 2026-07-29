import { COLORS } from '../../theme'

// ⏱️  RITMO DEL REVEAL — Battle Royale y Pack Battle
//
// Cada número es lo que DURA esa fase, no el instante en que ocurre. Las fases se encadenan: una
// empieza justo donde acaba la anterior. Así se toca un solo número y lo de después se desplaza
// solo, en vez de tener que recalcular a mano toda la lista.
//
//   0 ──year──▶ ──grade──▶ ──rarity──▶ ┐
//                                      ├─ Epic:  ──band──▶ ──epicWait──▶ [gira] ──epicTurn──▶ de cara
//                                      ├─ Rare:  ──band──▶ [voltea] ──rareTurn──▶ de cara
//                                      └─ resto: [voltea] ──plainTurn──▶ de cara
//                                                                        └─ ──hold──▶ siguiente
export const PHASE = {
  year: 800,        // la fila del año, sola en pantalla
  grade: 800,       // luego el grado
  rarity: 800,      // luego la rareza: dura más porque es la que remata
  band: 600,        // la franja entra y se sostiene antes de que la carta se mueva
  epicWait: 600,    // Epic: lo que espera con la franja puesta antes de arrancar a girar
  epicTurn: 1800,   // Epic: lo que tarda el giro en dejarla de cara
  rareTurn: 800,    // Rare: lo que dura su volteo
  plainTurn: 1000,  // Common y Uncommon: lo que dura su volteo (no llevan franja)
  hold: 1800,       // lo que se queda la carta de cara antes de pasar a la siguiente
}

/** Vueltas del giro de Epic. 1980° ≡ 180°, así que aterriza de cara sin salto. */
export const EPIC_SPIN_DEG = 1980

/** Rarezas que se llevan franja. El resto pasa de largo. */
export function bandRarity(rarity: string | null | undefined): 'rare' | 'epic' | null {
  const k = (rarity ?? '').toLowerCase()
  return k === 'rare' || k === 'epic' ? k : null
}

const BAND_COLORS: Record<string, string> = { rare: '#5ad1ff', epic: '#a98bff' }
export const bandColorFor = (k: string) => BAND_COLORS[k] ?? COLORS.text

/** Cuánto dura la fila `key`. Una carta sin año empieza directamente por el grado. */
const ROW_MS: Record<string, number> = { Year: PHASE.year, Grade: PHASE.grade, Rarity: PHASE.rarity }

export interface RevealTimeline {
  /** Instante en que entra cada fila, en el orden en que se pasaron. */
  rowAt: number[]
  /** Instante en que entra la franja, o null si esa rareza no lleva. */
  bandAt: number | null
  /** Instante en que la carta empieza a moverse, y cuánto dura ese movimiento. */
  turnAt: number
  turnMs: number
  /** Instante en que queda de cara. */
  faceUpAt: number
}

/**
 * Convierte las duraciones en instantes. Los tiempos salen de las filas que REALMENTE trae la
 * carta: si no hay año, todo lo demás sube en bloque en vez de quedarse un hueco muerto.
 *
 * `rowKeys` son las etiquetas en orden ('Year' | 'Grade' | 'Rarity').
 */
export function buildTimeline(rowKeys: readonly string[], rarity: string | null | undefined): RevealTimeline {
  const rowAt: number[] = []
  let t = 0
  for (const k of rowKeys) { rowAt.push(t); t += ROW_MS[k] ?? PHASE.grade }
  // `t` es ahora el final de la última fila: de ahí cuelga todo lo que viene después.

  const band = bandRarity(rarity)
  if (!band) {
    return { rowAt, bandAt: null, turnAt: t, turnMs: PHASE.plainTurn, faceUpAt: t + PHASE.plainTurn }
  }
  const bandAt = t
  const turnAt = bandAt + PHASE.band + (band === 'epic' ? PHASE.epicWait : 0)
  const turnMs = band === 'epic' ? PHASE.epicTurn : PHASE.rareTurn
  return { rowAt, bandAt, turnAt, turnMs, faceUpAt: turnAt + turnMs }
}
