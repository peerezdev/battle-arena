import { motion } from 'framer-motion'
import { COLORS, FONTS, RARITY, SHADOW, GRADIENT, formatUsd } from '../../theme'
import { useReducedMotion } from '../../useReducedMotion'
import type { GachaMachine } from '../../../onchain/gachaClient'

interface Props {
  machine: GachaMachine
  onOpen: () => void
  /** True when identityToken is null (not authenticated) */
  disabled: boolean
}

const RARITY_ORDER = ['epic', 'rare', 'uncommon', 'common'] as const
const RARITY_COLOR: Record<string, string> = {
  Epic: RARITY.epic,   epic: RARITY.epic,
  Rare: RARITY.rare,   rare: RARITY.rare,
  Uncommon: RARITY.uncommon, uncommon: RARITY.uncommon,
  Common: RARITY.common, common: RARITY.common,
}

export function MachineDetailPanel({ machine, onOpen, disabled }: Props) {
  const reduced = useReducedMotion()

  // Sort odds with the canonical order; unknown rarities go last
  const oddsEntries = Object.entries(machine.odds ?? {}).sort(([a], [b]) => {
    const ia = RARITY_ORDER.indexOf(a.toLowerCase() as typeof RARITY_ORDER[number])
    const ib = RARITY_ORDER.indexOf(b.toLowerCase() as typeof RARITY_ORDER[number])
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })

  const totalOdds = oddsEntries.reduce((sum, [, v]) => sum + (v ?? 0), 0)

  return (
    <div
      style={{
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 14,
        padding: '24px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}
    >
      {/* Pack image */}
      <div
        style={{
          width: '100%',
          aspectRatio: '1/1',
          background: COLORS.panel2,
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          border: `1px solid ${COLORS.border}`,
        }}
      >
        {machine.videoSrc ? (
          <video
            poster={machine.thumbnailUrl ?? machine.image ?? undefined}
            autoPlay
            loop
            muted
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 10 }}
          >
            <source src={machine.videoSrc} type="video/webm" />
            {machine.videoHevc && <source src={machine.videoHevc} type="video/mp4" />}
          </video>
        ) : machine.thumbnailUrl || machine.image ? (
          <img
            src={(machine.thumbnailUrl ?? machine.image)!}
            alt={machine.name}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        ) : (
          <span style={{ fontSize: 64 }}>🎰</span>
        )}
      </div>

      {/* Pack name */}
      <div>
        <div
          style={{
            fontFamily: FONTS.display,
            fontWeight: 800,
            fontSize: 20,
            color: COLORS.text,
            marginBottom: 4,
          }}
        >
          {machine.name}
        </div>
        {machine.shortName && (
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 11,
              color: COLORS.muted,
              letterSpacing: '.06em',
            }}
          >
            {machine.shortName}
          </div>
        )}
      </div>

      {/* EV + Price */}
      <div style={{ display: 'flex', gap: 14 }}>
        <div
          style={{
            flex: 1,
            background: COLORS.panel2,
            borderRadius: 10,
            padding: '12px 14px',
            border: `1px solid ${COLORS.border}`,
          }}
        >
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 10,
              color: COLORS.muted,
              letterSpacing: '.07em',
              marginBottom: 4,
              textTransform: 'uppercase',
            }}
          >
            EXPECTED VALUE
          </div>
          <div
            style={{
              fontFamily: FONTS.display,
              fontWeight: 800,
              fontSize: 18,
              color: COLORS.green,
            }}
          >
            {machine.ev != null ? `$${machine.ev.toFixed(2)}` : '—'}
          </div>
        </div>
        <div
          style={{
            flex: 1,
            background: COLORS.panel2,
            borderRadius: 10,
            padding: '12px 14px',
            border: `1px solid ${COLORS.border}`,
          }}
        >
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 10,
              color: COLORS.muted,
              letterSpacing: '.07em',
              marginBottom: 4,
              textTransform: 'uppercase',
            }}
          >
            PRICE
          </div>
          <div
            style={{
              fontFamily: FONTS.display,
              fontWeight: 800,
              fontSize: 18,
              color: COLORS.text,
            }}
          >
            {formatUsd(machine.price)} USDC
          </div>
        </div>
      </div>

      {/* OPEN NOW button */}
      <motion.button
        onClick={onOpen}
        disabled={disabled}
        whileTap={reduced || disabled ? undefined : { scale: 0.97 }}
        style={{
          width: '100%',
          background: disabled ? COLORS.panel2 : GRADIENT,
          color: disabled ? COLORS.muted : '#06120c',
          border: disabled ? `1px solid ${COLORS.border}` : 'none',
          borderRadius: 12,
          padding: '16px 20px',
          fontSize: 15,
          fontWeight: 800,
          fontFamily: FONTS.display,
          cursor: disabled ? 'not-allowed' : 'pointer',
          letterSpacing: '.03em',
          boxShadow: disabled ? 'none' : SHADOW.glow(COLORS.green),
          transition: 'background 0.2s',
        }}
      >
        {disabled ? 'Log in to open' : `OPEN NOW · ${formatUsd(machine.price)}`}
      </motion.button>

      {/* Contains + Buyback meta */}
      <div
        style={{
          fontFamily: FONTS.mono,
          fontSize: 11,
          color: COLORS.muted,
          letterSpacing: '.05em',
          display: 'flex',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        {machine.contains != null && (
          <span>CONTAINS {machine.contains}</span>
        )}
        {machine.instantBuyback != null && (
          <span>BUYBACK {machine.instantBuyback}%</span>
        )}
      </div>

      {/* Odds bars */}
      {oddsEntries.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 10,
              color: COLORS.muted,
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              marginBottom: 2,
            }}
          >
            ODDS
          </div>
          {oddsEntries.map(([rarity, pct]) => {
            const accent = RARITY_COLOR[rarity] ?? COLORS.muted
            const width = totalOdds > 0 ? Math.round((pct / totalOdds) * 100) : pct
            return (
              <div key={rarity}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: 4,
                    fontFamily: FONTS.mono,
                    fontSize: 11,
                  }}
                >
                  <span style={{ color: accent, textTransform: 'capitalize', fontWeight: 700 }}>
                    {rarity.toLowerCase()}
                  </span>
                  <span style={{ color: COLORS.muted }}>{pct}%</span>
                </div>
                <div
                  style={{
                    height: 5,
                    background: COLORS.panel2,
                    borderRadius: 3,
                    overflow: 'hidden',
                    border: `1px solid ${COLORS.border}`,
                  }}
                >
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(width, 100)}%` }}
                    transition={{ duration: reduced ? 0 : 0.5, ease: 'easeOut' }}
                    style={{
                      height: '100%',
                      background: accent,
                      borderRadius: 3,
                      boxShadow: SHADOW.glow(accent),
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
