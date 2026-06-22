import { useState } from 'react'
import { COLORS, FONTS, RARITY, formatUsd } from '../../theme'
import { ccCardImageUrl } from '../../../onchain/gachaClient'
import type { RevealCardVM } from './battleReveal'

export function rarityColor(rarity: string | null): string {
  const key = (rarity ?? '').toLowerCase()
  return (RARITY as Record<string, string>)[key] ?? COLORS.muted
}

export function RevealCard({ card, reducedMotion }: { card: RevealCardVM; reducedMotion: boolean }) {
  const [imgError, setImgError] = useState(false)
  const color = rarityColor(card.rarity)

  if (!card.nftAddress) {
    // pending: face-down "opening…" tile
    return (
      <div style={{
        width: 92, height: 128, borderRadius: 10, border: `1px solid ${COLORS.border}`,
        background: 'linear-gradient(160deg,#1b2236,#11161f)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6,
      }}>
        <span style={{ fontSize: 26, opacity: reducedMotion ? 1 : 0.8 }}>🂠</span>
        <span style={{ fontFamily: FONTS.mono, fontSize: 9.5, color: COLORS.muted }}>abriendo…</span>
      </div>
    )
  }

  return (
    <div style={{
      width: 92, borderRadius: 10, border: `1px solid ${color}`, background: COLORS.panel,
      overflow: 'hidden', boxShadow: card.isMe ? `0 0 0 2px ${COLORS.green}55` : 'none',
    }}>
      <div style={{ height: 100, background: '#0c1019', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {imgError
          ? <span style={{ fontSize: 34 }}>🃏</span>
          : <img src={ccCardImageUrl(card.nftAddress)} alt="Card" onError={() => setImgError(true)}
                 style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
      </div>
      <div style={{ padding: '5px 7px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 12, color }}>
          {formatUsd(card.insuredValue ?? 0)}
        </span>
        {card.autoSold && (
          <span style={{ fontFamily: FONTS.mono, fontSize: 8.5, color: COLORS.muted }}>⚡ auto-sold</span>
        )}
      </div>
    </div>
  )
}
