import { COLORS, FONTS } from '../theme'
import type { useDelegationGate } from './useDelegationGate'

export function DelegationGate({ gate }: { gate: ReturnType<typeof useDelegationGate> }) {
  if (!gate.open) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={gate.cancel}
      style={{
        position: 'fixed', inset: 0, background: '#000000aa', zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.panel, border: `1px solid ${COLORS.border}`,
          borderRadius: 14, padding: 22, maxWidth: 380, width: '100%',
        }}
      >
        <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 16, color: COLORS.text, marginBottom: 8 }}>
          Habilitar firma de batalla
        </div>
        <div style={{ fontSize: 12.5, color: COLORS.muted, lineHeight: 1.5, marginBottom: 16 }}>
          Para crear o unirte a una batalla, concede acceso de firma (session signer) para que las
          tiradas se ejecuten en el servidor sin pop-ups. Puedes revocarlo cuando quieras en Privy.
        </div>
        {gate.error && (
          <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.red, marginBottom: 12, wordBreak: 'break-word' }}>
            ERROR: {gate.error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={gate.cancel}
            disabled={gate.busy}
            style={{
              background: 'transparent', color: COLORS.muted,
              border: `1px solid ${COLORS.border}`, borderRadius: 10,
              padding: '10px 16px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            Cancelar
          </button>
          <button
            onClick={() => void gate.confirm()}
            disabled={gate.busy}
            style={{
              background: gate.busy ? COLORS.panel2 : COLORS.green,
              color: gate.busy ? COLORS.muted : '#03110a',
              border: 'none', borderRadius: 10, padding: '10px 18px',
              fontWeight: 800, fontFamily: FONTS.display,
              cursor: gate.busy ? 'wait' : 'pointer',
            }}
          >
            {gate.busy ? 'Concediendo…' : 'Habilitar'}
          </button>
        </div>
      </div>
    </div>
  )
}
