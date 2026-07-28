import { COLORS } from '../../theme'

// ⏱️ Ritmo del modo APILADO (`stacked`, el reveal del Battle Royale), en ms.
// first = cuándo aparece la primera fila · step = separación entre filas ·
// rarityExtra = pausa de más antes de la rareza, que es la fila que remata ·
// hold = cuánto se contempla el trío completo antes de voltear (solo sin franja).
export const STACK_T = { first: 500, step: 500, rarityExtra: 250, hold: 900 }

// ⏱️ Franja de rareza, en ms DESDE QUE APARECE LA FILA DE RAREZA. Relativos y no absolutos
// porque no todas las cartas traen año y grado: si falta alguno, la rareza cae antes y todo lo
// demás la sigue en vez de descuadrarse.
//
// Con las tres filas presentes salen los tiempos acordados:
//   año 500 · grado 1000 · rareza 1750 · franja 2100 · giro epic 2700 · epic de cara 4500
//   · rare de cara 3500
export const BAND_T = {
  band: 350,        // la franja entra
  epicSpin: 950,    // Epic: la carta arranca a girar y la franja empieza a irse
  epicLand: 2750,   // Epic: queda de cara (giro de 1800 ms)
  rareFlip: 1750,   // Rare: volteo normal, la franja se va con él
}

/** Vueltas del giro de Epic. 1980° ≡ 180°, así que aterriza de cara sin salto. */
export const EPIC_SPIN_DEG = 1980

/** Lo que tarda el volteo normal (el muelle de framer): la franja se desvanece a ese ritmo. */
export const FLIP_MS = 620

/** Rarezas que se llevan franja. El resto pasa de largo, como hasta ahora. */
export function bandRarity(rarity: string | null | undefined): 'rare' | 'epic' | null {
  const k = (rarity ?? '').toLowerCase()
  return k === 'rare' || k === 'epic' ? k : null
}

const BAND_COLORS: Record<string, string> = { rare: '#5ad1ff', epic: '#a98bff' }
export const bandColorFor = (k: string) => BAND_COLORS[k] ?? COLORS.text
