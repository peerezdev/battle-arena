import { useState, useEffect } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS, GRADIENT, formatUsd } from '../../theme'
import { RevealCard } from './RevealCard'
import { useWallet } from '../../../wallet/useWallet'
import { requestBuyback, submitTx, fetchBuybackAvailable, ccCardImageUrl } from '../../../onchain/gachaClient'
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
export function WinningsBuyback({ cards, winnerWallet, lootTotal, reducedMotion = true, wide = false }: {
  cards: RevealCardVM[]
  winnerWallet: string | null
  lootTotal: number
  reducedMotion?: boolean
  wide?: boolean   // desktop result: header-right actions + horizontal strip with a BEST PULL hero
}) {
  const { identityToken } = useIdentityToken()
  const { signTransactionBase64 } = useWallet()

  const sellable = cards.filter((c) => !c.autoSold && c.nftAddress)
  const autoSoldCount = cards.filter((c) => c.autoSold).length

  const [sell, setSell] = useState<Record<string, boolean>>({})
  const [status, setStatus] = useState<Record<string, 'sold' | 'failed'>>({})
  const [offers, setOffers] = useState<Record<string, number | null>>({})   // nft → USDC base units
  const [busy, setBusy] = useState(false)
  const [autoOpen, setAutoOpen] = useState(false)   // desktop: expand the packed auto-sold stack

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

  // ── Desktop result: actions on the header row, cards in one strip, best pull featured. ──
  if (wide) {
    const byValue = (a: RevealCardVM, b: RevealCardVM) => (b.insuredValue ?? 0) - (a.insuredValue ?? 0)
    const keepable = [...sellable].sort(byValue)
    const gone = cards.filter((c) => c.autoSold || !c.nftAddress).sort(byValue)
    // Auto-sold cards aren't actionable, so they're packed into one stack (same idea as the
    // royale champion loot) instead of eating strip space one by one.
    const goneTotal = gone.reduce((s, c) => s + (c.insuredValue ?? 0), 0)

    return (
      <section style={{ borderRadius: 20, border: `1px solid ${COLORS.border}`, background: '#0c0f15', padding: '24px 28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: FONTS.mono, fontSize: 11, fontWeight: 700, letterSpacing: '.18em', color: COLORS.green }}>YOUR WINNINGS · {formatUsd(lootTotal)}</span>
            <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: '#7d8794' }}>
              {sellable.length} to keep or sell{autoSoldCount > 0 ? ` · ${autoSoldCount} auto-sold` : ''}
            </span>
          </div>
          {sellable.length > 0 && (
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setAll(false)} disabled={busy} style={ghostBtn}>Keep all</button>
              <button onClick={() => setAll(true)} disabled={busy} style={ghostBtn}>Sell all</button>
              <button onClick={sellSelected} disabled={busy || pending.length === 0} style={{
                padding: '10px 18px', borderRadius: 10, border: 0,
                cursor: pending.length && !busy ? 'pointer' : 'not-allowed', opacity: pending.length && !busy ? 1 : 0.5,
                background: GRADIENT, color: '#06080b', fontFamily: FONTS.display, fontSize: 13, fontWeight: 700,
              }}>
                {busy ? 'Selling…' : pending.length ? `Sell ${pending.length} · ~${formatUsd(pendingUsd)}` : 'Select cards to sell'}
              </button>
            </div>
          )}
        </div>
        <p style={{ margin: '10px 0 0', fontSize: 14, color: '#aab3bf' }}>
          These cards are yours. Keep them, or sell any back for instant USDC.
        </p>

        <div style={{ display: 'flex', gap: 14, marginTop: 22, alignItems: 'flex-end', overflowX: 'auto', padding: '12px 2px 6px' }}>
          {keepable.map((c, i) => {
            const nft = c.nftAddress!
            const isBest = i === 0   // best pull stands out by badge/gold, not by size
            const w = 150
            const h = 210
            const st = status[nft]
            const picked = !!sell[nft] && st !== 'sold'
            const offer = offers[nft]
            return (
              <div key={i} style={{ position: 'relative', width: w, flexShrink: 0, opacity: st === 'sold' ? 0.5 : 1 }}>
                {isBest && (
                  <span style={{
                    position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', zIndex: 2,
                    fontFamily: FONTS.mono, fontSize: 9, fontWeight: 700, letterSpacing: '.12em', color: '#2b2005',
                    background: 'linear-gradient(90deg,#ffd166,#f0a832)', borderRadius: 999, padding: '4px 10px',
                    whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(255,209,102,.35)',
                  }}>⚡ BEST PULL</span>
                )}
                <div style={{ position: 'relative', borderRadius: 12, ...(isBest ? { boxShadow: '0 0 40px rgba(255,209,102,.2)' } : {}) }}>
                  <RevealCard card={c} reducedMotion={reducedMotion} w={w} h={h} bare />
                  {st === 'sold' && <div style={badge('#00c79a')}>SOLD{offer != null ? ` +${formatUsd(offer / 1e6)}` : ''}</div>}
                  {st === 'failed' && <div style={badge(COLORS.red)}>FAILED</div>}
                </div>
                <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 600, color: '#cdd4dd', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.name ?? '—'}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: isBest ? '#ffd166' : COLORS.text }}>{formatUsd(c.insuredValue ?? 0)}</span>
                  {st !== 'sold' && (
                    <button onClick={() => toggle(nft)} disabled={busy} style={{
                      padding: '6px 12px', borderRadius: 8, cursor: busy ? 'default' : 'pointer',
                      fontFamily: FONTS.body, fontSize: 11, fontWeight: 700,
                      border: `1px solid ${picked ? 'rgba(245,197,66,.6)' : 'rgba(60,232,168,.4)'}`,
                      background: picked ? 'rgba(245,197,66,.14)' : 'transparent',
                      color: picked ? '#f5c542' : COLORS.green,
                    }}>{picked ? `Sell${offer != null ? ` · ${formatUsd(offer / 1e6)}` : ''}` : 'Keep'}</button>
                  )}
                </div>
              </div>
            )
          })}

          {/* auto-sold → one packed stack; they're already sold, so there's nothing to act on */}
          {gone.length > 0 && (
            <div style={{ width: 150, flexShrink: 0 }}>
              <button onClick={() => setAutoOpen((e) => !e)} title={autoOpen ? 'Hide auto-sold' : 'Show auto-sold'}
                style={{ position: 'relative', width: 150, height: 210, border: 0, background: 'transparent', padding: 0, cursor: 'pointer' }}>
                <span style={{ position: 'absolute', inset: 0, transform: 'translate(11px,-9px) rotate(5deg)', borderRadius: 12, background: '#12151d', border: `1px solid ${COLORS.border}` }} />
                <span style={{ position: 'absolute', inset: 0, transform: 'translate(5px,-4px) rotate(2.5deg)', borderRadius: 12, background: '#161a24', border: `1px solid ${COLORS.border}` }} />
                <span style={{
                  position: 'absolute', inset: 0, borderRadius: 12, background: 'linear-gradient(160deg,#1b1020,#101018)',
                  border: '1px solid rgba(255,46,126,.35)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: COLORS.text,
                }}>
                  <span style={{ fontSize: 26, fontWeight: 700 }}>×{gone.length}</span>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 9, fontWeight: 700, letterSpacing: '.1em', color: '#ff6ba4' }}>AUTO-SOLD</span>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: COLORS.muted }}>{autoOpen ? 'hide ↑' : 'see all ↓'}</span>
                </span>
              </button>
              <div style={{ marginTop: 8, fontSize: 14, fontWeight: 700, color: '#7d8794' }}>{formatUsd(goneTotal)} ⚡</div>
            </div>
          )}
        </div>

        {autoOpen && gone.length > 0 && (
          <div style={{ marginTop: 4, paddingTop: 16, borderTop: '1px dashed rgba(255,46,126,.25)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(70px,1fr))', gap: 8 }}>
              {gone.map((c, i) => (
                <div key={c.nftAddress ?? i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, opacity: 0.7 }}>
                  <div style={{ width: '100%', aspectRatio: '5 / 7', borderRadius: 7, overflow: 'hidden', background: 'linear-gradient(160deg,#1b1020,#101018)', border: `1px solid ${COLORS.border}` }}>
                    {c.nftAddress && <img src={ccCardImageUrl(c.nftAddress)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                  </div>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: '#7a8492' }}>{formatUsd(c.insuredValue ?? 0)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {soldCount > 0 && (
          <div style={{ marginTop: 14, fontFamily: FONTS.mono, fontSize: 11, color: COLORS.green }}>
            Sold {soldCount} card{soldCount > 1 ? 's' : ''} back for USDC — credited to your balance.
          </div>
        )}
      </section>
    )
  }

  // ── Mobile: framed cards in a strip (best pull first), auto-sold packed into one stack. ──
  const byValueM = (a: RevealCardVM, b: RevealCardVM) => (b.insuredValue ?? 0) - (a.insuredValue ?? 0)
  const keepableM = [...sellable].sort(byValueM)
  const goneM = cards.filter((c) => c.autoSold || !c.nftAddress).sort(byValueM)
  const goneTotalM = goneM.reduce((s, c) => s + (c.insuredValue ?? 0), 0)

  return (
    <section style={{ borderRadius: 16, background: '#0a0d13', border: `1px solid ${COLORS.border}`, padding: '14px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', marginBottom: 3 }}>
        <span style={{ fontFamily: FONTS.mono, fontSize: 10, fontWeight: 700, letterSpacing: '.14em', color: COLORS.green }}>YOUR WINNINGS · {formatUsd(lootTotal)}</span>
        <span style={{ marginLeft: 'auto', fontFamily: FONTS.mono, fontSize: 8.5, color: '#5c6673', whiteSpace: 'nowrap' }}>
          {sellable.length} KEEP{autoSoldCount > 0 ? ` · ${autoSoldCount} AUTO-SOLD` : ''}
        </span>
      </div>
      <p style={{ margin: '0 14px 10px', fontSize: 11.5, lineHeight: 1.45, color: '#8b95a3' }}>
        These cards are yours. Keep them, or sell any back for instant USDC.
      </p>

      {sellable.length > 0 && (
        <div style={{ display: 'flex', gap: 6, padding: '0 14px', marginBottom: 14 }}>
          <button onClick={() => setAll(false)} disabled={busy} style={mBtn}>Keep all</button>
          <button onClick={() => setAll(true)} disabled={busy} style={mBtn}>Sell all</button>
          <button onClick={sellSelected} disabled={busy || pending.length === 0} style={{
            marginLeft: 'auto', padding: '8px 14px', borderRadius: 9, border: 0,
            cursor: pending.length && !busy ? 'pointer' : 'not-allowed', opacity: pending.length && !busy ? 1 : 0.5,
            background: GRADIENT, color: '#06080b', fontFamily: FONTS.display, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
          }}>
            {busy ? 'Selling…' : pending.length ? `Sell ${pending.length}` : 'Select to sell'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '8px 14px 2px', alignItems: 'flex-end' }}>
        {keepableM.map((c, i) => {
          const nft = c.nftAddress!
          const isBest = i === 0   // best pull stands out by badge/gold, not by size
          const cw = 104
          const artH = 112
          const st = status[nft]
          const picked = !!sell[nft] && st !== 'sold'
          const offer = offers[nft]
          return (
            <div key={i} style={{
              position: 'relative', flex: 'none', width: cw, borderRadius: 12, background: '#0e1219',
              border: `1.5px solid ${isBest ? 'rgba(255,209,102,.55)' : 'rgba(60,232,168,.5)'}`,
              boxShadow: isBest ? '0 0 26px rgba(255,209,102,.18)' : undefined,
              padding: 7, display: 'flex', flexDirection: 'column', gap: 6, opacity: st === 'sold' ? 0.5 : 1,
            }}>
              {isBest && (
                <span style={{
                  position: 'absolute', top: -9, left: '50%', transform: 'translateX(-50%)', zIndex: 2,
                  fontFamily: FONTS.mono, fontSize: 7.5, fontWeight: 700, letterSpacing: '.1em', color: '#2b2005',
                  background: 'linear-gradient(90deg,#ffd166,#f0a832)', borderRadius: 999, padding: '3px 8px',
                  whiteSpace: 'nowrap', boxShadow: '0 4px 12px rgba(255,209,102,.35)',
                }}>⚡ BEST PULL</span>
              )}
              <div style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
                <RevealCard card={c} reducedMotion={reducedMotion} w={cw - 14} h={artH} bare />
                {st === 'sold' && <div style={badge('#00c79a')}>SOLD{offer != null ? ` +${formatUsd(offer / 1e6)}` : ''}</div>}
                {st === 'failed' && <div style={badge(COLORS.red)}>FAILED</div>}
              </div>
              <div style={{ lineHeight: 1.25, minWidth: 0 }}>
                <div style={{ fontSize: 9.5, fontWeight: 600, color: '#cdd4dd', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name ?? '—'}</div>
                <div style={{ fontFamily: FONTS.mono, fontSize: 11.5, fontWeight: 700, color: isBest ? '#ffd166' : COLORS.text }}>{formatUsd(c.insuredValue ?? 0)}</div>
              </div>
              {st !== 'sold' && (
                <button onClick={() => toggle(nft)} disabled={busy} style={{
                  padding: 6, borderRadius: 8, cursor: busy ? 'default' : 'pointer',
                  fontFamily: FONTS.body, fontSize: 10, fontWeight: 700,
                  border: `1px solid ${picked ? 'rgba(245,197,66,.6)' : 'rgba(60,232,168,.4)'}`,
                  background: picked ? 'rgba(245,197,66,.14)' : 'rgba(60,232,168,.07)',
                  color: picked ? '#f5c542' : COLORS.green,
                }}>{picked ? 'Sell' : 'Keep'}</button>
              )}
            </div>
          )
        })}

        {/* auto-sold → one packed stack (same idea as the royale champion loot) */}
        {goneM.length > 0 && (
          <div style={{ flex: 'none', width: 104 }}>
            <button onClick={() => setAutoOpen((e) => !e)} title={autoOpen ? 'Hide auto-sold' : 'Show auto-sold'}
              style={{ position: 'relative', width: 104, height: 146, border: 0, background: 'transparent', padding: 0, cursor: 'pointer' }}>
              <span style={{ position: 'absolute', inset: 0, transform: 'translate(9px,-7px) rotate(5deg)', borderRadius: 12, background: '#12151d', border: `1px solid ${COLORS.border}` }} />
              <span style={{ position: 'absolute', inset: 0, transform: 'translate(4px,-3px) rotate(2.5deg)', borderRadius: 12, background: '#161a24', border: `1px solid ${COLORS.border}` }} />
              <span style={{
                position: 'absolute', inset: 0, borderRadius: 12, background: 'linear-gradient(160deg,#1b1020,#101018)',
                border: '1px solid rgba(255,46,126,.35)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: COLORS.text,
              }}>
                <span style={{ fontSize: 20, fontWeight: 700 }}>×{goneM.length}</span>
                <span style={{ fontFamily: FONTS.mono, fontSize: 7.5, fontWeight: 700, letterSpacing: '.08em', color: '#ff6ba4' }}>AUTO-SOLD</span>
                <span style={{ fontFamily: FONTS.mono, fontSize: 7.5, color: COLORS.muted }}>{autoOpen ? 'hide ↑' : 'see all ↓'}</span>
              </span>
            </button>
            <div style={{ marginTop: 7, fontFamily: FONTS.mono, fontSize: 11, fontWeight: 700, color: '#7d8794' }}>{formatUsd(goneTotalM)} ⚡</div>
          </div>
        )}
      </div>

      {autoOpen && goneM.length > 0 && (
        <div style={{ margin: '12px 14px 0', paddingTop: 12, borderTop: '1px dashed rgba(255,46,126,.25)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(58px,1fr))', gap: 7 }}>
            {goneM.map((c, i) => (
              <div key={c.nftAddress ?? i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, opacity: 0.7 }}>
                <div style={{ width: '100%', aspectRatio: '5 / 7', borderRadius: 6, overflow: 'hidden', background: 'linear-gradient(160deg,#1b1020,#101018)', border: `1px solid ${COLORS.border}` }}>
                  {c.nftAddress && <img src={ccCardImageUrl(c.nftAddress)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                </div>
                <span style={{ fontFamily: FONTS.mono, fontSize: 8, color: '#7a8492' }}>{formatUsd(c.insuredValue ?? 0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {soldCount > 0 && (
        <div style={{ margin: '12px 14px 0', fontFamily: FONTS.mono, fontSize: 10.5, color: COLORS.green }}>
          Sold {soldCount} card{soldCount > 1 ? 's' : ''} back for USDC — credited to your balance.
        </div>
      )}
    </section>
  )
}

const mBtn = {
  padding: '8px 14px', borderRadius: 9, border: `1px solid ${COLORS.border}`,
  background: 'transparent', color: '#cdd4dd', cursor: 'pointer',
  fontFamily: FONTS.body, fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap',
} as const
