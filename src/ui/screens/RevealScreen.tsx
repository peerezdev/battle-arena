import type { Allocation, FrontKey, FrontWinner, MatchState } from '../../engine'
import { solidez } from '../../engine'
import { COLORS, player as playerTheme } from '../theme'

interface Props {
  allocA: Allocation
  allocB: Allocation
  frontWinners: Record<FrontKey, FrontWinner>
  roundWinner: FrontWinner
  nameA: string
  nameB: string
  onContinue: () => void
  state: MatchState
}

const FRONTS: { key: FrontKey; label: string; icon: string }[] = [
  { key: 'apertura', label: 'Apertura', icon: '⚔️' },
  { key: 'choque', label: 'Choque', icon: '💥' },
  { key: 'remate', label: 'Remate', icon: '🎯' },
]

export function RevealScreen({ allocA, allocB, frontWinners, roundWinner, nameA, nameB, onContinue, state }: Props) {
  const solA = solidez(state.cardA)
  const solB = solidez(state.cardB)

  function winnerTag(w: FrontWinner) {
    if (w === 'a') return { label: `🟢 ${nameA}`, color: COLORS.green }
    if (w === 'b') return { label: `🔴 ${nameB}`, color: COLORS.red }
    return { label: '⚪ Disputado', color: COLORS.muted }
  }

  function aguanteNote(frontKey: FrontKey): string | null {
    const aVal = allocA[frontKey]
    const bVal = allocB[frontKey]
    const winner = frontWinners[frontKey]
    // Aguante = tie in energy, winner decided by Solidez (not 'disputed')
    if (aVal === bVal && winner !== 'disputed') {
      const winnerSol = winner === 'a' ? solA : solB
      const loserSol = winner === 'a' ? solB : solA
      const winName = winner === 'a' ? `🟢 ${nameA}` : `🔴 ${nameB}`
      return `Aguante: gana ${winName} por Solidez ${winnerSol} vs ${loserSol}`
    }
    return null
  }

  const roundWinTag = winnerTag(roundWinner)

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily: 'Inter, system-ui, sans-serif',
        padding: '0 16px 32px',
      }}
    >
      <div style={{ maxWidth: '420px', margin: '0 auto', paddingTop: '24px' }}>
        {/* Header */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', color: COLORS.muted, letterSpacing: '.06em', marginBottom: '2px' }}>REVEAL</div>
          <div style={{ fontSize: '22px', fontWeight: 800 }}>Resultados de la ronda</div>
        </div>

        {/* Column headers */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr 1fr',
            gap: '4px',
            fontSize: '10px',
            color: COLORS.muted,
            letterSpacing: '.05em',
            marginBottom: '6px',
            padding: '0 4px',
          }}
        >
          <span>FRENTE</span>
          <span style={{ textAlign: 'right', color: COLORS.green }}>🟢 {nameA}</span>
          <span style={{ textAlign: 'right', color: COLORS.red }}>🔴 {nameB}</span>
          <span style={{ textAlign: 'right' }}>GANADOR</span>
        </div>

        {/* Front rows */}
        {FRONTS.map((f, i) => {
          const tag = winnerTag(frontWinners[f.key])
          const aguante = aguanteNote(f.key)
          return (
            <div
              key={f.key}
              className="animate-flip-in"
              style={{
                background: COLORS.panel,
                border: `1px solid ${COLORS.border}`,
                borderRadius: '6px',
                padding: '10px 12px',
                marginBottom: '6px',
                animationDelay: `${i * 120}ms`,
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr 1fr',
                  gap: '4px',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontWeight: 600, fontSize: '13px' }}>{f.icon} {f.label}</span>
                <span
                  style={{
                    textAlign: 'right',
                    fontWeight: frontWinners[f.key] === 'a' ? 700 : 400,
                    fontSize: '18px',
                    color: frontWinners[f.key] === 'a' ? COLORS.green : COLORS.text,
                  }}
                >
                  {allocA[f.key]}
                </span>
                <span
                  style={{
                    textAlign: 'right',
                    fontWeight: frontWinners[f.key] === 'b' ? 700 : 400,
                    fontSize: '18px',
                    color: frontWinners[f.key] === 'b' ? COLORS.red : COLORS.text,
                  }}
                >
                  {allocB[f.key]}
                </span>
                <span
                  style={{
                    textAlign: 'right',
                    fontWeight: 700,
                    fontSize: '12px',
                    color: tag.color,
                  }}
                >
                  {tag.label}
                </span>
              </div>
              {aguante && (
                <div
                  style={{
                    fontSize: '11px',
                    color: COLORS.muted,
                    marginTop: '6px',
                    borderTop: `1px solid ${COLORS.border}`,
                    paddingTop: '4px',
                    fontStyle: 'italic',
                  }}
                >
                  {aguante}
                </div>
              )}
            </div>
          )
        })}

        {/* Round winner banner */}
        <div
          style={{
            background: roundWinner === 'disputed' ? COLORS.panel : playerTheme[roundWinner as 'a' | 'b']?.gradient ?? COLORS.panel,
            border: `1px solid ${roundWinTag.color}55`,
            borderRadius: '8px',
            padding: '14px',
            textAlign: 'center',
            margin: '16px 0',
            boxShadow: `0 0 16px ${roundWinTag.color}33`,
          }}
        >
          <div style={{ fontSize: '11px', color: COLORS.muted, letterSpacing: '.06em', marginBottom: '4px' }}>
            RESULTADO DE LA RONDA
          </div>
          <div style={{ fontSize: '20px', fontWeight: 800, color: roundWinTag.color }}>
            {roundWinner === 'disputed' ? 'Ronda nula (rejugar)' : `Gana la ronda: ${roundWinTag.label}`}
          </div>
        </div>

        {/* Continue button */}
        <button
          onClick={onContinue}
          style={{
            width: '100%',
            background: COLORS.green,
            color: '#04130c',
            border: 'none',
            borderRadius: '6px',
            padding: '14px',
            fontSize: '15px',
            fontWeight: 800,
            cursor: 'pointer',
            letterSpacing: '.03em',
            boxShadow: '0 0 12px #34e29b55',
          }}
        >
          Continuar →
        </button>
      </div>
    </div>
  )
}
