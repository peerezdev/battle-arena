import { motion } from 'framer-motion'
import type { RoyaleState } from '../../../royale/types'
import { COLORS, FONTS, SHADOW, formatUsd } from '../../theme'

interface Props {
  state: RoyaleState
  onPlayAgain: () => void
  onExit: () => void
  reducedMotion: boolean
}

function potValue(pot: RoyaleState['pot']): number {
  return pot.reduce((s, c) => s + c.valueUsd, 0)
}

export function RoyaleResultScreen({ state, onPlayAgain, onExit, reducedMotion }: Props) {
  const { winnerId, players, pot, history } = state
  const winner = players.find((p) => p.id === winnerId) ?? null
  const humanPlayer = players[0]
  const isHumanWinner = winnerId === 0
  const humanEliminatedRound = humanPlayer?.eliminatedRound ?? null

  const totalPot = potValue(pot)
  const roundsPlayed = history.length
  const accentColor = isHumanWinner ? COLORS.green : COLORS.muted

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
      {/* Background glow when human wins */}
      {isHumanWinner && !reducedMotion && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            background: `radial-gradient(ellipse at 50% 40%, ${COLORS.green}18 0%, transparent 70%)`,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Winner panel */}
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, scale: 0.92, y: 14 }}
        animate={
          isHumanWinner && !reducedMotion
            ? {
                opacity: 1,
                scale: 1,
                y: 0,
                boxShadow: [
                  `${SHADOW.panel}, ${SHADOW.glow(COLORS.green)}`,
                  `${SHADOW.panel}, 0 0 32px ${COLORS.green}44`,
                  `${SHADOW.panel}, ${SHADOW.glow(COLORS.green)}`,
                ],
              }
            : { opacity: 1, scale: 1, y: 0, boxShadow: 'none' }
        }
        transition={
          isHumanWinner && !reducedMotion
            ? {
                opacity: { duration: 0.45 },
                scale: { type: 'spring', stiffness: 280, damping: 20 },
                y: { type: 'spring', stiffness: 280, damping: 20 },
                boxShadow: { duration: 2.2, repeat: Infinity, ease: 'easeInOut' },
              }
            : { type: 'spring', stiffness: 280, damping: 20 }
        }
        style={{
          background: COLORS.panel,
          border: `1px solid ${accentColor}55`,
          borderRadius: '14px',
          padding: '36px 28px',
          maxWidth: '380px',
          width: '100%',
          position: 'relative',
          zIndex: 10,
        }}
      >
        {/* Trophy / icon */}
        <motion.div
          initial={reducedMotion ? false : { scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{
            type: 'spring',
            stiffness: 240,
            damping: 12,
            delay: reducedMotion ? 0 : 0.15,
          }}
          style={{
            fontSize: '48px',
            marginBottom: '12px',
            display: 'flex',
            justifyContent: 'center',
          }}
          aria-hidden="true"
        >
          {isHumanWinner ? '🏆' : '💀'}
        </motion.div>

        {/* Label */}
        <div
          style={{
            fontSize: '11px',
            color: COLORS.muted,
            letterSpacing: '.08em',
            marginBottom: '6px',
            fontFamily: FONTS.mono,
          }}
        >
          FINAL RESULT
        </div>

        {/* Winner name */}
        <div
          style={{
            fontSize: '24px',
            fontWeight: 800,
            color: accentColor,
            fontFamily: FONTS.display,
            lineHeight: 1.2,
            marginBottom: '4px',
          }}
        >
          {isHumanWinner ? 'You won!' : winner?.name ?? '—'}
        </div>
        {!isHumanWinner && winner && (
          <div
            style={{
              fontSize: '12px',
              color: COLORS.muted,
              fontFamily: FONTS.mono,
              marginBottom: '8px',
            }}
          >
            takes the pot
          </div>
        )}

        {/* Pot */}
        <div
          style={{
            background: COLORS.bg,
            border: `1px solid ${'#f59e0b'}44`,
            borderRadius: '8px',
            padding: '12px 16px',
            margin: '16px 0',
          }}
        >
          <div
            style={{
              fontSize: '10px',
              fontFamily: FONTS.mono,
              color: COLORS.muted,
              letterSpacing: '.07em',
              marginBottom: '4px',
            }}
          >
            POT WON
          </div>
          <div
            style={{
              fontSize: '28px',
              fontWeight: 800,
              fontFamily: FONTS.display,
              color: '#f59e0b',
              lineHeight: 1,
              marginBottom: '2px',
            }}
          >
            {formatUsd(totalPot)}
          </div>
          <div
            style={{
              fontSize: '11px',
              fontFamily: FONTS.mono,
              color: COLORS.muted,
            }}
          >
            {pot.length} card{pot.length !== 1 ? 's' : ''} in the pot
          </div>
        </div>

        {/* Recap */}
        <div
          style={{
            background: COLORS.bg,
            border: `1px solid ${COLORS.border}`,
            borderRadius: '8px',
            padding: '10px 14px',
            marginBottom: '20px',
            textAlign: 'left',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          <RecapRow label="Rounds played" value={String(roundsPlayed)} />
          <RecapRow label="Players" value={String(players.length)} />
          {!isHumanWinner && humanEliminatedRound !== null && (
            <RecapRow
              label="Out in round"
              value={String(humanEliminatedRound)}
              valueColor={COLORS.red}
            />
          )}
        </div>

        {/* Buttons */}
        <button
          type="button"
          onClick={onPlayAgain}
          style={{
            width: '100%',
            background: COLORS.green,
            color: '#04130c',
            border: 'none',
            borderRadius: '10px',
            padding: '14px',
            fontSize: '15px',
            fontWeight: 800,
            cursor: 'pointer',
            letterSpacing: '.03em',
            boxShadow: SHADOW.glow(COLORS.green),
            marginBottom: '10px',
            fontFamily: FONTS.display,
          }}
        >
          Play again
        </button>
        <button
          type="button"
          onClick={onExit}
          style={{
            width: '100%',
            background: 'transparent',
            color: COLORS.muted,
            border: `1px solid ${COLORS.border}`,
            borderRadius: '10px',
            padding: '12px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            letterSpacing: '.02em',
          }}
        >
          Exit
        </button>
      </motion.div>
    </div>
  )
}

function RecapRow({
  label,
  value,
  valueColor,
}: {
  label: string
  value: string
  valueColor?: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        fontSize: '12px',
        fontFamily: FONTS.mono,
      }}
    >
      <span style={{ color: COLORS.muted, letterSpacing: '.02em' }}>{label}</span>
      <span style={{ color: valueColor ?? COLORS.text, fontWeight: 700 }}>{value}</span>
    </div>
  )
}
