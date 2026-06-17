import { useEffect, useState } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS, GRADIENT } from '../../theme'
import { useProfile } from '../../../hooks/useProfile'
import { validateUsername } from '../../../profile/username'
import { config } from '../../../onchain/config'

export function SettingsTab() {
  const { username, refresh } = useProfile()
  const { identityToken } = useIdentityToken()
  const [value, setValue] = useState('')
  const [status, setStatus] = useState<{ kind: 'idle' | 'ok' | 'error'; msg?: string }>({ kind: 'idle' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (username) setValue(username)
  }, [username])

  async function save() {
    if (saving) return
    const err = validateUsername(value)
    if (err) {
      setStatus({ kind: 'error', msg: err })
      return
    }
    if (!identityToken) {
      setStatus({ kind: 'error', msg: 'Log in to set a username.' })
      return
    }
    setSaving(true)
    setStatus({ kind: 'idle' })
    try {
      const resp = await fetch(`${config.backendUrl}/users/me/alias`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${identityToken}` },
        body: JSON.stringify({ alias: value }),
      })
      if (resp.status === 409) {
        setStatus({ kind: 'error', msg: 'That username is already taken.' })
      } else if (!resp.ok) {
        setStatus({ kind: 'error', msg: 'Could not save. Try again.' })
      } else {
        setStatus({ kind: 'ok', msg: 'Saved ✓' })
        refresh()
      }
    } catch {
      setStatus({ kind: 'error', msg: 'Network error.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 420 }}>
      <label style={{ display: 'block', fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '0.14em', color: COLORS.muted, marginBottom: 8 }}>
        USERNAME
      </label>
      <input
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setStatus({ kind: 'idle' })
        }}
        placeholder="3–20 chars, letters/numbers/_"
        style={{
          width: '100%',
          background: '#0a0e16',
          border: `1px solid ${COLORS.border}`,
          borderRadius: 10,
          padding: '11px 13px',
          color: COLORS.text,
          fontSize: 14,
          fontFamily: FONTS.body,
          outline: 'none',
        }}
      />
      <div style={{ fontSize: 12, marginTop: 8, minHeight: 16, color: status.kind === 'error' ? COLORS.red : COLORS.green }}>
        {status.msg ?? ''}
      </div>
      <button
        onClick={save}
        disabled={saving}
        style={{
          marginTop: 12,
          background: GRADIENT,
          border: 'none',
          borderRadius: 10,
          padding: '11px 22px',
          color: '#06120c',
          fontWeight: 800,
          fontSize: 13,
          fontFamily: FONTS.display,
          cursor: saving ? 'not-allowed' : 'pointer',
          opacity: saving ? 0.6 : 1,
        }}
      >
        {saving ? 'Saving…' : 'Save username'}
      </button>
    </div>
  )
}
