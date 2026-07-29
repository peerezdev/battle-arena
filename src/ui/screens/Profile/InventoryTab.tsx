import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS, SHADOW, GRADIENT, formatUsd } from '../../theme'
import { showToast } from '../../toastBus'
import { useIsWide } from '../../useIsWide'
import { useCollectorCryptNfts, type OwnedCard } from '../../../inventory/useCollectorCryptNfts'
import { usePublicInventory } from '../../../inventory/usePublicInventory'
import { useBuybackAvailability } from '../../../inventory/useBuybackAvailability'
import { useEmbeddedSolanaAddress } from '../../../wallet/embedded'
import { useWallet } from '../../../wallet/useWallet'
import { ccCardImageUrl, fetchCardMetadata, requestBuyback, submitTx, type NftMetadata } from '../../../onchain/gachaClient'
import { InventoryCardModal } from './InventoryCardModal'
import { WithdrawNftModal } from './WithdrawNftModal'

// Mobile (narrow phones): force exactly 2 cards per row. Wider: responsive auto-fill so the
// cards keep a sensible size and add columns as space allows.
function useGridStyle(): React.CSSProperties {
  const wide = useIsWide('(min-width: 560px)')
  return {
    display: 'grid',
    gridTemplateColumns: wide ? 'repeat(auto-fill,minmax(210px,1fr))' : 'repeat(2,1fr)',
    gap: wide ? 16 : 10,
  }
}

// Uniform card — no rarity tint/border/glow/badge; every card looks the same.
function CardTile({ card, onClick, checked, onToggle }: {
  card: OwnedCard
  onClick: () => void
  checked?: boolean
  /** When provided, a selection checkbox is shown in the top-right corner. */
  onToggle?: () => void
}) {
  const [imgErr, setImgErr] = useState(false)
  const [meta, setMeta] = useState<NftMetadata | null>(null)
  // Prefer CC's front-image endpoint (reliable on devnet) like the rest of the app; fall back to the
  // DAS metadata image, then a placeholder.
  const imgSrc = (card.mint ? ccCardImageUrl(card.mint) : null) ?? card.image

  // DAS gives no insuredValue/name detail on devnet → pull the card's metadata by mint from CC
  // (via our backend proxy; the result is memoised so the modal reuses it without refetching).
  useEffect(() => {
    let cancelled = false
    if (!card.mint) return
    fetchCardMetadata(card.mint).then((m) => { if (!cancelled) setMeta(m) }).catch(() => {})
    return () => { cancelled = true }
  }, [card.mint])

  const insuredValue = card.insuredValue ?? meta?.insured_value ?? null
  const name = (card.name && card.name !== 'Unnamed') ? card.name : (meta?.name ?? card.name)

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick() }}
      style={{
        position: 'relative', borderRadius: 14, overflow: 'hidden', cursor: 'pointer',
        background: COLORS.panel2,
        border: `1px solid ${checked ? COLORS.green : COLORS.border}`,
        boxShadow: checked ? `0 0 0 1px ${COLORS.green}, ${SHADOW.glow(COLORS.green)}` : 'none',
      }}
    >
      {onToggle && (
        <span
          role="checkbox"
          aria-checked={!!checked}
          aria-label={checked ? 'Deselect card' : 'Select card'}
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onToggle() }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onToggle() } }}
          style={{
            position: 'absolute', top: 10, right: 10, zIndex: 3, cursor: 'pointer',
            width: 24, height: 24, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: checked ? COLORS.green : 'rgba(6,8,11,.66)',
            border: `1px solid ${checked ? COLORS.green : COLORS.border}`,
            color: '#06170f', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
          }}
        >
          {checked && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          )}
        </span>
      )}
      <div style={{ margin: '12px 12px 10px', aspectRatio: '5 / 7', borderRadius: 9, overflow: 'hidden', background: '#0c1019', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {imgSrc && !imgErr
          ? <img src={imgSrc} alt={name} onError={() => setImgErr(true)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          : <span style={{ fontSize: 34 }}>🃏</span>}
      </div>
      <div style={{ padding: '0 14px 15px' }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: '#e7ecf2', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: '2.6em' }}>{name}</div>
        {insuredValue != null && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 8.5, letterSpacing: '.14em', color: COLORS.muted }}>INSURED VALUE</div>
            <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 18, color: COLORS.text, marginTop: 1 }}>{formatUsd(insuredValue)}</div>
          </div>
        )}
      </div>
    </div>
  )
}

function OpenPacksTile() {
  const navigate = useNavigate()
  return (
    <button
      onClick={() => navigate('/play/gacha')}
      style={{
        position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
        minHeight: 235, borderRadius: 14, cursor: 'pointer', fontFamily: FONTS.body,
        background: 'linear-gradient(160deg,rgba(255,46,151,.16),rgba(0,255,196,.08) 60%,rgba(8,10,14,.5))',
        border: '1px dashed rgba(0,255,196,.45)', color: COLORS.text,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg,#ff2e97,#00ffc4)', boxShadow: '0 10px 30px -8px rgba(0,255,196,.7),inset 0 1px 0 rgba(255,255,255,.4)' }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#06170f" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg>
      </span>
      <div style={{ textAlign: 'center', lineHeight: 1.3 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.text }}>Open a pack</div>
        <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>Add cards to your collection</div>
      </div>
    </button>
  )
}

/** Read-only inventory for another player's wallet. */
function PublicInventory({ wallet }: { wallet: string }) {
  const { cards, loading } = usePublicInventory(wallet)
  const [selected, setSelected] = useState<OwnedCard | null>(null)
  const grid = useGridStyle()
  if (loading) return <div style={{ color: COLORS.muted, fontSize: 14 }}>Loading cards…</div>
  if (cards.length === 0) return <div style={{ color: COLORS.muted, fontSize: 14 }}>No Collector Crypt cards in this wallet.</div>
  const owned: OwnedCard[] = cards.map((c) => ({ ...c, source: 'connected' }))
  return (
    <div style={{ animation: 'ba-tabin .25s ease-out' }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '.2em', color: COLORS.muted, marginBottom: 14 }}>INVENTORY · <span style={{ color: COLORS.text }}>{owned.length} CARDS</span></div>
      <div style={grid}>
        {owned.map((c) => <CardTile key={`${c.source}-${c.mint}`} card={c} onClick={() => setSelected(c)} />)}
      </div>
      {selected && <InventoryCardModal card={selected} onClose={() => setSelected(null)} onSold={() => {}} />}
    </div>
  )
}

export function InventoryTab({ wallet }: { wallet?: string }) {
  if (wallet) return <PublicInventory wallet={wallet} />
  return <OwnInventory />
}

type BulkBuyback = { phase: 'running'; done: number; total: number; ok: number; failed: number }

function chipStyle(active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 13px', borderRadius: 999,
    fontFamily: FONTS.body, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
    background: active ? 'rgba(0,255,196,.12)' : 'rgba(255,255,255,.04)',
    border: `1px solid ${active ? COLORS.green : COLORS.border}`,
    color: active ? COLORS.green : COLORS.text,
  }
}

function OwnInventory() {
  const { cards, loading, refresh } = useCollectorCryptNfts()
  const { identityToken } = useIdentityToken()
  const { signTransactionBase64 } = useWallet()
  const embeddedAddress = useEmbeddedSolanaAddress()
  const { available: buybackMints, amounts: buybackAmounts } = useBuybackAvailability(cards, embeddedAddress)
  const grid = useGridStyle()
  const wide = useIsWide('(min-width: 860px)')   // desktop: bar sits low; mobile: clears the bottom nav

  const [selected, setSelected] = useState<OwnedCard | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [onlyBuyback, setOnlyBuyback] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [bulkBuyback, setBulkBuyback] = useState<BulkBuyback | null>(null)

  // Buyback/withdraw only apply to embedded-won cards (mirrors InventoryCardModal's gating).
  const visible = onlyBuyback ? cards.filter((c) => buybackMints.has(c.mint)) : cards
  const chosenCards = cards.filter((c) => chosen.has(c.mint))
  const chosenEmbedded = chosenCards.filter((c) => c.source === 'embedded')
  // Preview of the buyback payout for the current selection (USDC base units → dollars).
  const buybackTotal = chosenEmbedded.reduce((s, c) => s + (buybackAmounts.get(c.mint) ?? 0), 0) / 1e6

  function toggle(mint: string) {
    setChosen((s) => {
      const next = new Set(s)
      if (next.has(mint)) next.delete(mint); else next.add(mint)
      return next
    })
  }

  function selectAll() {
    setChosen(new Set(visible.map((c) => c.mint)))
  }

  function clearSelection() {
    setChosen(new Set())
    setBulkBuyback(null)
  }

  // Bulk buyback: run the same per-card flow as InventoryCardModal (requestBuyback → sign → submit)
  // sequentially, tallying per-item success/failure without aborting the batch on one failure.
  async function runBulkBuyback() {
    if (!identityToken || chosenEmbedded.length === 0) return
    const total = chosenEmbedded.length
    let ok = 0
    let failed = 0
    setBulkBuyback({ phase: 'running', done: 0, total, ok, failed })
    for (let i = 0; i < chosenEmbedded.length; i++) {
      const card = chosenEmbedded[i]
      try {
        const res = await requestBuyback(identityToken, card.mint)
        const signed = await signTransactionBase64(res.serialized_transaction)
        await submitTx(identityToken, signed)
        ok++
      } catch {
        failed++
      }
      setBulkBuyback({ phase: 'running', done: i + 1, total, ok, failed })
    }
    refresh()
    showToast(failed ? `Buyback · ${ok} sold, ${failed} failed` : `Buyback complete · ${ok} sold`, failed ? 'error' : 'success')
    clearSelection()
  }

  return (
    <div style={{ animation: 'ba-tabin .25s ease-out', paddingBottom: chosen.size > 0 ? (wide ? 96 : 152) : 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '.2em', color: COLORS.muted }}>
          YOUR WALLET · <span style={{ color: COLORS.text }}>{cards.length} CARDS</span>{loading && <span style={{ color: COLORS.muted }}> · loading…</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <button
            type="button"
            aria-pressed={onlyBuyback}
            onClick={() => setOnlyBuyback((v) => !v)}
            style={chipStyle(onlyBuyback)}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
            Buyback available
          </button>
        </div>
      </div>

      {onlyBuyback && visible.length === 0 && (
        <div style={{ color: COLORS.muted, fontSize: 14, marginBottom: 14 }}>No cards with an active buyback offer.</div>
      )}

      <div style={grid}>
        {!onlyBuyback && <OpenPacksTile />}
        {visible.map((c) => (
          <CardTile
            key={`${c.source}-${c.mint}`}
            card={c}
            onClick={() => setSelected(c)}
            checked={chosen.has(c.mint)}
            onToggle={() => toggle(c.mint)}
          />
        ))}
      </div>

      {/* Floating selection action bar (bottom-centre) — appears while cards are selected. */}
      {chosen.size > 0 && (
        <div className="hidescroll" style={{
          position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: wide ? 24 : 84,
          zIndex: 60, maxWidth: 'calc(100vw - 20px)', overflowX: 'auto',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, width: 'max-content', padding: '9px 10px', borderRadius: 18,
            background: 'rgba(13,16,22,.96)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
            border: `1px solid ${COLORS.border}`, boxShadow: `0 22px 60px -18px rgba(0,0,0,.85), 0 0 0 1px ${COLORS.green}24`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px 0 6px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: '#cdd4dd', whiteSpace: 'nowrap' }}>
                Selected
                <span key={chosen.size} style={{
                  minWidth: 26, height: 26, padding: '0 7px', borderRadius: 9, background: 'linear-gradient(135deg,#3df0a0,#13c98a)',
                  color: '#06170f', fontFamily: FONTS.mono, fontSize: 13, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  animation: 'ba-pop .22s ease-out', boxShadow: `0 0 14px -4px ${COLORS.green}cc`,
                }}>{chosen.size}</span>
              </span>
              <span style={{ width: 1, height: 24, background: 'rgba(255,255,255,.1)' }} />
              <button type="button" onClick={selectAll}
                style={{ padding: '9px 14px', borderRadius: 11, border: `1px solid ${COLORS.border}`, background: 'rgba(255,255,255,.03)', color: '#cdd4dd', cursor: 'pointer', fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '.1em', whiteSpace: 'nowrap' }}>SELECT ALL</button>
              <button type="button" onClick={clearSelection}
                style={{ padding: '9px 8px', border: 0, background: 'transparent', color: COLORS.muted, cursor: 'pointer', fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '.1em' }}>CANCEL</button>
            </div>

            <span style={{ width: 1, height: 30, background: 'rgba(255,255,255,.1)', margin: '0 2px' }} />

            <button type="button" onClick={() => setWithdrawOpen(true)} disabled={chosenEmbedded.length === 0}
              title={chosenEmbedded.length === 0 ? 'Only wallet-won cards can be withdrawn' : undefined}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 9, padding: '11px 20px', borderRadius: 12, border: 0,
                cursor: chosenEmbedded.length === 0 ? 'default' : 'pointer', opacity: chosenEmbedded.length === 0 ? 0.5 : 1,
                fontFamily: FONTS.mono, fontSize: 12, letterSpacing: '.08em', fontWeight: 700, color: '#06170f',
                background: GRADIENT, boxShadow: `0 10px 26px -12px ${COLORS.green}b3`, whiteSpace: 'nowrap',
              }}>
              WITHDRAW
            </button>
            <button type="button" onClick={() => void runBulkBuyback()} disabled={chosenEmbedded.length === 0 || bulkBuyback?.phase === 'running'}
              title={chosenEmbedded.length === 0 ? 'Only wallet-won cards can be sold back' : undefined}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 9, padding: '11px 18px', borderRadius: 12,
                border: '1px solid rgba(245,197,66,.38)', background: 'rgba(245,197,66,.09)', color: '#f5c542',
                cursor: (chosenEmbedded.length === 0 || bulkBuyback?.phase === 'running') ? 'default' : 'pointer',
                opacity: chosenEmbedded.length === 0 ? 0.5 : 1,
                fontFamily: FONTS.mono, fontSize: 12, letterSpacing: '.08em', fontWeight: 700, whiteSpace: 'nowrap',
              }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 3" /></svg>
              {bulkBuyback?.phase === 'running'
                ? `SELLING ${bulkBuyback.done}/${bulkBuyback.total}`
                : buybackTotal > 0 ? `BUYBACK · ${formatUsd(buybackTotal)}` : 'BUYBACK'}
            </button>
          </div>
        </div>
      )}

      {selected && <InventoryCardModal card={selected} onClose={() => setSelected(null)} onSold={() => refresh()} />}
      <WithdrawNftModal
        open={withdrawOpen}
        cards={chosenEmbedded}
        onClose={() => setWithdrawOpen(false)}
        onDone={() => { refresh(); clearSelection() }}
      />
    </div>
  )
}
