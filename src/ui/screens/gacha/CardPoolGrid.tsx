import { useState } from 'react'
import { motion } from 'framer-motion'
import { COLORS, FONTS, RARITY, SHADOW, formatUsd } from '../../theme'
import { useReducedMotion } from '../../useReducedMotion'
import type { MachineCard } from '../../../onchain/gachaClient'
import { CardDetailsModal } from './CardDetailsModal'

interface Props {
  cards: MachineCard[]
  loading: boolean
  liveCount?: number
  error?: boolean
  machineCode: string
}

const RARITY_COLOR: Record<string, string> = {
  epic: RARITY.epic,
  rare: RARITY.rare,
  uncommon: RARITY.uncommon,
  common: RARITY.common,
}

export function CardPoolGrid({ cards, loading, liveCount, error, machineCode }: Props) {
  const reduced = useReducedMotion()
  const [selected, setSelected] = useState<MachineCard | null>(null)

  const containerVariants = {
    hidden: {},
    show: { transition: { staggerChildren: reduced ? 0 : 0.04 } },
  }
  const itemVariants = {
    hidden: { opacity: 0, y: reduced ? 0 : 14 },
    show: { opacity: 1, y: 0, transition: { duration: 0.25 } },
  }

  return (
    <div>
      {/* Heading */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span
          style={{
            fontFamily: FONTS.mono,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '.08em',
            color: COLORS.muted,
            textTransform: 'uppercase',
          }}
        >
          CARDS IN THIS PACK · {cards.length}
        </span>
        {liveCount != null && (
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              color: COLORS.green,
              fontFamily: FONTS.mono,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: COLORS.green,
                boxShadow: SHADOW.glow(COLORS.green),
                display: 'inline-block',
              }}
            />
            {liveCount} live in pool
          </span>
        )}
      </div>

      {/* Loading state */}
      {loading && (
        <div
          style={{
            textAlign: 'center',
            padding: '48px 0',
            color: COLORS.muted,
            fontSize: 14,
            fontFamily: FONTS.body,
          }}
        >
          Loading cards…
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.red}`,
            borderRadius: 12,
            padding: '40px 20px',
            textAlign: 'center',
            color: COLORS.red,
            fontSize: 14,
            fontFamily: FONTS.body,
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 10 }}>⚠️</div>
          Couldn't load the card pool. Try another machine.
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && cards.length === 0 && (
        <div
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 12,
            padding: '40px 20px',
            textAlign: 'center',
            color: COLORS.muted,
            fontSize: 14,
            fontFamily: FONTS.body,
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 10 }}>🃏</div>
          No cards found in this pack.
        </div>
      )}

      {/* Grid */}
      {!loading && !error && cards.length > 0 && (
        <motion.div
          key={machineCode}
          variants={containerVariants}
          initial="hidden"
          animate="show"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
            gap: 16,
          }}
        >
          {cards.map((card, i) => {
            const rarityKey = (card.rarity ?? '').toLowerCase()
            const accent = RARITY_COLOR[rarityKey] ?? COLORS.muted
            return (
              <motion.div
                key={card.nft_address ?? i}
                variants={itemVariants}
                onClick={() => setSelected(card)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(card) } }}
                whileHover={reduced ? undefined : { y: -4, boxShadow: SHADOW.glow(accent) }}
                style={{
                  background: COLORS.panel,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 10,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  transition: 'box-shadow 0.18s',
                }}
              >
                {/* Card image — full card visible (contain) on a gradient slab */}
                <div
                  style={{
                    width: '100%',
                    aspectRatio: '3/4',
                    background: `radial-gradient(circle at 50% 35%, ${accent}1f, ${COLORS.panel2})`,
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 10,
                  }}
                >
                  {card.image ? (
                    <img
                      src={card.image}
                      alt={card.name ?? undefined}
                      style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.45))' }}
                    />
                  ) : (
                    <span style={{ fontSize: 40 }}>🃏</span>
                  )}
                </div>

                {/* Card info */}
                <div style={{ padding: '10px 10px 12px' }}>
                  {/* Rarity badge */}
                  {card.rarity && (
                    <div
                      style={{
                        display: 'inline-block',
                        fontSize: 9,
                        fontWeight: 800,
                        letterSpacing: '.08em',
                        textTransform: 'uppercase',
                        color: accent,
                        border: `1px solid ${accent}55`,
                        borderRadius: 4,
                        padding: '2px 6px',
                        marginBottom: 6,
                      }}
                    >
                      {card.rarity}
                    </div>
                  )}

                  {/* Name */}
                  <div
                    style={{
                      fontFamily: FONTS.body,
                      fontWeight: 700,
                      fontSize: 12,
                      color: COLORS.text,
                      marginBottom: 4,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={card.name ?? undefined}
                  >
                    {card.name ?? '—'}
                  </div>

                  {/* Insured value */}
                  {card.insured_value != null && (
                    <div
                      style={{
                        fontFamily: FONTS.mono,
                        fontSize: 11,
                        color: COLORS.green,
                        fontWeight: 700,
                      }}
                    >
                      {formatUsd(card.insured_value)}
                    </div>
                  )}

                  {/* Grade */}
                  {card.grade && (
                    <div
                      style={{
                        fontFamily: FONTS.mono,
                        fontSize: 10,
                        color: COLORS.muted,
                        marginTop: 2,
                      }}
                    >
                      {card.grade}
                    </div>
                  )}
                </div>
              </motion.div>
            )
          })}
        </motion.div>
      )}
      {selected && <CardDetailsModal card={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
