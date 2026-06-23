import { useState } from 'react'
import { COLORS, FONTS, RARITY, formatUsd } from '../../theme'
import { ccCardImageUrl } from '../../../onchain/gachaClient'
import type { RevealCardVM } from './battleReveal'

export function rarityColor(rarity: string | null): string {
  const key = (rarity ?? '').toLowerCase()
  return (RARITY as Record<string, string>)[key] ?? COLORS.muted
}

export type RevealCardSize = 'sm' | 'lg'

const DIMS: Record<RevealCardSize, {
  w: number; imgH: number; faceH: number; faceEmoji: number; fallback: number; valFont: number; autoFont: number; pad: string
}> = {
  sm: { w: 92, imgH: 100, faceH: 128, faceEmoji: 26, fallback: 34, valFont: 12, autoFont: 8.5, pad: '5px 7px' },
  lg: { w: 180, imgH: 204, faceH: 252, faceEmoji: 46, fallback: 60, valFont: 18, autoFont: 10, pad: '9px 12px' },
}

export function RevealCard({ card, reducedMotion, size = 'sm' }: {
  card: RevealCardVM; reducedMotion: boolean; size?: RevealCardSize
}) {
  const [imgError, setImgError] = useState(false)
  const color = rarityColor(card.rarity)
  const d = DIMS[size]

  if (!card.nftAddress) {
    // pending: face-down "opening…" tile
    return (
      <div style={{
        width: d.w, height: d.faceH, borderRadius: 10, border: `1px solid ${COLORS.border}`,
        background: 'linear-gradient(160deg,#1b2236,#11161f)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6,
      }}>
        <span style={{ fontSize: d.faceEmoji, opacity: reducedMotion ? 1 : 0.8 }}>🂠</span>
        <span style={{ fontFamily: FONTS.mono, fontSize: 9.5, color: COLORS.muted }}>abriendo…</span>
      </div>
    )
  }

  return (
    <div
      className={reducedMotion ? undefined : 'animate-flip-in'}
      style={{
        width: d.w, borderRadius: 10, border: `1px solid ${color}`, background: COLORS.panel,
        overflow: 'hidden', boxShadow: card.isMe ? `0 0 0 2px ${COLORS.green}55` : 'none',
      }}
    >
      <div style={{ height: d.imgH, background: '#0c1019', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {imgError
          ? <span style={{ fontSize: d.fallback }}>🃏</span>
          : <img src={ccCardImageUrl(card.nftAddress)} alt="Card" onError={() => setImgError(true)}
                 style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
      </div>
      <div style={{ padding: d.pad, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: d.valFont, color }}>
          {formatUsd(card.insuredValue ?? 0)}
        </span>
        {card.autoSold && (
          <span style={{ fontFamily: FONTS.mono, fontSize: d.autoFont, color: COLORS.muted }}>⚡ auto-sold</span>
        )}
      </div>
    </div>
  )
}
