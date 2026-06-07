import type { MatchState } from '../../engine'
import { player as playerTheme, COLORS } from '../theme'

interface Props {
  state: MatchState
  currentPlayer: 'a' | 'b'
}

export function AdvantageBanner({ state, currentPlayer }: Props) {
  const edgeA = state.edgePerRound.a
  const edgeB = state.edgePerRound.b

  // Which player (if any) has an edge?
  const advantagedPlayer = edgeA > 0 ? 'a' : edgeB > 0 ? 'b' : null

  if (advantagedPlayer === null) {
    // No edge — cards are even or edge is disabled
    return (
      <div
        style={{
          background: '#121a30',
          border: `1px solid ${COLORS.border}`,
          borderRadius: '6px',
          padding: '7px 10px',
          fontSize: '12px',
          marginBottom: '10px',
          color: COLORS.muted,
          textAlign: 'center',
        }}
      >
        ⚖️ Cartas parejas: sin ventaja por valor
      </div>
    )
  }

  const t = playerTheme[advantagedPlayer]
  const edge = advantagedPlayer === 'a' ? edgeA : edgeB
  const high = Math.max(state.cardA.valueUsd, state.cardB.valueUsd)
  const low = Math.min(state.cardA.valueUsd, state.cardB.valueUsd)
  const ratio = low > 0 ? (high / low).toFixed(1) : '?'

  // Message is from the perspective of the current player
  const isMyAdvantage = advantagedPlayer === currentPlayer
  const prefix = isMyAdvantage ? 'Tu carta vale' : 'Carta rival vale'

  return (
    <div
      style={{
        background: t.gradient,
        border: `1px solid ${t.borderColor}`,
        borderRadius: '6px',
        padding: '7px 10px',
        fontSize: '12px',
        marginBottom: '10px',
        color: t.color,
        boxShadow: t.glowLg,
      }}
    >
      ⚡ {prefix} <strong>{ratio}x</strong> → <strong>+{edge} energía/ronda</strong>
    </div>
  )
}
