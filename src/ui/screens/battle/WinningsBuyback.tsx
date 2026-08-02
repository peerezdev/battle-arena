import { useState, useEffect } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { CardBadge } from '../../components/CardBadge'
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

// Rejilla compacta (móvil, y también el resultado de royale, que no pide `wide`). Un poco más
// grande que la tira original de 104px: ahora cada carta lleva valor, buyback y el control
// Keep|Sell, y a 104 se apretaban.
const CARD_W = 134
const ART_H = 148

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
  // nft → importe en unidades base | null (CC no ofrece recompra por esa carta) | 'unchecked'
  // (no se pudo preguntar). La distinción importa: `null` es un NO firme del backend y bloquea
  // el Sell, mientras que 'unchecked' es un fallo de red y no debe quitarle al ganador la opción
  // de intentarlo. Sin valor todavía = aún cargando.
  const [offers, setOffers] = useState<Record<string, number | null | 'unchecked'>>({})
  const [busy, setBusy] = useState(false)
  const [autoOpen, setAutoOpen] = useState(false)   // desktop: expand the packed auto-sold stack

  const nftKey = sellable.map((c) => c.nftAddress).join(',')
  useEffect(() => {
    if (!winnerWallet || !nftKey) return
    let cancelled = false
    Promise.all(sellable.map(async (c) => {
      try {
        const r = await fetchBuybackAvailable(winnerWallet, c.nftAddress!)
        if (!r.available) return [c.nftAddress!, null] as const
        return [c.nftAddress!, r.amount ?? 'unchecked'] as const
      } catch { return [c.nftAddress!, 'unchecked'] as const }
    })).then((pairs) => { if (!cancelled) setOffers(Object.fromEntries(pairs)) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winnerWallet, nftKey])

  if (sellable.length === 0 && autoSoldCount === 0) return null

  /** CC ha respondido que no compra esa carta. Pedir el buyback devuelve 400, así que no se vende. */
  const noBuyback = (nft: string) => offers[nft] === null
  const offerUsd = (nft: string) => { const o = offers[nft]; return typeof o === 'number' ? o / 1e6 : null }

  // Una carta que CC no compra nunca entra en el lote: ni marcándola a mano, ni con "Sell all".
  const pending = sellable.filter((c) => sell[c.nftAddress!] && status[c.nftAddress!] !== 'sold' && !noBuyback(c.nftAddress!))
  const pendingUsd = pending.reduce((s, c) => s + (offerUsd(c.nftAddress!) ?? 0), 0)
  const soldCount = Object.values(status).filter((v) => v === 'sold').length

  const setAll = (v: boolean) => setSell(() => {
    const m: Record<string, boolean> = {}
    sellable.forEach((c) => {
      if (status[c.nftAddress!] !== 'sold' && !noBuyback(c.nftAddress!)) m[c.nftAddress!] = v
    })
    return m
  })

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

        {/* Sin scroll horizontal: las cartas envuelven en filas para que se vean TODAS de golpe.
            Son las que el ganador tiene que decidir si vende, y lo que queda fuera del viewport
            no se decide. El rowGap deja hueco al badge de BEST PULL, que sobresale por arriba. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '26px 14px', marginTop: 22, alignItems: 'flex-end', padding: '12px 2px 6px' }}>
          {keepable.map((c, i) => {
            const nft = c.nftAddress!
            const isBest = i === 0   // best pull stands out by badge/gold, not by size
            const w = 150
            const h = 210
            const st = status[nft]
            const picked = !!sell[nft] && st !== 'sold'
            const offer = offerUsd(nft)
            const noBb = noBuyback(nft)
            return (
              <div key={i} style={{ position: 'relative', width: w, flexShrink: 0, opacity: st === 'sold' ? 0.5 : 1 }}>
                {isBest && <CardBadge label="⚡ BEST PULL" color="#ffd166" />}
                <div style={{ position: 'relative', borderRadius: 12, ...(isBest ? { boxShadow: '0 0 40px rgba(255,209,102,.2)' } : {}) }}>
                  <RevealCard card={c} reducedMotion={reducedMotion} w={w} h={h} bare />
                  {st === 'sold' && <div style={badge('#00c79a')}>SOLD{offer != null ? ` +${formatUsd(offer)}` : ''}</div>}
                  {st === 'failed' && <div style={badge(COLORS.red)}>FAILED</div>}
                </div>
                <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 600, color: '#cdd4dd', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.name ?? '—'}
                </div>
                {/* Valor y buyback en la misma línea: lo que vale la carta y lo que te darían por
                    ella se comparan de un vistazo, que es justo la decisión del control de abajo. */}
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4, gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: isBest ? '#ffd166' : COLORS.text }}>{formatUsd(c.insuredValue ?? 0)}</span>
                  {offer != null && <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.muted }} title="Buyback value">↩ {formatUsd(offer)}</span>}
                  {/* Si CC no compra la carta se dice; es la razón por la que abajo no se puede
                      pulsar Sell, en vez de dejar un botón que devolvería 400. */}
                  {noBb && <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: '#6b7480' }} title="Collector Crypt does not buy this card back">no buyback</span>}
                </div>
                {st !== 'sold' && (
                  // Mismo control segmentado Keep|Sell que la rejilla compacta (y que el resumen de
                  // gacha): los dos estados se ven a la vez, en vez de un botón que hay que pulsar
                  // para saber qué hace.
                  <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: `1px solid ${COLORS.border}`, marginTop: 6 }}>
                    <button onClick={() => setSell((s) => ({ ...s, [nft]: false }))} disabled={busy}
                      style={{ flex: 1, padding: '7px 0', border: 0, cursor: busy ? 'default' : 'pointer', fontFamily: FONTS.body, fontSize: 11.5, fontWeight: 700,
                        background: !picked ? 'rgba(0,255,196,.16)' : 'transparent', color: !picked ? COLORS.green : COLORS.muted }}>Keep</button>
                    <button onClick={() => setSell((s) => ({ ...s, [nft]: true }))} disabled={busy || noBb}
                      title={noBb ? 'Collector Crypt does not buy this card back' : undefined}
                      style={{ flex: 1, padding: '7px 0', border: 0, borderLeft: `1px solid ${COLORS.border}`,
                        cursor: busy || noBb ? 'default' : 'pointer', opacity: noBb ? 0.4 : 1, fontFamily: FONTS.body, fontSize: 11.5, fontWeight: 700,
                        background: picked ? 'rgba(255,46,151,.18)' : 'transparent', color: picked ? '#c4adff' : COLORS.muted }}>Sell</button>
                  </div>
                )}
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
            {/* El importe y no el número de cartas: lo que se decide aquí es cuánto USDC entra,
                y "Sell 3" obligaba a sumar de cabeza las tres cifras de las cartas marcadas. */}
            {busy ? 'Selling…' : pending.length ? `Sell · ~${formatUsd(pendingUsd)}` : 'Select to sell'}
          </button>
        </div>
      )}

      {/* Sin scroll horizontal: envuelven en filas para que se vean TODAS. Esta rama no es solo
          móvil —el resultado de royale la monta también en escritorio, porque RoyaleResult no
          calcula ancho—, así que aquí es donde de verdad se nota. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '22px 10px', padding: '8px 14px 2px', alignItems: 'flex-end' }}>
        {keepableM.map((c, i) => {
          const nft = c.nftAddress!
          const isBest = i === 0   // best pull stands out by badge/gold, not by size
          const st = status[nft]
          const picked = !!sell[nft] && st !== 'sold'
          const offer = offerUsd(nft)
          const noBb = noBuyback(nft)
          return (
            <div key={i} style={{
              position: 'relative', flex: 'none', width: CARD_W, borderRadius: 12, background: '#0e1219',
              border: `1.5px solid ${isBest ? 'rgba(255,209,102,.55)' : 'rgba(60,232,168,.5)'}`,
              boxShadow: isBest ? '0 0 26px rgba(255,209,102,.18)' : undefined,
              padding: 8, display: 'flex', flexDirection: 'column', gap: 7, opacity: st === 'sold' ? 0.5 : 1,
            }}>
              {isBest && <CardBadge label="⚡ BEST PULL" color="#ffd166" />}
              <div style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
                <RevealCard card={c} reducedMotion={reducedMotion} w={CARD_W - 16} h={ART_H} bare />
                {st === 'sold' && <div style={badge('#00c79a')}>SOLD{offer != null ? ` +${formatUsd(offer)}` : ''}</div>}
                {st === 'failed' && <div style={badge(COLORS.red)}>FAILED</div>}
              </div>
              <div style={{ lineHeight: 1.3, minWidth: 0 }}>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: '#cdd4dd', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name ?? '—'}</div>
                {/* Valor y buyback en la misma línea, como en el resumen de gacha: lo que vale la
                    carta y lo que te darían por ella se comparan de un vistazo, que es la decisión
                    que pide el control de abajo. El buyback solo sale cuando el backend lo ha dado. */}
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6, marginTop: 2 }}>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 12, fontWeight: 700, color: isBest ? '#ffd166' : COLORS.text }}>{formatUsd(c.insuredValue ?? 0)}</span>
                  {offer != null && <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: COLORS.muted }} title="Buyback value">↩ {formatUsd(offer)}</span>}
                  {/* Un hueco vacío se lee como "no ha cargado". Si CC ha dicho que no compra esa
                      carta, se dice; es la razón por la que abajo no se puede pulsar Sell. */}
                  {noBb && <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: '#6b7480' }} title="Collector Crypt does not buy this card back">no buyback</span>}
                </div>
              </div>
              {st !== 'sold' && (
                // Control segmentado Keep|Sell igual que el del resumen de gacha: los dos estados
                // se ven a la vez, en vez de un botón que hay que pulsar para saber qué hace.
                <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: `1px solid ${COLORS.border}` }}>
                  <button onClick={() => setSell((s) => ({ ...s, [nft]: false }))} disabled={busy}
                    style={{ flex: 1, padding: '6px 0', border: 0, cursor: busy ? 'default' : 'pointer', fontFamily: FONTS.body, fontSize: 11, fontWeight: 700,
                      background: !picked ? 'rgba(0,255,196,.16)' : 'transparent', color: !picked ? COLORS.green : COLORS.muted }}>Keep</button>
                  <button onClick={() => setSell((s) => ({ ...s, [nft]: true }))} disabled={busy || noBb}
                    title={noBb ? 'Collector Crypt does not buy this card back' : undefined}
                    style={{ flex: 1, padding: '6px 0', border: 0, borderLeft: `1px solid ${COLORS.border}`,
                      cursor: busy || noBb ? 'default' : 'pointer', opacity: noBb ? 0.4 : 1, fontFamily: FONTS.body, fontSize: 11, fontWeight: 700,
                      background: picked ? 'rgba(255,46,151,.18)' : 'transparent', color: picked ? '#c4adff' : COLORS.muted }}>Sell</button>
                </div>
              )}
            </div>
          )
        })}

        {/* auto-sold → one packed stack (same idea as the royale champion loot) */}
        {goneM.length > 0 && (
          <div style={{ flex: 'none', width: CARD_W }}>
            <button onClick={() => setAutoOpen((e) => !e)} title={autoOpen ? 'Hide auto-sold' : 'Show auto-sold'}
              style={{ position: 'relative', width: CARD_W, height: 184, border: 0, background: 'transparent', padding: 0, cursor: 'pointer' }}>
              <span style={{ position: 'absolute', inset: 0, transform: 'translate(9px,-7px) rotate(5deg)', borderRadius: 12, background: '#12151d', border: `1px solid ${COLORS.border}` }} />
              <span style={{ position: 'absolute', inset: 0, transform: 'translate(4px,-3px) rotate(2.5deg)', borderRadius: 12, background: '#161a24', border: `1px solid ${COLORS.border}` }} />
              <span style={{
                position: 'absolute', inset: 0, borderRadius: 12, background: 'linear-gradient(160deg,#1b1020,#101018)',
                border: '1px solid rgba(255,46,126,.35)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: COLORS.text,
              }}>
                <span style={{ fontSize: 24, fontWeight: 700 }}>×{goneM.length}</span>
                <span style={{ fontFamily: FONTS.mono, fontSize: 8.5, fontWeight: 700, letterSpacing: '.08em', color: '#ff6ba4' }}>AUTO-SOLD</span>
                <span style={{ fontFamily: FONTS.mono, fontSize: 8.5, color: COLORS.muted }}>{autoOpen ? 'hide ↑' : 'see all ↓'}</span>
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
