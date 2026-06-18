import { useEffect, useRef, useState } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS, formatUsd } from '../../theme'
import type { OwnedCard } from '../../../inventory/useCollectorCryptNfts'
import { useWallet } from '../../../wallet/useWallet'
import { useEmbeddedSolanaAddress } from '../../../wallet/embedded'
import { fetchBuybackAvailable, requestBuyback, submitTx } from '../../../onchain/gachaClient'

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
  const [bb, setBb] = useState<BuybackState>({ kind: 'checking' })
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

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

  const explorerUrl = `https://explorer.solana.com/address/${card.mint}?cluster=devnet`
  const label = { fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '0.12em', color: COLORS.muted } as const
  const value = { fontSize: 13, color: COLORS.text, fontWeight: 600 } as const

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(440px, 100%)', maxHeight: '90vh', overflowY: 'auto',
          background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 18,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 15, color: COLORS.text }}>Card details</span>
          <button onClick={onClose} aria-label="Close"
            style={{ background: 'transparent', border: `1px solid ${COLORS.border}`, color: COLORS.muted, borderRadius: 8, width: 28, height: 28, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ height: 240, background: '#0c1019', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14, overflow: 'hidden' }}>
          {card.image ? <img src={card.image} alt={card.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 44 }}>🃏</span>}
        </div>

        <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 17, color: COLORS.text, marginBottom: 4 }}>{card.name}</div>
        {card.rarity && <div style={{ ...label, marginBottom: 12, textTransform: 'uppercase' }}>{card.rarity}</div>}

        {card.insuredValue != null && (
          <div style={{ background: '#0c1019', border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
            <div style={label}>INSURED VALUE</div>
            <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 22, color: COLORS.green }}>{formatUsd(card.insuredValue)}</div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          {card.grade && (<div><div style={label}>GRADE</div><div style={value}>{card.grade}</div></div>)}
          {card.year && (<div><div style={label}>YEAR</div><div style={value}>{card.year}</div></div>)}
          {card.gradingId && (<div><div style={label}>GRADING ID</div><div style={value}>{card.gradingId}</div></div>)}
          {card.authenticated != null && (<div><div style={label}>AUTHENTICATED</div><div style={value}>{card.authenticated ? 'Yes' : 'No'}</div></div>)}
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={label}>TOKEN ID</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.text }}>{abbreviate(card.mint)}</span>
            <button onClick={copyMint} style={{ background: 'transparent', border: `1px solid ${COLORS.border}`, color: COLORS.muted, borderRadius: 6, padding: '2px 8px', fontSize: 11, cursor: 'pointer' }}>{copied ? 'Copied' : 'Copy'}</button>
            <a href={explorerUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: COLORS.violet }}>View token ↗</a>
          </div>
        </div>

        {/* ── Buyback ──────────────────────────────────────────────────────── */}
        {bb.kind === 'checking' && <div style={{ ...label, color: COLORS.muted }}>Checking buyback…</div>}
        {bb.kind === 'available' && (
          <button onClick={() => setBb({ kind: 'confirming', amount: bb.amount })}
            style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', cursor: 'pointer', background: COLORS.green, color: '#03110a', fontFamily: FONTS.display, fontWeight: 800, fontSize: 14 }}>
            Accept Buyback {formatUsd(buybackUsd(bb.amount))}
          </button>
        )}
        {bb.kind === 'confirming' && (
          <div>
            <div style={{ fontSize: 13, color: COLORS.text, marginBottom: 10, lineHeight: 1.4 }}>
              Sell <b>{card.name}</b> for <b>{formatUsd(buybackUsd(bb.amount))}</b>? You return the card and get USDC. This can't be undone.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => confirmSell(bb.amount)}
                style={{ flex: 1, padding: '11px', borderRadius: 10, border: 'none', cursor: 'pointer', background: COLORS.green, color: '#03110a', fontFamily: FONTS.display, fontWeight: 800 }}>Confirm</button>
              <button onClick={() => setBb({ kind: 'available', amount: bb.amount })}
                style={{ flex: 1, padding: '11px', borderRadius: 10, border: `1px solid ${COLORS.border}`, cursor: 'pointer', background: 'transparent', color: COLORS.text, fontWeight: 700 }}>Cancel</button>
            </div>
          </div>
        )}
        {bb.kind === 'selling' && <div style={{ ...label, color: COLORS.muted }}>Selling back…</div>}
        {bb.kind === 'sold' && <div style={{ fontSize: 13, color: COLORS.green, fontWeight: 700 }}>Sold — {formatUsd(buybackUsd(bb.amount))} credited.</div>}
        {bb.kind === 'error' && (
          <div>
            <div style={{ fontSize: 12, color: COLORS.red, marginBottom: 8 }}>{bb.message}</div>
            <button onClick={() => setBb({ kind: 'available', amount: bb.amount })}
              style={{ width: '100%', padding: '10px', borderRadius: 10, border: `1px solid ${COLORS.border}`, cursor: 'pointer', background: 'transparent', color: COLORS.text, fontWeight: 700 }}>Back</button>
          </div>
        )}
      </div>
    </div>
  )
}
