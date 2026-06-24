import { motion } from 'framer-motion'
import { COLORS, FONTS } from '../theme'
import { Confetti } from '../components/Confetti'
import { useReducedMotion } from '../useReducedMotion'
import { useEffect } from 'react'
import { playSfx, haptic } from '../sound'

interface Props {
  winnerLabel: string
  onFeedback: () => void
  /** Celebrate (you/a player won) vs subdued (you lost). */
  celebrate?: boolean
}

function TrophySvg() {
  return (
    <svg width="52" height="52" viewBox="0 0 24 24" fill="none"
      stroke="#f59e0b" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M8 21h8M12 17v4M17 3h3a1 1 0 0 1 1 1v1a4 4 0 0 1-4 4h-.18" />
      <path d="M7 3H4a1 1 0 0 0-1 1v1a4 4 0 0 0 4 4H7" />
      <path d="M12 17a5 5 0 0 0 5-5V3H7v9a5 5 0 0 0 5 5Z" />
    </svg>
  )
}

function MedalSvg() {
  return (
    <svg width="52" height="52" viewBox="0 0 24 24" fill="none"
      stroke="#7c89a8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <circle cx="12" cy="14" r="6" />
      <path d="M8 2h8l-2 6H10L8 2Z" />
      <line x1="12" y1="11" x2="12" y2="17" />
    </svg>
  )
}

export function ResultScreen({ winnerLabel, onFeedback, celebrate = true }: Props) {
  const reduced = useReducedMotion()
  const accent = celebrate ? COLORS.green : COLORS.muted

  useEffect(() => {
    if (celebrate) {
      playSfx('win')
      haptic([20, 50, 20, 50, 20])
    } else {
      playSfx('lose')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      style={{
        minHeight: '100%',
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily: 'Inter, system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 16px',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <Confetti active={celebrate && !reduced} />

      <motion.div
        initial={reduced ? false : { opacity: 0, scale: 0.92, y: 14 }}
        animate={
          celebrate && !reduced
            ? {
                opacity: 1, scale: 1, y: 0,
                boxShadow: [
                  `0 0 32px ${COLORS.green}33`,
                  `0 0 48px ${COLORS.green}66`,
                  `0 0 32px ${COLORS.green}33`,
                ],
              }
            : { opacity: 1, scale: 1, y: 0, boxShadow: 'none' }
        }
        transition={
          celebrate && !reduced
            ? { opacity: { duration: 0.5 }, scale: { type: 'spring', stiffness: 280, damping: 20 }, y: { type: 'spring', stiffness: 280, damping: 20 }, boxShadow: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' } }
            : { type: 'spring', stiffness: 280, damping: 20 }
        }
        style={{
          background: COLORS.panel,
          border: `1px solid ${accent}55`,
          borderRadius: '14px',
          padding: '40px 28px',
          maxWidth: '360px',
          width: '100%',
          position: 'relative',
          zIndex: 41,
        }}
      >
        <motion.div
          initial={reduced ? false : { scale: 0, rotate: -25 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 240, damping: 12, delay: reduced ? 0 : 0.15 }}
          style={{ marginBottom: '12px', display: 'flex', justifyContent: 'center' }}
        >
          {celebrate ? <TrophySvg /> : <MedalSvg />}
        </motion.div>
        <div style={{ fontSize: '11px', color: COLORS.muted, letterSpacing: '.08em', marginBottom: '8px', fontFamily: FONTS.mono }}>
          FINAL RESULT
        </div>
        <div style={{ fontSize: '26px', fontWeight: 800, color: accent, marginBottom: '32px', lineHeight: 1.2, fontFamily: FONTS.display }}>
          {winnerLabel}
        </div>
        <motion.button
          onClick={onFeedback}
          whileTap={reduced ? undefined : { scale: 0.97 }}
          style={{
            width: '100%',
            background: COLORS.green,
            color: '#04130c',
            border: 'none',
            borderRadius: '10px',
            padding: '16px',
            fontSize: '15px',
            fontWeight: 800,
            cursor: 'pointer',
            letterSpacing: '.03em',
            boxShadow: '0 0 12px #2fe28a55',
            minHeight: '52px',
          }}
        >
          Rate the game
        </motion.button>
      </motion.div>
    </div>
  )
}
