import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

interface Props {
  /** When true the card shows its face; when false it shows its back. */
  flipped: boolean
  back: ReactNode
  front: ReactNode
  /** Skip the 3D rotation (reduced motion). */
  reducedMotion?: boolean
  delay?: number
  minHeight?: number | string
}

/** 3D card flip via CSS rotateY + perspective. No assets. */
export function FlipCard({ flipped, back, front, reducedMotion = false, delay = 0, minHeight = 56 }: Props) {
  if (reducedMotion) {
    // Instant — just render the eventual face.
    return <div style={{ minHeight }}>{flipped ? front : back}</div>
  }

  return (
    <div style={{ perspective: 800, minHeight }}>
      <motion.div
        initial={false}
        animate={{ rotateY: flipped ? 0 : 180 }}
        transition={{ duration: 0.5, delay, ease: 'easeOut' }}
        style={{
          position: 'relative',
          width: '100%',
          minHeight,
          transformStyle: 'preserve-3d',
        }}
      >
        {/* Face */}
        <div
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
          }}
        >
          {front}
        </div>
        {/* Back */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: 'rotateY(180deg)',
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
          }}
        >
          {back}
        </div>
      </motion.div>
    </div>
  )
}
