import { useEffect, useRef, useState } from 'react'
import { COLORS, FONTS, formatUsd } from '../../theme'
import { useIsWide } from '../../useIsWide'
import { ccAssetUrl, type MachineCard } from '../../../onchain/gachaClient'
import { HoloCard } from '../../components/HoloCard'
import { rarityColor } from '../battle/RevealCard'

function abbreviate(mint: string): string {
  return mint.length > 12 ? `${mint.slice(0, 6)}…${mint.slice(-6)}` : mint
}

type Row = [string, string]

function Accordion({ title, rows, open, onToggle }: { title: string; rows: Row[]; open: boolean; onToggle: () => void }) {
  if (rows.length === 0) return null
  return (
    <div>
      <button
        onClick={onToggle}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 2px', border: 0, borderBottom: `1px solid ${COLORS.border}`, background: 'transparent', color: COLORS.text, cursor: 'pointer', fontFamily: FONTS.body, fontSize: 15, fontWeight: 600 }}
      >
        {title}
        <span style={{ fontSize: 18, color: COLORS.muted, width: 18, textAlign: 'center', lineHeight: 1 }}>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div style={{ padding: '14px 2px 6px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, fontSize: 13.5 }}>
              <span style={{ color: COLORS.muted }}>{k}</span>
              <span style={{ fontWeight: 600, color: COLORS.text, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function CardDetailsModal({ card, onClose }: { card: MachineCard; onClose: () => void }) {
  const gallery = card.images.length > 0 ? card.images : card.image ? [card.image] : []
  const [active, setActive] = useState(0)
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState({ grading: true, vault: false, contract: false })
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

  const wide = useIsWide('(min-width: 760px)')
  const mint = card.nft_address
  const big = gallery[active] ?? null
  const accent = rarityColor(card.rarity)

  function copyMint() {
    if (!mint || !navigator.clipboard) return
    void navigator.clipboard.writeText(mint).then(() => {
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 1800)
    })
  }

  const grading: Row[] = []
  if (card.grading_company) grading.push(['Grading company', card.grading_company])
  if (card.grading_id) grading.push(['Grading ID', card.grading_id])
  if (card.the_grade) grading.push(['Grade', card.the_grade])
  if (card.generic_grade) grading.push(['Generic grade', card.generic_grade])
  if (card.year) grading.push(['Year', card.year])
  if (card.authenticated != null) grading.push(['Authenticated', card.authenticated ? 'Yes' : 'No'])

  const vault: Row[] = [['Custodian', 'CollectorCrypt'], ['Status', 'Vaulted']]
  const contract: Row[] = [['Chain', 'Solana'], ['Standard', 'Metaplex NFT']]
  if (mint) contract.push(['Mint', abbreviate(mint)])

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'clamp(14px,2.5vw,32px)', background: 'rgba(4,6,9,.74)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'relative', width: '100%', maxWidth: 980, maxHeight: '92vh', overflowY: 'auto', borderRadius: 24, background: 'linear-gradient(180deg,#0e1118,#0a0c12)', border: `1px solid ${COLORS.border}`, boxShadow: '0 50px 130px -40px #000', padding: '26px clamp(22px,3vw,40px) 38px' }}
      >
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <span style={{ fontFamily: FONTS.display, fontSize: 17, fontWeight: 700, color: COLORS.text }}>Card details</span>
          <button onClick={onClose} aria-label="Close"
            style={{ width: 34, height: 34, borderRadius: 10, border: `1px solid ${COLORS.border}`, background: '#ffffff08', color: COLORS.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* body */}
        <div style={{ display: 'flex', gap: 'clamp(22px,3vw,42px)', alignItems: 'flex-start', flexDirection: wide ? 'row' : 'column' }}>
          {/* left — thumbs + big card */}
          <div style={{ flex: '1 1 auto', display: 'flex', gap: 14, justifyContent: 'center', minWidth: 0, alignSelf: wide ? 'flex-start' : 'center', width: wide ? undefined : '100%' }}>
            {gallery.length > 1 && (
              <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {gallery.map((src, i) => (
                  <button key={src + i} onClick={() => setActive(i)}
                    style={{ width: 56, aspectRatio: '0.72', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', padding: 0, background: '#0c1019', border: `1.5px solid ${i === active ? accent : COLORS.border}` }}>
                    <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  </button>
                ))}
              </div>
            )}
            <div style={{ flex: '0 1 320px', maxWidth: 340, width: '100%' }}>
              {big ? (
                <HoloCard src={big} alt={card.name ?? 'Card'} rarity={card.rarity} accent={accent} radius={16} imgStyle={{ aspectRatio: '0.72', objectFit: 'contain' }} />
              ) : (
                <div style={{ aspectRatio: '0.72', borderRadius: 16, background: '#0c1019', border: `1px solid ${COLORS.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48 }}>🃏</div>
              )}
            </div>
          </div>

          {/* right — info */}
          <div style={{ flex: '1 1 340px', maxWidth: wide ? 380 : undefined, minWidth: 0, width: wide ? undefined : '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, color: COLORS.green, marginBottom: 12 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M9 12l2 2 4-4" /></svg>
              Guaranteed authenticity
            </div>
            <h2 style={{ margin: '0 0 22px', fontFamily: FONTS.display, fontSize: 'clamp(22px,3vw,27px)', fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.12 }}>{card.name ?? 'Card'}</h2>

            {/* insured value */}
            <div style={{ borderRadius: 16, padding: '17px 19px', background: 'linear-gradient(135deg,#7c4dff,#9d5cff)', boxShadow: '0 18px 50px -24px rgba(124,77,255,.9)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14 }}>
                <div>
                  <div style={{ fontFamily: FONTS.mono, fontSize: 9.5, letterSpacing: '.16em', color: 'rgba(255,255,255,.72)' }}>INSURED VALUE</div>
                  <div style={{ fontFamily: FONTS.display, fontSize: 30, fontWeight: 700, letterSpacing: '-.02em', color: '#fff', marginTop: 3 }}>{card.insured_value != null ? formatUsd(card.insured_value) : '—'}</div>
                </div>
                {mint && (
                  <a href={ccAssetUrl(mint)} target="_blank" rel="noreferrer"
                    style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '10px 15px', borderRadius: 11, border: 0, cursor: 'pointer', fontFamily: FONTS.body, fontSize: 13.5, fontWeight: 700, color: '#3a1d8a', background: '#fff', textDecoration: 'none' }}>
                    View card ↗
                  </a>
                )}
              </div>
              {mint && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontFamily: FONTS.mono, fontSize: 11, color: 'rgba(255,255,255,.78)' }}>
                  Token ID: {abbreviate(mint)}
                  <button onClick={copyMint} aria-label="Copy token ID" style={{ background: '#ffffff22', border: 'none', color: '#fff', borderRadius: 6, padding: '2px 8px', fontSize: 11, cursor: 'pointer' }}>{copied ? 'Copied ✓' : 'Copy'}</button>
                </div>
              )}
            </div>

            {/* accordions */}
            <div style={{ marginTop: 10 }}>
              <Accordion title="Grading" rows={grading} open={open.grading} onToggle={() => setOpen((o) => ({ ...o, grading: !o.grading }))} />
              <Accordion title="Vault" rows={vault} open={open.vault} onToggle={() => setOpen((o) => ({ ...o, vault: !o.vault }))} />
              <Accordion title="Contract" rows={contract} open={open.contract} onToggle={() => setOpen((o) => ({ ...o, contract: !o.contract }))} />
            </div>

            {mint && (
              <a href={ccAssetUrl(mint)} target="_blank" rel="noreferrer"
                style={{ display: 'block', textAlign: 'center', marginTop: 22, padding: '14px', borderRadius: 13, border: `1px solid ${COLORS.border}`, background: '#ffffff08', color: COLORS.text, cursor: 'pointer', fontFamily: FONTS.body, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
                View on CollectorCrypt ↗
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
