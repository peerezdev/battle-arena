import { useEffect, useState } from 'react'
import { COLORS, FONTS, formatUsd } from '../../theme'
import { config } from '../../../onchain/config'
import { useMachines } from '../../useMachines'
import { useAliases } from '../../useAliases'
import { shortWallet } from '../battle/RoyaleReveal'
import { useEmbeddedSolanaAddress } from '../../../wallet/embedded'

interface BattleRow {
  kind?: 'battle' | 'gacha'
  battleId: string
  mode: string
  machineCode: string
  result: 'win' | 'loss' | 'gacha'
  amountUsd: number
  cards: number
  opponents: string[]
  ts: number | null
  pullName?: string | null   // gacha: pulled card name
}

const GachaIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="12" height="17" rx="1.2" /><path d="M3 9h12M3 15h12M7 9v6M11 9v6" /><circle cx="19.5" cy="6" r="2" /><path d="M19.5 8v3" /></svg>
)

const TrophyIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></svg>
)
const LossIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="m4.9 4.9 14.2 14.2" /></svg>
)

export function HistoryTab({ wallet }: { wallet?: string }) {
  const own = useEmbeddedSolanaAddress()
  const address = wallet ?? own
  const machines = useMachines()
  const [rows, setRows] = useState<BattleRow[] | null>(null)

  useEffect(() => {
    if (!address) { setRows([]); return }
    let cancelled = false
    fetch(`${config.backendUrl}/users/${encodeURIComponent(address)}/battles`, { headers: { 'ngrok-skip-browser-warning': 'true' } })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => { if (!cancelled) setRows(Array.isArray(data) ? data : []) })
      .catch((err) => { if (import.meta.env.DEV) console.warn('[HistoryTab] fetch error:', err) })
    return () => { cancelled = true }
  }, [address])

  const allOpps = (rows ?? []).flatMap((r) => r.opponents)
  const aliases = useAliases(allOpps)

  if (rows == null) return <div style={{ color: COLORS.muted, fontSize: 13, padding: '8px 2px' }}>Loading…</div>
  if (rows.length === 0) return <div style={{ color: COLORS.muted, fontSize: 13, padding: '8px 2px' }}>No activity yet.</div>

  const oppText = (r: BattleRow) =>
    r.opponents.length === 0 ? '—'
      : r.opponents.length === 1 ? aliases[r.opponents[0]] ?? shortWallet(r.opponents[0])
        : `${r.opponents.length} players`

  return (
    <div style={{ animation: 'ba-tabin .25s ease-out' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '.2em', color: COLORS.muted }}>ACTIVITY</div>
        <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.muted }}>{rows.length} most recent</div>
      </div>
      <div style={{ borderRadius: 16, overflow: 'hidden', border: `1px solid ${COLORS.border}`, background: 'linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,.01))' }}>
        {rows.map((r) => {
          const gacha = r.kind === 'gacha'
          const positive = gacha ? r.amountUsd >= 0 : r.result === 'win'
          const posColor = positive ? COLORS.green : '#ff7a8f'
          const machineName = machines[r.machineCode]?.name ?? r.machineCode
          const label = gacha ? 'GACHA' : positive ? 'WON' : 'LOST'
          return (
            <div key={r.battleId} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderBottom: `1px solid #ffffff0d` }}>
              <span style={{ flex: 'none', width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', background: gacha ? 'rgba(255,46,151,.12)' : positive ? 'rgba(0,255,196,.12)' : 'rgba(255,94,122,.1)', color: gacha ? COLORS.violet : positive ? '#f5c542' : '#ff7a8f' }}>
                {gacha ? GachaIcon : positive ? TrophyIcon : LossIcon}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: '#e7ecf2' }}>
                  {machineName}{!gacha && r.cards > 0 && <span style={{ color: '#6c7682', fontWeight: 400, fontSize: 13 }}> ×{r.cards}</span>}
                  {gacha && <span style={{ color: '#6c7682', fontWeight: 400, fontSize: 12 }}> · Gacha</span>}
                  {r.mode === 'royale' && <span style={{ color: '#6c7682', fontWeight: 400, fontSize: 12 }}> · Royale</span>}
                </div>
                <div style={{ fontSize: 12.5, color: COLORS.muted, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {gacha ? `Pulled ${r.pullName ?? 'a card'}` : `vs ${oppText(r)}`}
                </div>
              </div>
              <div style={{ textAlign: 'right', flex: 'none' }}>
                <div style={{ fontFamily: FONTS.mono, fontSize: 9.5, letterSpacing: '.12em', color: posColor }}>{label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: posColor }}>{positive ? '+' : '−'}{formatUsd(Math.abs(r.amountUsd))}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
