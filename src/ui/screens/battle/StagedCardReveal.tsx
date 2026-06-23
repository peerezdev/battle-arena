import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { COLORS, FONTS, SHADOW } from '../../theme'
import { rarityColor } from './RevealCard'

type Stage = 'year' | 'grade' | 'rarity' | 'card'

/** Gacha-style staged reveal: YEAR → GRADE → RARITY → CARD (only the stages that exist).
 *  Steps every `stepMs`; reduced-motion jumps straight to the card. Fires `onCardShown`
 *  once the card stage lands. The card itself is supplied via `children`. */
export function StagedCardReveal({
  year, grade, rarity, reduced, stepMs = 1700, onCardShown, children,
}: {
  year: string | null
  grade: number | string | null
  rarity: string | null
  reduced: boolean
  stepMs?: number
  onCardShown?: () => void
  children: ReactNode
}) {
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

  useEffect(() => {
    if (onCard) onCardShown?.()
    // Fire once when the card stage is reached; onCardShown identity intentionally ignored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCard])

  if (onCard) return <>{children}</>

  const rc = rarityColor(rarity)
  const label = stage.toUpperCase()
  const value = stage === 'year' ? year : stage === 'grade' ? grade : rarity
  const valueColor = stage === 'rarity' ? rc : COLORS.text
  const valueShadow = stage === 'rarity' ? SHADOW.glow(rc) : 'none'

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={stage}
        initial={{ scale: 0.72, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 1.12, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 24 }}
        style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, userSelect: 'none', minHeight: 252, justifyContent: 'center' }}
      >
        <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: COLORS.muted }}>
          {label}
        </div>
        <div style={{ fontFamily: FONTS.display, fontWeight: 900, fontSize: 42, color: valueColor, textShadow: valueShadow, lineHeight: 1 }}>
          {value}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
