import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { COLORS, FONTS, SHADOW } from '../../theme'
import { rarityColor } from './RevealCard'
import { CardBack } from './CardBack'

type Stage = 'year' | 'grade' | 'rarity' | 'card'

/** Gacha-style staged reveal as a 3D flip card: during YEAR → GRADE → RARITY it shows the
 *  card back (rarity-glow) with the stage text on top; on the card stage it flips (rotateY)
 *  to the front (`children`). Reduced-motion shows the front immediately. `onCardShown` fires
 *  once the card stage lands. */
export function StagedCardReveal({
  year, grade, rarity, reduced, stepMs = 1700, dwellMs = 550, width = 180, height = 252, onCardShown, children,
}: {
  year: string | null
  grade: number | string | null
  rarity: string | null
  reduced: boolean
  stepMs?: number
  dwellMs?: number    // how long the revealed card stays before onCardShown advances (ms)
  width?: number
  height?: number
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

  const [i, setI] = useState(reduced ? stages.length - 1 : 0)

  useEffect(() => {
    if (reduced) return
    if (i >= stages.length - 1) return
    const t = setTimeout(() => setI((n) => Math.min(n + 1, stages.length - 1)), stepMs)
    return () => clearTimeout(t)
  }, [i, stages.length, reduced, stepMs])

  const stage = stages[i]
  const onCard = stage === 'card'

  // The rarity color must land WITH the rarity text, not before. With AnimatePresence mode="wait"
  // the rarity text only mounts after the previous stage finishes exiting, so we flip the back color
  // when that text's enter animation STARTS (opacity === 1 distinguishes enter from exit).
  const [accentOn, setAccentOn] = useState(false)
  // Common stays like the neutral state — no rarity color, no strong beam.
  const isCommon = (rarity ?? '').toLowerCase() === 'common'
  const backAccent = accentOn && !isCommon ? rc : COLORS.muted

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
          <CardBack width={width} height={height} accent={backAccent} strong={accentOn && !isCommon} />
          {!onCard && (
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
