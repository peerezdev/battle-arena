import { useState } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS, GRADIENT } from '../theme'
import { useProfile } from '../../hooks/useProfile'
import { validateUsername } from '../../profile/username'
import { config } from '../../onchain/config'
import { showToast } from '../toast'

/** Quick "set your username" modal — same POST /users/me/alias as Settings, so the user can
 *  pick a name without leaving the chat / current screen. */
export function UsernameModal({ onClose }: { onClose: () => void }) {
  const { refresh } = useProfile()
  const { identityToken } = useIdentityToken()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (saving) return
    const err = validateUsername(value)
    if (err) { setError(err); return }
    if (!identityToken) { setError('Log in to set a username.'); return }
    setSaving(true)
    setError(null)
    try {
      const resp = await fetch(`${config.backendUrl}/users/me/alias`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${identityToken}`, 'ngrok-skip-browser-warning': 'true' },
        body: JSON.stringify({ alias: value }),
      })
      if (resp.status === 409) { setError('That username is already taken.'); return }
      if (!resp.ok) { setError('Could not save. Try again.'); return }
      refresh()
      showToast(`Username set: ${value}`, 'success')
      onClose()
    } catch {
      setError('Network error.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: '#000000aa', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 22, maxWidth: 380, width: '100%' }}>
        <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 17, color: COLORS.text, marginBottom: 6 }}>Choose a username</div>
        <div style={{ fontSize: 12.5, color: COLORS.muted, lineHeight: 1.5, marginBottom: 14 }}>So others recognize you in chat and battles.</div>
        <input
          autoFocus
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') void save() }}
          placeholder="3–20 chars, letters/numbers/_"
          style={{ width: '100%', background: '#0a0e16', border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '11px 13px', color: COLORS.text, fontSize: 14, fontFamily: FONTS.body, outline: 'none' }}
        />
        {error && <div style={{ fontSize: 12, marginTop: 8, color: COLORS.red }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onClose} disabled={saving}
            style={{ background: 'transparent', color: COLORS.muted, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '10px 16px', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => void save()} disabled={saving}
            style={{ background: GRADIENT, border: 'none', borderRadius: 10, padding: '10px 18px', color: '#06120c', fontWeight: 800, fontFamily: FONTS.display, cursor: saving ? 'wait' : 'pointer' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
