import { COLORS, FONTS, formatUsd } from '../../theme'
import { tintFor, medalColor } from './royaleShared'
import type { RevealVM, RevealPlayerVM } from './battleReveal'

export function LiveLeaderboard({ vm, name, title = 'LEADERBOARD' }: {
  vm: RevealVM; name: (p: RevealPlayerVM) => string; title?: string
}) {
  const ranked = [...vm.players].sort((a, b) => (b.total - a.total) || a.wallet.localeCompare(b.wallet))
  const aliveCount = vm.players.filter((p) => p.eliminatedRound == null).length
  const leader = ranked.find((p) => p.eliminatedRound == null)?.wallet ?? null
  const atRisk = aliveCount > 1 ? [...ranked].reverse().find((p) => p.eliminatedRound == null)?.wallet ?? null : null

  return (
    <div style={{ borderRadius: 16, border: `1px solid ${COLORS.border}`, background: 'linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,.008))', overflow: 'hidden', minWidth: 240 }}>
      <div style={{ padding: '11px 14px', borderBottom: `1px solid ${COLORS.border}`, fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.18em', color: COLORS.muted }}>{title}</div>
      {ranked.map((p, i) => {
        const rank = i + 1
        const elim = p.eliminatedRound != null
        return (
          <div key={p.wallet} data-testid="lb-row" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: '1px solid #ffffff08', background: p.isMe ? 'rgba(0,255,196,.06)' : 'transparent', opacity: elim ? 0.5 : 1 }}>
            <span style={{ width: 20, textAlign: 'center', fontFamily: FONTS.mono, fontSize: 13, fontWeight: 700, color: medalColor(rank) }}>{rank}</span>
            <span style={{ flex: 'none', width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#06170f', background: tintFor(p.wallet), border: `2px solid ${p.isMe ? 'rgba(0,255,196,.7)' : 'rgba(255,255,255,.12)'}` }}>{name(p).slice(0, 1).toUpperCase()}</span>
            <span data-testid="lb-name" style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: p.isMe ? COLORS.green : COLORS.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: elim ? 'line-through' : 'none' }}>{name(p)}</span>
            {p.wallet === leader && !elim && <span aria-label="leader" style={{ fontSize: 12 }}>👑</span>}
            {p.wallet === atRisk && !elim && <span aria-label="at risk" style={{ width: 7, height: 7, borderRadius: '50%', background: '#ff5e7a', boxShadow: '0 0 6px #ff5e7a' }} />}
            <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 14, color: elim ? COLORS.muted : COLORS.text }}>{formatUsd(p.total)}</span>
          </div>
        )
      })}
    </div>
  )
}
