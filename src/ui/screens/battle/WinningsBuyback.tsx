import { useState, useEffect } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS, GRADIENT, formatUsd } from '../../theme'
import { RevealCard } from './RevealCard'
import { useWallet } from '../../../wallet/useWallet'
import { requestBuyback, submitTx, fetchBuybackAvailable } from '../../../onchain/gachaClient'
import type { RevealCardVM } from './battleReveal'

const ghostBtn = {
  padding: '8px 14px', borderRadius: 10, border: `1px solid ${COLORS.border}`,
  background: 'transparent', color: COLORS.text, cursor: 'pointer',
  fontFamily: FONTS.body, fontSize: 13, fontWeight: 600,
} as const

const badge = (bg: string) => ({
  position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
  padding: '3px 9px', borderRadius: 7, background: bg, color: '#06170f',
  fontFamily: FONTS.display, fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap',
} as const)

/**
 * Winner-only "keep or sell" for a settled battle's haul — mirrors the gacha multi-pull summary.
 * The winner already owns every non-auto-sold card (transferred at settle); here they can sell any
 * back for instant USDC (buyback). Auto-sold commons are shown greyed. No backend change: the
 * buyback endpoint is ownership-based (requestBuyback → sign → submit, per card).
 */
export function WinningsBuyback({ cards, winnerWallet, lootTotal, reducedMotion = true }: {
  cards: RevealCardVM[]
  winnerWallet: string | null
  lootTotal: number
  reducedMotion?: boolean
}) {
  const { identityToken } = useIdentityToken()
  const { signTransactionBase64 } = useWallet()

  const sellable = cards.filter((c) => !c.autoSold && c.nftAddress)
  const autoSoldCount = cards.filter((c) => c.autoSold).length

  const [sell, setSell] = useState<Record<string, boolean>>({})
  const [status, setStatus] = useState<Record<string, 'sold' | 'failed'>>({})
  const [offers, setOffers] = useState<Record<string, number | null>>({})   // nft → USDC base units
  const [busy, setBusy] = useState(false)

  const nftKey = sellable.map((c) => c.nftAddress).join(',')
  useEffect(() => {
    if (!winnerWallet || !nftKey) return
    let cancelled = false
    Promise.all(sellable.map(async (c) => {
      try {
        const r = await fetchBuybackAvailable(winnerWallet, c.nftAddress!)
        return [c.nftAddress!, r.available ? r.amount : null] as const
      } catch { return [c.nftAddress!, null] as const }
    })).then((pairs) => { if (!cancelled) setOffers(Object.fromEntries(pairs)) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winnerWallet, nftKey])

  if (sellable.length === 0 && autoSoldCount === 0) return null

  const pending = sellable.filter((c) => sell[c.nftAddress!] && status[c.nftAddress!] !== 'sold')
  const pendingUsd = pending.reduce((s, c) => s + ((offers[c.nftAddress!] ?? 0) / 1e6), 0)
  const soldCount = Object.values(status).filter((v) => v === 'sold').length

  const setAll = (v: boolean) => setSell(() => {
    const m: Record<string, boolean> = {}
    sellable.forEach((c) => { if (status[c.nftAddress!] !== 'sold') m[c.nftAddress!] = v })
    return m
  })
  const toggle = (nft: string) => setSell((s) => ({ ...s, [nft]: !s[nft] }))

  async function sellSelected() {
    if (!identityToken || busy || pending.length === 0) return
    setBusy(true)
    for (const c of pending) {
      try {
        const res = await requestBuyback(identityToken, c.nftAddress!)
        const signed = await signTransactionBase64(res.serialized_transaction)
        await submitTx(identityToken, signed)
        setStatus((s) => ({ ...s, [c.nftAddress!]: 'sold' }))
      } catch {
        setStatus((s) => ({ ...s, [c.nftAddress!]: 'failed' }))
      }
    }
    setBusy(false)
  }

  return (
    <section style={{
      borderRadius: 22, padding: 'clamp(20px,2.4vw,30px)',
      background: 'linear-gradient(135deg,rgba(0,255,196,.08),rgba(13,17,22,.6) 55%,rgba(255,46,151,.06))',
      border: '1px solid rgba(0,255,196,.32)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '.2em', color: COLORS.green }}>YOUR WINNINGS · {formatUsd(lootTotal)}</span>
        <span style={{ flex: 1, minWidth: 20, height: 1, background: 'linear-gradient(90deg,rgba(0,255,196,.25),transparent)' }} />
        <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.muted }}>
          {sellable.length} to keep or sell{autoSoldCount > 0 ? ` · ${autoSoldCount} auto-sold` : ''}
        </span>
      </div>
      <div style={{ fontSize: 13, color: COLORS.muted, marginBottom: 14 }}>
        These cards are yours. Keep them, or sell any back for instant USDC.
      </div>

      {sellable.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', marginBottom: 16 }}>
          <button onClick={() => setAll(false)} disabled={busy} style={ghostBtn}>Keep all</button>
          <button onClick={() => setAll(true)} disabled={busy} style={ghostBtn}>Sell all</button>
          <div style={{ flex: 1 }} />
          <button onClick={sellSelected} disabled={busy || pending.length === 0} style={{
            padding: '11px 22px', borderRadius: 12, border: 0,
            cursor: pending.length && !busy ? 'pointer' : 'not-allowed', opacity: pending.length && !busy ? 1 : 0.5,
            fontFamily: FONTS.display, fontSize: 14, fontWeight: 800, color: '#06170f',
            background: GRADIENT, boxShadow: '0 0 22px -6px rgba(0,255,196,.7)',
          }}>
            {busy ? 'Selling…' : pending.length ? `Sell ${pending.length} · ~${formatUsd(pendingUsd)}` : 'Select cards to sell'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        {cards.map((c, i) => {
          const nft = c.nftAddress
          if (c.autoSold || !nft) {
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, opacity: 0.5 }}>
                <div style={{ position: 'relative' }}>
                  <RevealCard card={c} reducedMotion={reducedMotion} w={120} h={200} />
                  <div style={badge(COLORS.muted)}>AUTO-SOLD</div>
                </div>
              </div>
            )
          }
          const st = status[nft]
          const picked = !!sell[nft] && st !== 'sold'
          const offer = offers[nft]
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, opacity: st === 'sold' ? 0.5 : 1 }}>
              <div style={{ position: 'relative' }}>
                <RevealCard card={c} reducedMotion={reducedMotion} w={120} h={200} />
                {st === 'sold' && <div style={badge('#00c79a')}>SOLD{offer != null ? ` +${formatUsd(offer / 1e6)}` : ''}</div>}
                {st === 'failed' && <div style={badge(COLORS.red)}>FAILED</div>}
              </div>
              {st !== 'sold' && (
                <button onClick={() => toggle(nft)} disabled={busy} style={{
                  width: 120, padding: '7px 0', borderRadius: 9, cursor: busy ? 'default' : 'pointer',
                  fontFamily: FONTS.body, fontSize: 12, fontWeight: 700,
                  border: `1px solid ${picked ? 'rgba(245,197,66,.6)' : COLORS.border}`,
                  background: picked ? 'rgba(245,197,66,.14)' : 'transparent',
                  color: picked ? '#f5c542' : COLORS.text,
                }}>
                  {picked ? `Sell${offer != null ? ` · ${formatUsd(offer / 1e6)}` : ''}` : 'Keep'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {soldCount > 0 && (
        <div style={{ marginTop: 14, fontFamily: FONTS.mono, fontSize: 11, color: COLORS.green }}>
          Sold {soldCount} card{soldCount > 1 ? 's' : ''} back for USDC — credited to your balance.
        </div>
      )}
    </section>
  )
}
