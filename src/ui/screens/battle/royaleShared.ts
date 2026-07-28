import { COLORS } from '../../theme'

export function shortWallet(w: string): string {
  return w.length > 9 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w
}

const TINTS = [
  'linear-gradient(135deg,#ff6bb5,#d4127a)',
  'linear-gradient(135deg,#4ea8ff,#6a5bff)',
  'linear-gradient(135deg,#f5c542,#e8732c)',
  'linear-gradient(135deg,#00ffc4,#1aa0d8)',
  'linear-gradient(135deg,#ff6e8a,#d23a5e)',
]

export function tintFor(w: string): string {
  const h = Math.abs([...w].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) | 0, 0))
  return TINTS[h % TINTS.length]
}

/** The pot is the prize — same gold as the champion badge and the #1 medal. */
export const POT_GOLD = '#f5c542'

export function medalColor(rank: number): string {
  return rank === 1 ? '#f5c542' : rank === 2 ? '#c8d0da' : rank === 3 ? '#e8964e' : COLORS.muted
}

/**
 * What to call a pull in a one-line summary: "Charizard VMAX", or "Common" when there's no usable
 * name. Bot and mock pulls store the insured value in `name`, so the obvious template would render
 * "150 · $150" — the same number twice, which reads like a bug. The rarity is always present and
 * actually adds something, so it's the fallback.
 *
 * Returns the label only; callers render the value themselves so a long card name can truncate
 * without swallowing the amount.
 */
export function pullTitle(
  card: { name: string | null; rarity: string | null; insuredValue: number | null } | null,
): string | null {
  if (!card) return null
  const name = card.name?.trim()
  const isJustTheValue = !!name && Number(name) === (card.insuredValue ?? 0)
  return name && !isJustTheValue ? name : (card.rarity ?? 'card')
}

/** Recorrido de la ruleta: 4 pasadas por los empatados y deceleración hasta el que cae. */
export function spinSequence(tied: string[], eliminated: string | null): string[] {
  const base = tied.length ? tied : (eliminated ? [eliminated] : [])
  if (base.length === 0) return []
  const endAt = Math.max(0, base.indexOf(eliminated ?? base[base.length - 1]))
  const s: string[] = []
  const CYCLES = 4
  for (let c = 0; c < CYCLES; c++) for (const w of base) s.push(w)
  for (let i = 0; i <= endAt; i++) s.push(base[i])   // decelerate onto the loser
  return s
}

/** Retardo del paso `i` de una secuencia de `n`: 55ms → ~355ms, ease-out. */
export function spinStepMs(i: number, n: number): number {
  const progress = i / Math.max(1, n - 1)
  return Math.round(55 + progress * progress * 300)
}

/**
 * Cuánto tarda la ruleta en aterrizar. La usa el hook para dimensionar la fase: con un tiempo
 * fijo, a partir de 5 empatados el giro (3,6s y subiendo) se cortaba antes de llegar al final y
 * el eliminado no se llegaba a ver nunca.
 */
export function spinDurationMs(tied: string[], eliminated: string | null): number {
  const n = spinSequence(tied, eliminated).length
  let total = 0
  for (let i = 0; i < Math.max(0, n - 1); i++) total += spinStepMs(i, n)
  return total
}
