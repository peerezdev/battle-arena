import { useEffect, useState } from 'react'
import { COLORS, FONTS } from '../../theme'
import { useProfile } from '../../../hooks/useProfile'
import { useEmbeddedSolanaAddress } from '../../../wallet/embedded'
import { config } from '../../../onchain/config'
import { countResults } from '../../../profile/stats'
import { DelegationPanel } from './DelegationPanel'

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: '#161b24', border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: '16px 18px', flex: 1 }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '0.14em', color: COLORS.muted }}>{label}</div>
      <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 24, color: COLORS.text, marginTop: 6 }}>{value}</div>
    </div>
  )
}

export function OverviewTab() {
  const { username, elo, gamesPlayed } = useProfile()
  const address = useEmbeddedSolanaAddress()
  const [wl, setWl] = useState({ wins: 0, losses: 0, draws: 0 })

  useEffect(() => {
    if (!address) return
    let cancelled = false
    fetch(`${config.backendUrl}/users/${encodeURIComponent(address)}/history`, { headers: { 'ngrok-skip-browser-warning': 'true' } })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        if (!cancelled && Array.isArray(rows)) setWl(countResults(rows))
      })
      .catch((err) => {
        if (import.meta.env.DEV) console.warn('[OverviewTab] history fetch error:', err)
      })
    return () => {
      cancelled = true
    }
  }, [address])

  return (
    <div>
      <div style={{ fontFamily: FONTS.body, fontSize: 15, color: COLORS.text, marginBottom: 16 }}>
        {username ? <strong>{username}</strong> : <span style={{ color: COLORS.muted }}>No username yet — set one in Settings.</span>}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCard label="ELO" value={elo ?? '—'} />
        <StatCard label="GAMES" value={gamesPlayed ?? 0} />
        <StatCard label="WINS" value={wl.wins} />
        <StatCard label="LOSSES" value={wl.losses} />
        <StatCard label="DRAWS" value={wl.draws} />
      </div>
      <DelegationPanel />
    </div>
  )
}
