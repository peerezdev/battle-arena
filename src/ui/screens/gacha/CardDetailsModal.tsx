import { useEffect, useRef, useState } from 'react'
import { COLORS, FONTS, formatUsd } from '../../theme'
import { useIsWide } from '../../useIsWide'
import { ccAssetUrl, type MachineCard } from '../../../onchain/gachaClient'

function abbreviate(mint: string): string {
  return mint.length > 12 ? `${mint.slice(0, 6)}…${mint.slice(-6)}` : mint
}

export function CardDetailsModal({ card, onClose }: { card: MachineCard; onClose: () => void }) {
  const gallery = card.images.length > 0 ? card.images : card.image ? [card.image] : []
  const [active, setActive] = useState(0)
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

  const wideModal = useIsWide('(min-width: 620px)')

  const mint = card.nft_address
  const big = gallery[active] ?? null

  function copyMint() {
    if (!mint || !navigator.clipboard) return
    void navigator.clipboard.writeText(mint).then(() => {
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 1800)
    })
  }

  const label = { fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '0.12em', color: COLORS.muted } as const
  const value = { fontSize: 13, color: COLORS.text, fontWeight: 600 } as const
  const gradingRows: Array<[string, string]> = []
  if (card.grading_company) gradingRows.push(['Grading Company', card.grading_company])
  if (card.grading_id) gradingRows.push(['Grading ID', card.grading_id])
  if (card.the_grade) gradingRows.push(['Grade', card.the_grade])
  if (card.generic_grade) gradingRows.push(['Generic Grade', card.generic_grade])
  if (card.authenticated != null) gradingRows.push(['Authenticated', card.authenticated ? 'Yes' : 'No'])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.66)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(880px, 100%)', maxHeight: '90vh', overflowY: 'auto',
          background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 20,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 16, color: COLORS.text }}>Card Details</span>
          <button onClick={onClose} aria-label="Close"
            style={{ background: 'transparent', border: `1px solid ${COLORS.border}`, color: COLORS.muted, borderRadius: 8, width: 30, height: 30, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: wideModal ? '1fr 1fr' : '1fr', gap: wideModal ? 22 : 16 }}>
          {/* Left — gallery */}
          <div style={{ display: 'flex', gap: 12 }}>
            {gallery.length > 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {gallery.map((src, i) => (
                  <button key={src + i} onClick={() => setActive(i)}
                    style={{ width: 56, height: 76, borderRadius: 8, overflow: 'hidden', cursor: 'pointer', padding: 0,
                      background: COLORS.panel2, border: `2px solid ${i === active ? COLORS.green : COLORS.border}` }}>
                    <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  </button>
                ))}
              </div>
            )}
            <div style={{ flex: 1, aspectRatio: '3/4', maxHeight: wideModal ? undefined : '46vh', background: COLORS.panel2, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 12 }}>
              {big ? <img src={big} alt={card.name ?? ''} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 48 }}>🃏</span>}
            </div>
          </div>

          {/* Right — info */}
          <div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.green, marginBottom: 8 }}>◎ Guaranteed Authenticity</div>
            <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 22, color: COLORS.text, lineHeight: 1.2, marginBottom: 16 }}>{card.name ?? 'Card'}</div>

            <div style={{ background: COLORS.violet, borderRadius: 12, padding: 16, marginBottom: 18 }}>
              <div style={{ ...label, color: '#ffffffcc' }}>INSURED VALUE</div>
              <div style={{ fontFamily: FONTS.display, fontWeight: 900, fontSize: 26, color: '#fff', marginBottom: mint ? 6 : 0 }}>
                {card.insured_value != null ? formatUsd(card.insured_value) : '—'}
              </div>
              {mint && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: '#ffffffcc' }}>Token ID: {abbreviate(mint)}</span>
                  <button onClick={copyMint} style={{ background: '#ffffff22', border: 'none', color: '#fff', borderRadius: 6, padding: '2px 8px', fontSize: 11, cursor: 'pointer' }}>{copied ? 'Copied' : 'Copy'}</button>
                  <a href={ccAssetUrl(mint)} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto', background: '#ffffff', color: COLORS.violet, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>View Card ↗</a>
                </div>
              )}
            </div>

            {gradingRows.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: FONTS.display, fontWeight: 700, fontSize: 14, color: COLORS.text, marginBottom: 10 }}>Grading</div>
                {gradingRows.map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${COLORS.border}` }}>
                    <span style={label}>{k}</span>
                    <span style={value}>{v}</span>
                  </div>
                ))}
              </div>
            )}

            {mint && (
              <a href={ccAssetUrl(mint)} target="_blank" rel="noreferrer"
                style={{ display: 'block', textAlign: 'center', border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '11px', color: COLORS.text, fontWeight: 700, textDecoration: 'none', fontSize: 13 }}>
                View on CollectorCrypt ↗
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
