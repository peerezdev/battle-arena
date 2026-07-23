import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { COLORS, FONTS, SHADOW } from '../../theme'
import { rarityColor } from './RevealCard'
import { CardBack } from './CardBack'

type Stage = 'year' | 'grade' | 'rarity' | 'card'

// ⏱️ Ritmo del modo APILADO (`stacked`, el reveal del Battle Royale), en ms.
// first = cuándo aparece la primera fila · step = separación entre filas ·
// hold = cuánto se contempla el trío completo antes de voltear la carta.
export const STACK_T = { first: 120, step: 780, hold: 900 }

/** Gacha-style staged reveal as a 3D flip card: during YEAR → GRADE → RARITY it shows the
 *  card back (rarity-glow) with the stage text on top; on the card stage it flips (rotateY)
 *  to the front (`children`). Reduced-motion shows the front immediately. `onCardShown` fires
 *  once the card stage lands.
 *
 *  `stacked` swaps the one-at-a-time text for the gacha's column: each value drops in under the
 *  previous one and STAYS, so the card is read as year + grade + rarity together before it flips.
 *  Off by default — Pack Battle's small cards have no room for three stacked rows. */
export function StagedCardReveal({
  year, grade, rarity, reduced, stepMs = 1700, dwellMs = 550, width = 180, height = 252,
  stacked = false, onCardShown, children,
}: {
  year: string | null
  grade: number | string | null
  rarity: string | null
  reduced: boolean
  stepMs?: number
  dwellMs?: number    // how long the revealed card stays before onCardShown advances (ms)
  width?: number
  height?: number
  stacked?: boolean   // show year/grade/rarity as a persistent column instead of one at a time
  onCardShown?: () => void
  children: ReactNode
}) {
  const rc = rarityColor(rarity)

  const stages = useMemo<Stage[]>(() => {
    const s: Stage[] = []
    if (year) s.push('year')
    if (grade != null && grade !== '') s.push('grade')
    if (rarity) s.push('rarity')
    s.push('card')
    return s
  }, [year, grade, rarity])

  // Stacked rows, in the order they drop in. Same source as `stages`, minus the card step.
  const rows = useMemo(() => {
    const r: { key: string; value: string; color?: string }[] = []
    if (year) r.push({ key: 'Year', value: String(year) })
    if (grade != null && grade !== '') r.push({ key: 'Grade', value: String(grade) })
    if (rarity) r.push({ key: 'Rarity', value: rarity.toUpperCase(), color: rc })
    return r
  }, [year, grade, rarity, rc])

  const [i, setI] = useState(reduced ? stages.length - 1 : 0)
  const [shown, setShown] = useState(reduced ? rows.length : 0)   // stacked: how many rows are in
  const [flipped, setFlipped] = useState(reduced)                 // stacked: card turned over

  useEffect(() => {
    if (reduced || stacked) return
    if (i >= stages.length - 1) return
    const t = setTimeout(() => setI((n) => Math.min(n + 1, stages.length - 1)), stepMs)
    return () => clearTimeout(t)
  }, [i, stages.length, reduced, stacked, stepMs])

  // Stacked schedule: drop each row in turn, hold the full column, then flip.
  useEffect(() => {
    if (!stacked || reduced) return
    const timers: ReturnType<typeof setTimeout>[] = []
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))
    rows.forEach((_, k) => at(STACK_T.first + k * STACK_T.step, () => setShown(k + 1)))
    at(STACK_T.first + Math.max(0, rows.length - 1) * STACK_T.step + STACK_T.hold, () => setFlipped(true))
    return () => timers.forEach(clearTimeout)
  }, [stacked, reduced, rows])

  const stage = stages[i]
  const onCard = stacked ? flipped : stage === 'card'

  // The rarity color must land WITH the rarity text, not before. With AnimatePresence mode="wait"
  // the rarity text only mounts after the previous stage finishes exiting, so we flip the back color
  // when that text's enter animation STARTS (opacity === 1 distinguishes enter from exit).
  const [accentOn, setAccentOn] = useState(false)
  // Common stays like the neutral state — no rarity color, no strong beam.
  const isCommon = (rarity ?? '').toLowerCase() === 'common'
  // Stacked has no exit animation to hook, and rarity is always the last row in — so the back
  // lights up exactly when that row lands.
  const lit = stacked ? (!!rarity && shown >= rows.length) : accentOn
  const backAccent = lit && !isCommon ? rc : COLORS.muted

  useEffect(() => {
    if (!onCard) return
    // Fire AFTER the flip lands so totals/leaders update once the card is actually shown
    // (not while it's still flipping). Reduced motion fires synchronously.
    if (reduced) { onCardShown?.(); return }
    const t = setTimeout(() => onCardShown?.(), dwellMs)
    return () => clearTimeout(t)
    // Fire once when the card stage is reached; onCardShown identity intentionally ignored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCard])

  const stageValue = stage === 'year' ? year : stage === 'grade' ? grade : rarity

  // Stage text must fit the card on ONE line. Cards go down to ~76px wide on the mobile Pack
  // Battle grid, where fixed sizes wrapped mid-word ("UNCO / MMON"). Size from the text length
  // and the card width; the caps keep the original look on normal/desktop cards.
  // 0.72 = measured avg glyph width per font-size in the display face (~0.69), plus margin.
  const avail = Math.max(24, width - 16)
  const fitSize = (text: string, max: number) =>
    Math.max(9, Math.min(max, Math.floor(avail / (Math.max(1, text.length) * 0.72))))
  const valueSize = fitSize(String(stageValue ?? ''), stage === 'rarity' ? 20 : 34)

  return (
    <div style={{ width, height, perspective: 1100 }}>
      <motion.div
        animate={{ rotateY: onCard ? 180 : 0 }}
        transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 160, damping: 20 }}
        style={{ position: 'relative', width: '100%', height: '100%', transformStyle: 'preserve-3d' }}
      >
        {/* BACK — card back + the current stage text overlaid */}
        <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
          <CardBack width={width} height={height} accent={backAccent} strong={lit && !isCommon} quietMark={stacked} />
          {stacked && !onCard && (
            /* Column of values, each one staying put once it drops in. */
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'space-evenly', padding: `${Math.round(height * 0.07)}px 8px`,
            }}>
              {rows.map((r, k) => (
                <div key={r.key} style={{
                  textAlign: 'center', maxWidth: '100%',
                  opacity: shown > k ? 1 : 0,
                  transform: shown > k ? 'none' : 'translateY(10px) scale(.82)',
                  transition: 'opacity .35s ease-out, transform .45s cubic-bezier(.2,1.4,.4,1)',
                }}>
                  <div style={{ fontFamily: FONTS.mono, fontSize: Math.min(9, Math.max(7, Math.round(width / 22))), letterSpacing: '.18em', color: COLORS.muted, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                    {r.key}
                  </div>
                  <div style={{
                    fontFamily: FONTS.display, fontWeight: 900, lineHeight: 1.1, letterSpacing: '-.02em', marginTop: 3,
                    fontSize: fitSize(r.value, 26), whiteSpace: 'nowrap',
                    color: r.color ?? COLORS.text,
                    textShadow: r.color ? SHADOW.glow(r.color) : 'none',
                  }}>
                    {r.value}
                  </div>
                </div>
              ))}
            </div>
          )}
          {!stacked && !onCard && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AnimatePresence mode="wait">
                <motion.div
                  key={stage}
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 1.1, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                  onAnimationStart={(def) => { if (stage === 'rarity' && (def as { opacity?: number })?.opacity === 1) setAccentOn(true) }}
                  style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, userSelect: 'none' }}
                >
                  <div style={{ fontFamily: FONTS.mono, fontSize: Math.min(10, Math.max(7, Math.round(width / 18))), letterSpacing: '.14em', color: COLORS.muted, whiteSpace: 'nowrap' }}>{stage.toUpperCase()}</div>
                  <div style={{
                    fontFamily: FONTS.display, fontWeight: 900, lineHeight: 1.05,
                    // Sized to fit the card width on one line (longest real value: "uncommon").
                    fontSize: valueSize,
                    maxWidth: avail, textAlign: 'center', whiteSpace: 'nowrap',
                    color: stage === 'rarity' ? rc : COLORS.text, textShadow: stage === 'rarity' ? SHADOW.glow(rc) : 'none',
                  }}>
                    {stageValue}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* FRONT — mounted only at the card stage; the flip reveals it */}
        {onCard && (
          <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: 'rotateY(180deg)', display: 'flex', justifyContent: 'center' }}>
            {children}
          </div>
        )}
      </motion.div>
    </div>
  )
}
