import { motion } from 'framer-motion'
import { COLORS } from '../theme'
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
        minHeight: '100dvh',
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
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 20 }}
        style={{
          background: COLORS.panel,
          border: `1px solid ${accent}55`,
          borderRadius: '14px',
          padding: '40px 28px',
          maxWidth: '360px',
          width: '100%',
          boxShadow: celebrate ? `0 0 32px ${COLORS.green}33` : 'none',
          position: 'relative',
          zIndex: 41,
        }}
      >
        <motion.div
          initial={reduced ? false : { scale: 0, rotate: -25 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 240, damping: 12, delay: reduced ? 0 : 0.15 }}
          style={{ fontSize: '52px', marginBottom: '12px' }}
        >
          {celebrate ? '🏆' : '🥈'}
        </motion.div>
        <div style={{ fontSize: '11px', color: COLORS.muted, letterSpacing: '.08em', marginBottom: '8px' }}>
          RESULTADO FINAL
        </div>
        <div style={{ fontSize: '26px', fontWeight: 800, color: accent, marginBottom: '32px', lineHeight: 1.2 }}>
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
            boxShadow: '0 0 12px #34e29b55',
            minHeight: '52px',
          }}
        >
          Valorar la partida
        </motion.button>
      </motion.div>
    </div>
  )
}
