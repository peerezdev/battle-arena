import { useState } from 'react'
import { COLORS, FONTS } from '../../theme'
import { useDelegation } from '../../../wallet/useDelegation'

// TEMP dev panel for Pack Battle session-signer provisioning. Surfaces the
// addSigners outcome on screen (no console on mobile) + a busy/loading state.
export function DelegationPanel() {
  const { delegated, enable } = useDelegation()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string>('')

  async function onEnable() {
    setBusy(true)
    setStatus('')
    try {
      await enable()
      setStatus('✓ Signing access granted (session signer added).')
    } catch (e) {
      setStatus('ERROR: ' + (e instanceof Error ? `${e.name}: ${e.message}` : String(e)))
    } finally {
      setBusy(false)
    }
  }

  const done = delegated || status.startsWith('✓')

  return (
    <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, marginTop: 16 }}>
      <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 14, color: COLORS.text, marginBottom: 6 }}>Pack Battle signing</div>
      <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 10, lineHeight: 1.5 }}>
        Grant signing access so battles run without pop-ups. You can revoke it anytime in Privy.
      </div>
      {done ? (
        <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.green }}>✓ Enabled</div>
      ) : (
        <button
          onClick={() => void onEnable()}
          disabled={busy}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: busy ? COLORS.panel2 : COLORS.green,
            color: busy ? COLORS.muted : '#03110a',
            border: 'none', borderRadius: 10, padding: '10px 16px',
            fontWeight: 800, fontFamily: FONTS.display,
            cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.8 : 1,
            transition: 'opacity 0.15s',
          }}
        >
          {busy && (
            <span style={{
              width: 13, height: 13, borderRadius: '50%',
              border: `2px solid ${COLORS.muted}`, borderTopColor: 'transparent',
              display: 'inline-block', animation: 'ba-spin 0.7s linear infinite',
            }} />
          )}
          {busy ? 'Granting…' : 'Enable'}
        </button>
      )}
      {status && (
        <div style={{ marginTop: 10, fontFamily: FONTS.mono, fontSize: 11, color: status.startsWith('ERROR') ? COLORS.red : COLORS.green, lineHeight: 1.5, wordBreak: 'break-word' }}>
          {status}
        </div>
      )}
      <style>{'@keyframes ba-spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  )
}
