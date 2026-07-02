import { useState } from 'react'
import { COLORS, FONTS, formatUsd } from '../../theme'
import { rarityColor } from '../battle/RevealCard'
import { shortWallet } from '../battle/royaleShared'
import { useDrops } from '../../drops/useDrops'

export function BestHitCard({ meWallet }: { meWallet: string | null }) {
  const drops = useDrops()
  const [imgErr, setImgErr] = useState(false)
  if (drops.length === 0) return null
  const top = drops.reduce((a, b) => ((b.valueUsd ?? 0) > (a.valueUsd ?? 0) ? b : a))
  const accent = rarityColor(top.rarity)
  const mine = !!meWallet && top.wallet === meWallet
  const who = top.username ?? shortWallet(top.wallet)

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 20, padding: 20, background: 'linear-gradient(150deg,rgba(245,197,66,.12),rgba(13,17,22,.65) 58%)', border: '1px solid rgba(245,197,66,.32)', boxShadow: '0 24px 70px -34px rgba(245,197,66,.45)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#f5c542', boxShadow: '0 0 8px #f5c542' }} />
        <span style={{ fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '.22em', color: '#f5c542' }}>BEST HIT</span>
      </div>
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ width: 124, height: 172, flex: 'none', borderRadius: 10, overflow: 'hidden', background: '#0c1019', border: `1px solid ${COLORS.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {top.image && !imgErr
            ? <img src={top.image} alt={top.name} onError={() => setImgErr(true)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            : <span style={{ fontSize: 46 }}>🃏</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 15.5, fontWeight: 700, lineHeight: 1.25, color: COLORS.text }}>{top.name}</div>
          {top.rarity && <div style={{ fontSize: 12, color: '#8b95a3', marginTop: 4, textTransform: 'capitalize' }}>{top.rarity}</div>}
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-.02em', color: accent, marginTop: 12 }}>{formatUsd(top.valueUsd ?? 0)}</div>
          <div style={{ fontSize: 12, color: '#9aa4b2', marginTop: 'auto', paddingTop: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Pulled by <span style={{ color: mine ? COLORS.green : '#cdd4dd', fontWeight: 600 }}>{who}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
