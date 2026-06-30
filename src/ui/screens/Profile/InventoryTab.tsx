import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { COLORS, FONTS, formatUsd } from '../../theme'
import { useIsWide } from '../../useIsWide'
import { useCollectorCryptNfts, type OwnedCard } from '../../../inventory/useCollectorCryptNfts'
import { usePublicInventory } from '../../../inventory/usePublicInventory'
import { ccCardImageUrl, fetchCardMetadata, type NftMetadata } from '../../../onchain/gachaClient'
import { InventoryCardModal } from './InventoryCardModal'

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
function CardTile({ card, onClick }: { card: OwnedCard; onClick: () => void }) {
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
        background: COLORS.panel2, border: `1px solid ${COLORS.border}`,
      }}
    >
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
        background: 'linear-gradient(160deg,rgba(139,92,246,.16),rgba(47,226,138,.08) 60%,rgba(8,10,14,.5))',
        border: '1px dashed rgba(47,226,138,.45)', color: COLORS.text,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg,#8b5cf6,#2fe28a)', boxShadow: '0 10px 30px -8px rgba(47,226,138,.7),inset 0 1px 0 rgba(255,255,255,.4)' }}>
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

function OwnInventory() {
  const { cards, loading, refresh } = useCollectorCryptNfts()
  const [selected, setSelected] = useState<OwnedCard | null>(null)
  const grid = useGridStyle()

  return (
    <div style={{ animation: 'ba-tabin .25s ease-out' }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '.2em', color: COLORS.muted, marginBottom: 14 }}>
        YOUR WALLET · <span style={{ color: COLORS.text }}>{cards.length} CARDS</span>{loading && <span style={{ color: COLORS.muted }}> · loading…</span>}
      </div>
      <div style={grid}>
        <OpenPacksTile />
        {cards.map((c) => <CardTile key={`${c.source}-${c.mint}`} card={c} onClick={() => setSelected(c)} />)}
      </div>
      {selected && <InventoryCardModal card={selected} onClose={() => setSelected(null)} onSold={() => refresh()} />}
    </div>
  )
}
