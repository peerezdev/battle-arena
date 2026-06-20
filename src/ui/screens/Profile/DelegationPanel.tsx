import { COLORS, FONTS } from '../../theme'
import { useDelegation } from '../../../wallet/useDelegation'

export function DelegationPanel() {
  const { delegated, enable } = useDelegation()
  return (
    <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, marginTop: 16 }}>
      <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 14, color: COLORS.text, marginBottom: 6 }}>Pack Battle signing</div>
      <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 10, lineHeight: 1.5 }}>
        Delegate signing so battles run without pop-ups. You can revoke anytime in Privy.
      </div>
      {delegated
        ? <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.green }}>✓ Delegated</div>
        : <button onClick={() => void enable()} style={{ background: COLORS.green, color: '#03110a', border: 'none', borderRadius: 10, padding: '10px 16px', fontWeight: 800, fontFamily: FONTS.display, cursor: 'pointer' }}>Enable</button>}
    </div>
  )
}
