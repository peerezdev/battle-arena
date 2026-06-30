import { useState } from 'react'
import { COLORS, FONTS, RARITY, formatUsd } from '../../theme'
import { ccCardImageUrl } from '../../../onchain/gachaClient'
import type { RevealCardVM } from './battleReveal'

export function rarityColor(rarity: string | null): string {
  const key = (rarity ?? '').toLowerCase()
  if (key === 'epic') return '#ff6bb5' // reveal Epic = purple
  return (RARITY as Record<string, string>)[key] ?? COLORS.muted
}

export type RevealCardSize = 'sm' | 'lg'
const PRESET: Record<RevealCardSize, { w: number; h: number }> = {
  sm: { w: 92, h: 128 },
  lg: { w: 180, h: 252 },
}

/** A graded-card tile at a FIXED width×height (so face-down, staging and revealed states
 *  all line up). Pass explicit `w`/`h` for responsive sizing, else a `size` preset. */
export function RevealCard({ card, reducedMotion, size = 'sm', w, h }: {
  card: RevealCardVM; reducedMotion: boolean; size?: RevealCardSize; w?: number; h?: number
}) {
  const [imgError, setImgError] = useState(false)
  const color = rarityColor(card.rarity)
  const width = w ?? PRESET[size].w
  const height = h ?? PRESET[size].h
  const big = width >= 150
  const footerH = big ? 54 : 38
  const valFont = big ? 18 : 12
  const nameFont = big ? 11.5 : 9
  const autoFont = big ? 9.5 : 8

  if (!card.nftAddress) {
    return (
      <div style={{
        width, height, borderRadius: 10, border: `1px solid ${COLORS.border}`,
        background: 'linear-gradient(160deg,#1b2236,#11161f)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6,
      }}>
        <span style={{ fontSize: big ? 46 : 26, opacity: reducedMotion ? 1 : 0.8 }}>🂠</span>
        <span style={{ fontFamily: FONTS.mono, fontSize: 9.5, color: COLORS.muted }}>opening…</span>
      </div>
    )
  }

  return (
    <div
      className={reducedMotion ? undefined : 'animate-flip-in'}
      style={{
        width, height, borderRadius: 10, border: `1px solid ${color}`, background: COLORS.panel,
        overflow: 'hidden', boxShadow: card.isMe ? `0 0 0 2px ${COLORS.green}55` : 'none',
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div style={{ flex: 1, minHeight: 0, background: '#0c1019', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {imgError
          ? <span style={{ fontSize: big ? 60 : 34 }}>🃏</span>
          : <img src={ccCardImageUrl(card.nftAddress)} alt="Card" onError={() => setImgError(true)}
                 style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
      </div>
      <div style={{ height: footerH, flexShrink: 0, padding: '0 8px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1 }}>
        {card.name && (
          <span style={{ fontFamily: FONTS.body, fontWeight: 600, fontSize: nameFont, color: COLORS.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {card.name}
          </span>
        )}
        <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: valFont, color }}>
          {formatUsd(card.insuredValue ?? 0)}
          {card.autoSold && <span style={{ fontFamily: FONTS.mono, fontSize: autoFont, color: COLORS.muted, marginLeft: 6 }}>⚡</span>}
        </span>
      </div>
    </div>
  )
}
