import { useState } from 'react'
import { COLORS, FONTS, formatUsd } from '../../theme'
import { useCollectorCryptNfts, type OwnedCard } from '../../../inventory/useCollectorCryptNfts'
import { InventoryCardModal } from './InventoryCardModal'

function CardTile({ card, onClick }: { card: OwnedCard; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick() }}
      style={{ width: 150, background: '#161b24', border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: 'hidden', cursor: 'pointer' }}
    >
      <div style={{ height: 190, background: '#0c1019', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {card.image ? (
          <img src={card.image} alt={card.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        ) : (
          <span style={{ fontSize: 34 }}>🃏</span>
        )}
      </div>
      <div style={{ padding: '9px 10px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {card.name}
        </div>
        {card.insuredValue != null && (
          <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 12, color: COLORS.green, marginTop: 3 }}>
            {formatUsd(card.insuredValue)}
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, cards, onSelect }: { title: string; cards: OwnedCard[]; onSelect: (c: OwnedCard) => void }) {
  if (cards.length === 0) return null
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '0.14em', color: COLORS.muted, marginBottom: 10 }}>
        {title} · {cards.length}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {cards.map((c) => (
          <CardTile key={`${c.source}-${c.mint}`} card={c} onClick={() => onSelect(c)} />
        ))}
      </div>
    </div>
  )
}

export function InventoryTab() {
  const { cards, loading, refresh } = useCollectorCryptNfts()
  const [selected, setSelected] = useState<OwnedCard | null>(null)
  const embedded = cards.filter((c) => c.source === 'embedded')
  const connected = cards.filter((c) => c.source === 'connected')

  if (loading) {
    return <div style={{ color: COLORS.muted, fontFamily: FONTS.body, fontSize: 14 }}>Loading your cards…</div>
  }
  if (cards.length === 0) {
    return (
      <div style={{ color: COLORS.muted, fontFamily: FONTS.body, fontSize: 14, lineHeight: 1.5 }}>
        No Collector Crypt cards found in your wallets yet.
        <br />
        Open packs in the Gacha, or connect a wallet that holds CC cards.
      </div>
    )
  }
  return (
    <div>
      <Section title="EMBEDDED WALLET" cards={embedded} onSelect={setSelected} />
      <Section title="CONNECTED WALLET" cards={connected} onSelect={setSelected} />
      {selected && (
        <InventoryCardModal
          card={selected}
          onClose={() => setSelected(null)}
          onSold={() => { refresh(); setSelected(null) }}
        />
      )}
    </div>
  )
}
