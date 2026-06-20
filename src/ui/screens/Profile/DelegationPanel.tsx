import { useState } from 'react'
import { COLORS, FONTS } from '../../theme'
import { useDelegation } from '../../../wallet/useDelegation'

// TEMP dev panel for Pack Battle delegation. Surfaces the enable() outcome
// ON SCREEN so it can be debugged on mobile (no console available there).
export function DelegationPanel() {
  const { delegated, enable } = useDelegation()
  const [status, setStatus] = useState<string>('')

  async function onEnable() {
    setStatus('Delegando… (debería salir un modal de Privy)')
    try {
      await enable()
      setStatus('enable() resolvió sin error. Si no ves "✓ Delegated", el modal no llegó a delegar — recarga para refrescar el estado.')
    } catch (e) {
      setStatus('ERROR: ' + (e instanceof Error ? `${e.name}: ${e.message}` : String(e)))
    }
  }

  return (
    <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, marginTop: 16 }}>
      <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 14, color: COLORS.text, marginBottom: 6 }}>Pack Battle signing</div>
      <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 10, lineHeight: 1.5 }}>
        Delegate signing so battles run without pop-ups. You can revoke anytime in Privy.
      </div>
      {delegated
        ? <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.green }}>✓ Delegated</div>
        : <button onClick={() => void onEnable()} style={{ background: COLORS.green, color: '#03110a', border: 'none', borderRadius: 10, padding: '10px 16px', fontWeight: 800, fontFamily: FONTS.display, cursor: 'pointer' }}>Enable</button>}
      {status && (
        <div style={{ marginTop: 10, fontFamily: FONTS.mono, fontSize: 11, color: status.startsWith('ERROR') ? COLORS.red : COLORS.muted, lineHeight: 1.5, wordBreak: 'break-word' }}>
          {status}
        </div>
      )}
    </div>
  )
}
