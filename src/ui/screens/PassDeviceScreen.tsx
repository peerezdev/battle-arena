import { COLORS } from '../theme'

export function PassDeviceScreen({ nextPlayer, onReady }: { nextPlayer: string; onReady: () => void }) {
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
      }}
    >
      <div
        style={{
          background: COLORS.panel,
          border: `1px solid ${COLORS.border}`,
          borderRadius: '12px',
          padding: '32px 24px',
          maxWidth: '360px',
          width: '100%',
        }}
      >
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>📲</div>
        <div style={{ fontSize: '20px', fontWeight: 800, marginBottom: '8px', color: COLORS.text }}>
          Pass the device to
        </div>
        <div style={{ fontSize: '22px', fontWeight: 800, color: COLORS.violet, marginBottom: '16px' }}>
          {nextPlayer}
        </div>
        <div style={{ fontSize: '13px', color: COLORS.muted, marginBottom: '28px', lineHeight: 1.5 }}>
          Don't let the other player see the previous screen.
        </div>
        <button
          onClick={onReady}
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
            boxShadow: '0 0 12px #2fe28a55',
          }}
        >
          Ready ✓
        </button>
      </div>
    </div>
  )
}
