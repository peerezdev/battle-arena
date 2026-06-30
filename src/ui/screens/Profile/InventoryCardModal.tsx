import { useEffect, useRef, useState } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS, formatUsd } from '../../theme'
import { useIsWide } from '../../useIsWide'
import { useReducedMotion } from '../../useReducedMotion'
import type { OwnedCard } from '../../../inventory/useCollectorCryptNfts'
import { useWallet } from '../../../wallet/useWallet'
import { useEmbeddedSolanaAddress } from '../../../wallet/embedded'
import { fetchBuybackAvailable, requestBuyback, submitTx, ccAssetUrl, ccCardImageUrl, fetchCardMetadata, type NftMetadata } from '../../../onchain/gachaClient'

/** USDC base units (6 decimals) → dollars. */
export function buybackUsd(amountBaseUnits: number): number {
  return amountBaseUnits / 1e6
}

type BuybackState =
  | { kind: 'checking' }
  | { kind: 'none' }
  | { kind: 'available'; amount: number }
  | { kind: 'confirming'; amount: number }
  | { kind: 'selling'; amount: number }
  | { kind: 'sold'; amount: number }
  | { kind: 'error'; amount: number; message: string }

function abbreviate(mint: string): string {
  return mint.length > 12 ? `${mint.slice(0, 6)}…${mint.slice(-6)}` : mint
}

export function InventoryCardModal({ card, onClose, onSold }: {
  card: OwnedCard
  onClose: () => void
  onSold: () => void
}) {
  const { identityToken } = useIdentityToken()
  const { signTransactionBase64 } = useWallet()
  const embeddedAddress = useEmbeddedSolanaAddress()
  const reduced = useReducedMotion()
  const wide = useIsWide('(min-width: 640px)')
  const [bb, setBb] = useState<BuybackState>({ kind: 'checking' })
  const [copied, setCopied] = useState(false)
  const [imgErr, setImgErr] = useState(false)
  const [meta, setMeta] = useState<NftMetadata | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

  // DAS metadata is null/broken on devnet, so the inventory card often arrives without
  // insuredValue/grading. Pull the card's metadata by mint from CC (via our backend proxy —
  // CC's metadata endpoint isn't CORS-enabled for direct browser fetches) to fill the gaps.
  useEffect(() => {
    let cancelled = false
    setMeta(null)
    if (!card.mint) return
    fetchCardMetadata(card.mint).then((m) => { if (!cancelled) setMeta(m) }).catch(() => {})
    return () => { cancelled = true }
  }, [card.mint])

  // Buyback is only meaningful for embedded-won cards.
  const eligibleWallet = card.source === 'embedded' ? embeddedAddress : null

  useEffect(() => {
    if (!eligibleWallet) { setBb({ kind: 'none' }); return }
    let cancelled = false
    setBb({ kind: 'checking' })
    fetchBuybackAvailable(eligibleWallet, card.mint)
      .then((r) => {
        if (cancelled) return
        setBb(r.available && r.amount != null ? { kind: 'available', amount: r.amount } : { kind: 'none' })
      })
      .catch(() => { if (!cancelled) setBb({ kind: 'none' }) })
    return () => { cancelled = true }
  }, [eligibleWallet, card.mint])

  async function confirmSell(amount: number) {
    if (bb.kind === 'selling') return
    if (!identityToken) { setBb({ kind: 'error', amount, message: 'Sign in to sell back.' }); return }
    setBb({ kind: 'selling', amount })
    try {
      const res = await requestBuyback(identityToken, card.mint)
      const signed = await signTransactionBase64(res.serialized_transaction)
      await submitTx(identityToken, signed)
      setBb({ kind: 'sold', amount })
      onSold()
    } catch (e) {
      setBb({ kind: 'error', amount, message: e instanceof Error ? e.message : 'Buyback failed' })
    }
  }

  function copyMint() {
    if (!navigator.clipboard) return
    void navigator.clipboard.writeText(card.mint).then(() => {
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 1800)
    })
  }

  // Neutral accent — no rarity distinction in the inventory; every card looks the same.
  const haloColor = 'rgba(124,77,255,.45)'   // brand violet, identical for all cards

  const imgSrc = card.mint ? ccCardImageUrl(card.mint) : card.image
  const explorerUrl = ccAssetUrl(card.mint)

  // Enriched view: prefer the card's own (DAS) fields, fall back to the CC metadata fetched
  // by mint. On devnet the DAS fields are null, so `meta` is what actually fills the panel.
  const v = {
    name: (card.name && card.name !== 'Unnamed') ? card.name : (meta?.name ?? card.name),
    insuredValue: card.insuredValue ?? meta?.insured_value ?? null,
    grade: card.grade ?? meta?.grade ?? null,
    gradingCompany: card.gradingCompany ?? meta?.grading_company ?? null,
    gradingId: card.gradingId ?? meta?.grading_id ?? null,
    year: card.year ?? meta?.year ?? null,
    authenticated: card.authenticated ?? meta?.authenticated ?? null,
  }

  // Buyback offer (only known once available): amount + % of insured value.
  const offerAmount = (bb.kind === 'available' || bb.kind === 'confirming' || bb.kind === 'selling' || bb.kind === 'sold')
    ? buybackUsd(bb.amount) : null
  const offerPct = offerAmount != null && v.insuredValue ? Math.round((offerAmount / v.insuredValue) * 100) : null
  const hasInsured = v.insuredValue != null && Number.isFinite(v.insuredValue)
  const showValuePanel = hasInsured || offerAmount != null

  const gradingRows: Array<[string, string]> = []
  if (v.gradingCompany) gradingRows.push(['Grading company', v.gradingCompany])
  if (v.gradingId) gradingRows.push(['Grading ID', v.gradingId])
  if (v.grade) gradingRows.push(['Grade', v.grade])
  if (v.year) gradingRows.push(['Year', v.year])
  if (v.authenticated != null) gradingRows.push(['Authenticated', v.authenticated ? 'Yes' : 'No'])

  const labelMono = { fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.12em', color: COLORS.muted } as const
  const sweep: React.CSSProperties = {
    position: 'absolute', top: 0, bottom: 0, left: 0, width: '38%',
    background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.42),transparent)',
    animation: reduced ? 'none' : 'ba-sweep 3.8s infinite', pointerEvents: 'none',
  }

  // ── Bottom actions (driven by buyback state) ───────────────────────────────
  const secondaryBtn: React.CSSProperties = {
    flex: 1, padding: 13, borderRadius: 13, border: `1px solid ${COLORS.border}`,
    background: 'rgba(255,255,255,.04)', color: COLORS.text, cursor: 'pointer',
    fontFamily: FONTS.body, fontSize: 14, fontWeight: 600,
  }
  function PrimaryBtn({ label, onClick }: { label: string; onClick: () => void }) {
    return (
      <button onClick={onClick} style={{
        position: 'relative', overflow: 'hidden', flex: 1.5, padding: 14, borderRadius: 13, border: 0, cursor: 'pointer',
        fontFamily: FONTS.body, fontSize: 14.5, fontWeight: 700, color: '#06170f',
        background: 'linear-gradient(120deg,#ff2e97,#00ffc4)', boxShadow: '0 14px 38px -14px rgba(0,255,196,.6)',
      }}>
        <span style={sweep} />
        <span style={{ position: 'relative' }}>{label}</span>
      </button>
    )
  }

  let actions: React.ReactNode
  if (bb.kind === 'checking') {
    actions = (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ ...labelMono, flex: 1 }}>Checking buyback…</span>
        <button onClick={onClose} style={secondaryBtn}>Close</button>
      </div>
    )
  } else if (bb.kind === 'available') {
    actions = (
      <div style={{ display: 'flex', gap: 10 }}>
        <PrimaryBtn label={`Accept buyback · ${formatUsd(buybackUsd(bb.amount))}`} onClick={() => setBb({ kind: 'confirming', amount: bb.amount })} />
        <button onClick={onClose} style={secondaryBtn}>Keep</button>
      </div>
    )
  } else if (bb.kind === 'confirming') {
    actions = (
      <div>
        <div style={{ fontSize: 13, color: COLORS.text, marginBottom: 10, lineHeight: 1.45 }}>
          Sell <b>{v.name}</b> for <b>{formatUsd(buybackUsd(bb.amount))}</b>? You return the card and get USDC. This can't be undone.
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <PrimaryBtn label="Confirm" onClick={() => confirmSell(bb.amount)} />
          <button onClick={() => setBb({ kind: 'available', amount: bb.amount })} style={secondaryBtn}>Cancel</button>
        </div>
      </div>
    )
  } else if (bb.kind === 'selling') {
    actions = <div style={labelMono}>Selling back…</div>
  } else if (bb.kind === 'sold') {
    actions = (
      <div>
        <div style={{ fontSize: 13, color: COLORS.green, fontWeight: 700, marginBottom: 10 }}>Sold — {formatUsd(buybackUsd(bb.amount))} credited.</div>
        <button onClick={onClose} style={{ ...secondaryBtn, width: '100%', flex: 'none' }}>Done</button>
      </div>
    )
  } else if (bb.kind === 'error') {
    actions = (
      <div>
        <div style={{ fontSize: 12, color: COLORS.red, marginBottom: 8 }}>{bb.message}</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setBb({ kind: 'available', amount: bb.amount })} style={secondaryBtn}>Back</button>
          <button onClick={onClose} style={secondaryBtn}>Close</button>
        </div>
      </div>
    )
  } else {
    // 'none' — not eligible (public inventory / non-embedded card)
    actions = <button onClick={onClose} style={{ ...secondaryBtn, width: '100%', flex: 'none' }}>Close</button>
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'radial-gradient(1000px 700px at 20% -10%,rgba(255,46,151,.10),transparent 56%),rgba(4,6,9,.78)',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'clamp(14px,2.5vw,32px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative', width: '100%', maxWidth: 720, maxHeight: '92vh', overflowY: 'auto',
          borderRadius: 22, background: 'linear-gradient(180deg,#0e1118,#0a0c12)',
          border: `1px solid ${COLORS.border}`, boxShadow: `0 48px 120px -40px #000, 0 0 70px -22px ${haloColor}`,
          padding: '22px clamp(20px,2.6vw,30px) 26px',
          animation: reduced ? 'none' : 'ca-pop .4s cubic-bezier(.2,.9,.25,1) both',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, color: COLORS.green }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M9 12l2 2 4-4" /></svg>
            Guaranteed authenticity
          </span>
          <button onClick={onClose} aria-label="Close" style={{ flex: 'none', width: 32, height: 32, borderRadius: 10, border: `1px solid ${COLORS.border}`, background: 'rgba(255,255,255,.04)', color: COLORS.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'flex-start' : 'center', gap: 'clamp(20px,2.8vw,30px)' }}>
          {/* Left — graded slab with neutral halo + holo sweep */}
          <div style={{ position: 'relative', flex: 'none', width: 'clamp(190px,42vw,230px)' }}>
            <div aria-hidden style={{ position: 'absolute', inset: '-8% 12%', zIndex: 0, borderRadius: '50%', background: `radial-gradient(circle,${haloColor},transparent 66%)`, filter: 'blur(26px)' }} />
            <div style={{ position: 'relative', zIndex: 1, aspectRatio: '.69', borderRadius: 13, background: 'linear-gradient(160deg,#d6dbe1,#9aa1ac)', padding: '9px 9px 11px', boxShadow: '0 30px 70px -28px #000, inset 0 1px 0 rgba(255,255,255,.7)' }}>
              <div style={{ height: '100%', borderRadius: 7, overflow: 'hidden', background: '#0a0c10', display: 'flex', flexDirection: 'column', border: '1px solid rgba(0,0,0,.45)' }}>
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                  {imgSrc && !imgErr
                    ? <img src={imgSrc} alt={v.name} onError={() => setImgErr(true)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 }}>🃏</span>}
                  <span style={{ position: 'absolute', inset: 0, zIndex: 2, background: 'linear-gradient(115deg,rgba(255,255,255,0) 38%,rgba(255,255,255,.3),rgba(255,255,255,0) 62%)', backgroundSize: '220% 220%', mixBlendMode: 'color-dodge', opacity: .4, animation: reduced ? 'none' : 'ba-holo 7s ease-in-out infinite', pointerEvents: 'none' }} />
                  <span style={{ ...sweep, zIndex: 2, width: '32%', background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.18),transparent)', animation: reduced ? 'none' : 'ba-sweep 4.6s infinite' }} />
                </div>
              </div>
            </div>
          </div>

          {/* Right — info */}
          <div style={{ flex: '1 1 auto', minWidth: 0, maxWidth: wide ? 360 : '100%', width: wide ? undefined : '100%' }}>
            <h2 style={{ margin: '2px 0 16px', fontSize: 'clamp(20px,2.4vw,25px)', fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.14, color: COLORS.text }}>{v.name}</h2>

            {/* Value panel — shows the insured value and/or the buyback offer */}
            {showValuePanel && (
              <div style={{ borderRadius: 15, padding: '15px 17px', background: 'linear-gradient(135deg,rgba(124,77,255,.16),rgba(255,255,255,.02))', border: '1px solid rgba(124,77,255,.34)', marginBottom: 12 }}>
                {hasInsured && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: offerAmount != null ? 11 : 0, borderBottom: offerAmount != null ? '1px solid rgba(255,255,255,.08)' : 'none' }}>
                    <span style={{ ...labelMono, letterSpacing: '.14em' }}>INSURED VALUE</span>
                    <span style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-.02em', color: '#c4adff' }}>{formatUsd(v.insuredValue!)}</span>
                  </div>
                )}
                {offerAmount != null && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: hasInsured ? 11 : 0 }}>
                    <span style={{ ...labelMono, letterSpacing: '.14em' }}>BUYBACK OFFER{offerPct != null ? ` · ${offerPct}%` : ''}</span>
                    <span style={{ fontSize: 17, fontWeight: 700, color: COLORS.green }}>{formatUsd(offerAmount)}</span>
                  </div>
                )}
              </div>
            )}

            {/* Grading details */}
            {gradingRows.length > 0 && (
              <div style={{ borderRadius: 13, border: `1px solid ${COLORS.border}`, overflow: 'hidden', marginBottom: 13 }}>
                {gradingRows.map(([k, v], i) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 14px', borderBottom: i === gradingRows.length - 1 ? 'none' : '1px solid rgba(255,255,255,.06)' }}>
                    <span style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.1em', color: '#7a8492' }}>{k}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#e7ecf2', textAlign: 'right' }}>{v}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Token id */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 13, background: 'rgba(255,255,255,.03)', border: `1px solid ${COLORS.border}`, marginBottom: 16 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: '.14em', color: '#7a8492' }}>TOKEN ID</div>
                <div style={{ fontFamily: FONTS.mono, fontSize: 13.5, fontWeight: 500, color: '#e7ecf2', marginTop: 3 }}>{abbreviate(card.mint)}</div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7 }}>
                <button onClick={copyMint} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 9, border: `1px solid ${copied ? 'rgba(0,255,196,.4)' : COLORS.border}`, background: copied ? 'rgba(0,255,196,.12)' : 'rgba(255,255,255,.04)', color: copied ? COLORS.green : '#cdd4dd', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <a href={explorerUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 9, border: '1px solid rgba(255,46,151,.4)', background: 'rgba(255,46,151,.1)', color: '#c4adff', cursor: 'pointer', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>CollectorCrypt ↗</a>
              </div>
            </div>

            {/* Actions */}
            {actions}
          </div>
        </div>
      </div>
    </div>
  )
}
