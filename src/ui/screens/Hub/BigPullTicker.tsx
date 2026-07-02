import { COLORS, FONTS, formatUsd, rarityGlow } from '../../theme'
import { shortWallet } from '../battle/royaleShared'
import { useDrops } from '../../drops/useDrops'
import { useReducedMotion } from '../../useReducedMotion'

export function BigPullTicker({ meWallet }: { meWallet: string | null }) {
  const drops = useDrops()
  const reduced = useReducedMotion()
  if (drops.length === 0) return null

  const items = drops.slice(0, 12)
  const row = (d: (typeof items)[number], i: number) => {
    const mine = !!meWallet && d.wallet === meWallet
    const accent = rarityGlow(d.rarity) ?? COLORS.green   // rarityGlow can return null
    const who = d.username ?? shortWallet(d.wallet)
    return (
      <span key={`${d.id}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0 26px', fontFamily: FONTS.mono, fontSize: 11.5, whiteSpace: 'nowrap', color: '#8b95a3' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent, boxShadow: `0 0 6px ${accent}` }} />
        <span style={{ color: mine ? COLORS.green : '#cdd4dd' }}>{who}</span> pulled {d.name}
        <span style={{ color: accent, fontWeight: 700 }}>{formatUsd(d.valueUsd ?? 0)}</span>
      </span>
    )
  }

  return (
    <div style={{ position: 'relative', overflow: 'hidden', margin: '0 0 20px', padding: '8px 0', borderBottom: `1px solid ${COLORS.border}`, background: 'rgba(255,255,255,.016)' }}>
      <div style={{ display: 'flex', width: 'max-content', animation: reduced ? 'none' : 'ba-ticker 36s linear infinite' }}>
        {items.map(row)}
        {!reduced && items.map((d, i) => row(d, i + items.length))}
      </div>
      <span style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 70, background: 'linear-gradient(90deg,#0a0710,transparent)', pointerEvents: 'none' }} />
      <span style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 70, background: 'linear-gradient(270deg,#0a0710,transparent)', pointerEvents: 'none' }} />
    </div>
  )
}
