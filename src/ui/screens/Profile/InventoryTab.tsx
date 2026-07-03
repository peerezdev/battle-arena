import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS, SHADOW, formatUsd } from '../../theme'
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
function CardTile({ card, onClick, selectable, checked, onToggle }: {
  card: OwnedCard
  onClick: () => void
  selectable?: boolean
  checked?: boolean
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
  // In select mode a click toggles selection; otherwise it opens the detail modal.
  const activate = selectable ? (onToggle ?? onClick) : onClick

  return (
    <div
      onClick={activate}
      role="button"
      aria-pressed={selectable ? !!checked : undefined}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') activate() }}
      style={{
        position: 'relative', borderRadius: 14, overflow: 'hidden', cursor: 'pointer',
        background: COLORS.panel2,
        border: `1px solid ${selectable && checked ? COLORS.green : COLORS.border}`,
        boxShadow: selectable && checked ? `0 0 0 1px ${COLORS.green}, ${SHADOW.glow(COLORS.green)}` : 'none',
      }}
    >
      {selectable && (
        <span
          aria-hidden
          style={{
            position: 'absolute', top: 10, right: 10, zIndex: 3,
            width: 24, height: 24, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: checked ? COLORS.green : 'rgba(6,8,11,.7)',
            border: `1px solid ${checked ? COLORS.green : COLORS.border}`,
            color: '#06170f',
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

type BulkBuyback =
  | { phase: 'running'; done: number; total: number; ok: number; failed: number }
  | { phase: 'finished'; done: number; total: number; ok: number; failed: number }

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
  const { available: buybackMints } = useBuybackAvailability(cards, embeddedAddress)
  const grid = useGridStyle()

  const [selected, setSelected] = useState<OwnedCard | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [onlyBuyback, setOnlyBuyback] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [bulkBuyback, setBulkBuyback] = useState<BulkBuyback | null>(null)

  // Buyback/withdraw only apply to embedded-won cards (mirrors InventoryCardModal's gating).
  const visible = onlyBuyback ? cards.filter((c) => buybackMints.has(c.mint)) : cards
  const chosenCards = cards.filter((c) => chosen.has(c.mint))
  const chosenEmbedded = chosenCards.filter((c) => c.source === 'embedded')

  function toggle(mint: string) {
    setChosen((s) => {
      const next = new Set(s)
      if (next.has(mint)) next.delete(mint); else next.add(mint)
      return next
    })
  }

  function clearSelection() {
    setChosen(new Set())
    setSelectMode(false)
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
    setBulkBuyback({ phase: 'finished', done: total, total, ok, failed })
    refresh()
  }

  return (
    <div style={{ animation: 'ba-tabin .25s ease-out' }}>
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
          <button
            type="button"
            aria-pressed={selectMode}
            onClick={() => { setSelectMode((v) => !v); if (selectMode) clearSelection() }}
            style={chipStyle(selectMode)}
          >
            {selectMode ? 'Done' : 'Select'}
          </button>
        </div>
      </div>

      {selectMode && chosen.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14,
          padding: '10px 14px', borderRadius: 12, background: COLORS.panel2, border: `1px solid ${COLORS.border}`,
        }}>
          <span style={{ fontFamily: FONTS.body, fontSize: 13, fontWeight: 700, color: COLORS.text }}>{chosen.size} selected</span>
          {chosenEmbedded.length < chosen.size && (
            <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: COLORS.muted }}>
              ({chosenEmbedded.length} eligible — only wallet-won cards)
            </span>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
            <button
              type="button"
              disabled={chosenEmbedded.length === 0 || bulkBuyback?.phase === 'running'}
              onClick={() => void runBulkBuyback()}
              style={{
                ...chipStyle(false),
                opacity: (chosenEmbedded.length === 0 || bulkBuyback?.phase === 'running') ? 0.5 : 1,
                cursor: (chosenEmbedded.length === 0 || bulkBuyback?.phase === 'running') ? 'default' : 'pointer',
              }}
            >
              {bulkBuyback?.phase === 'running' ? `Selling ${bulkBuyback.done}/${bulkBuyback.total}…` : 'Buyback'}
            </button>
            <button
              type="button"
              disabled={chosenEmbedded.length === 0}
              onClick={() => setWithdrawOpen(true)}
              style={{
                ...chipStyle(false),
                opacity: chosenEmbedded.length === 0 ? 0.5 : 1,
                cursor: chosenEmbedded.length === 0 ? 'default' : 'pointer',
              }}
            >
              Withdraw
            </button>
            <button type="button" onClick={clearSelection} style={chipStyle(false)}>Clear</button>
          </div>
          {bulkBuyback?.phase === 'finished' && (
            <div style={{ flexBasis: '100%', fontFamily: FONTS.mono, fontSize: 11, color: bulkBuyback.failed ? COLORS.red : COLORS.green }}>
              Buyback complete · {bulkBuyback.ok} sold{bulkBuyback.failed ? ` · ${bulkBuyback.failed} failed` : ''}
            </div>
          )}
        </div>
      )}

      {onlyBuyback && visible.length === 0 && (
        <div style={{ color: COLORS.muted, fontSize: 14, marginBottom: 14 }}>No cards with an active buyback offer.</div>
      )}

      <div style={grid}>
        {!selectMode && !onlyBuyback && <OpenPacksTile />}
        {visible.map((c) => (
          <CardTile
            key={`${c.source}-${c.mint}`}
            card={c}
            onClick={() => setSelected(c)}
            selectable={selectMode}
            checked={chosen.has(c.mint)}
            onToggle={() => toggle(c.mint)}
          />
        ))}
      </div>

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
