import { COLORS } from '../theme'

export function ResultScreen({ winnerLabel, onFeedback }: { winnerLabel: string; onFeedback: () => void }) {
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
      }}
    >
      <div
        style={{
          background: COLORS.panel,
          border: `1px solid ${COLORS.green}55`,
          borderRadius: '12px',
          padding: '40px 28px',
          maxWidth: '360px',
          width: '100%',
          boxShadow: '0 0 32px #34e29b22',
        }}
      >
        <div style={{ fontSize: '52px', marginBottom: '12px' }}>🏆</div>
        <div style={{ fontSize: '11px', color: COLORS.muted, letterSpacing: '.08em', marginBottom: '8px' }}>
          RESULTADO FINAL
        </div>
        <div style={{ fontSize: '26px', fontWeight: 800, color: COLORS.green, marginBottom: '32px', lineHeight: 1.2 }}>
          {winnerLabel}
        </div>
        <button
          onClick={onFeedback}
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
          Valorar la partida
        </button>
      </div>
    </div>
  )
}
