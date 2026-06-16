import { useState } from 'react'
import { TIERS } from '../../../royale/pulls'
import type { RoyaleConfig } from '../../../royale/types'
import { COLORS, FONTS } from '../../theme'

interface Props {
  onStart: (config: RoyaleConfig) => void
  onBack: () => void
}

const S = {
  label: {
    display: 'block',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '.05em',
    color: COLORS.muted,
    marginBottom: '4px',
    textTransform: 'uppercase' as const,
  },
}

export function RoyaleSetupScreen({ onStart, onBack }: Props) {
  const [numPlayers, setNumPlayers] = useState(4)
  const [tierIdx, setTierIdx] = useState(0)

  const tier = TIERS[tierIdx]
  const canDecrease = numPlayers > 2
  const canIncrease = numPlayers < 10

  function handleStart() {
    onStart({ numPlayers, tier })
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily: 'Inter, system-ui, sans-serif',
        padding: '0 16px 32px',
      }}
    >
      <div style={{ maxWidth: '420px', margin: '0 auto', paddingTop: '32px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div
            style={{
              fontSize: '28px',
              fontWeight: 800,
              letterSpacing: '-0.5px',
              color: COLORS.green,
              fontFamily: FONTS.display,
            }}
          >
            🏆 Battle Royale
          </div>
          <div
            style={{
              fontSize: '12px',
              color: COLORS.muted,
              marginTop: '4px',
              fontFamily: FONTS.mono,
            }}
          >
            Último en pie se lleva el bote
          </div>
        </div>

        {/* Panel */}
        <div
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: '8px',
            padding: '20px',
          }}
        >
          {/* Número de jugadores */}
          <label style={S.label}>Jugadores</label>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              marginBottom: '20px',
            }}
          >
            <button
              type="button"
              onClick={() => setNumPlayers((n) => Math.max(2, n - 1))}
              disabled={!canDecrease}
              aria-label="Reducir jugadores"
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '8px',
                background: canDecrease ? `${COLORS.green}1a` : COLORS.bg,
                border: `1px solid ${canDecrease ? `${COLORS.green}55` : COLORS.border}`,
                color: canDecrease ? COLORS.green : COLORS.muted,
                fontSize: '22px',
                fontWeight: 700,
                cursor: canDecrease ? 'pointer' : 'default',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'border-color .15s, background .15s',
              }}
            >
              −
            </button>
            <div
              style={{
                flex: 1,
                textAlign: 'center',
                fontSize: '32px',
                fontWeight: 800,
                fontFamily: FONTS.display,
                color: COLORS.green,
                lineHeight: 1,
              }}
              aria-live="polite"
              aria-label={`${numPlayers} jugadores`}
            >
              {numPlayers}
              <span
                style={{
                  display: 'block',
                  fontSize: '11px',
                  fontWeight: 400,
                  fontFamily: FONTS.mono,
                  color: COLORS.muted,
                  marginTop: '2px',
                  letterSpacing: '.04em',
                }}
              >
                jugadores (2–10)
              </span>
            </div>
            <button
              type="button"
              onClick={() => setNumPlayers((n) => Math.min(10, n + 1))}
              disabled={!canIncrease}
              aria-label="Aumentar jugadores"
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '8px',
                background: canIncrease ? `${COLORS.green}1a` : COLORS.bg,
                border: `1px solid ${canIncrease ? `${COLORS.green}55` : COLORS.border}`,
                color: canIncrease ? COLORS.green : COLORS.muted,
                fontSize: '22px',
                fontWeight: 700,
                cursor: canIncrease ? 'pointer' : 'default',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'border-color .15s, background .15s',
              }}
            >
              +
            </button>
          </div>

          {/* Tier */}
          <label style={S.label}>Pack</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
            {TIERS.map((t, i) => {
              const selected = i === tierIdx
              return (
                <button
                  key={t.code}
                  type="button"
                  onClick={() => setTierIdx(i)}
                  aria-pressed={selected}
                  style={{
                    background: selected ? `${COLORS.green}14` : COLORS.bg,
                    border: `1px solid ${selected ? `${COLORS.green}66` : COLORS.border}`,
                    borderRadius: '8px',
                    padding: '12px 14px',
                    color: COLORS.text,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'border-color .15s, background .15s',
                    boxShadow: selected ? `0 0 8px ${COLORS.green}22` : 'none',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      marginBottom: '4px',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '14px',
                        fontWeight: 700,
                        color: selected ? COLORS.green : COLORS.text,
                        fontFamily: FONTS.mono,
                      }}
                    >
                      {t.name}
                    </span>
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: 800,
                        fontFamily: FONTS.display,
                        color: selected ? COLORS.green : COLORS.muted,
                      }}
                    >
                      {t.price} USDC
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: '11px',
                      color: COLORS.muted,
                      fontFamily: FONTS.mono,
                      letterSpacing: '.03em',
                    }}
                  >
                    common {t.odds.common}% · uncommon {t.odds.uncommon}% · rare {t.odds.rare}% · epic{' '}
                    {t.odds.epic}%
                  </div>
                </button>
              )
            })}
          </div>

          {/* Resumen del bote estimado */}
          <div
            style={{
              background: COLORS.bg,
              border: `1px solid ${COLORS.border}`,
              borderRadius: '6px',
              padding: '10px 12px',
              marginBottom: '20px',
              fontSize: '12px',
              color: COLORS.muted,
              fontFamily: FONTS.mono,
            }}
          >
            Bote estimado: <strong style={{ color: COLORS.text }}>
              {numPlayers} × {tier.price} USDC en cartas por ronda
            </strong>{' '}
            — el ganador se lo lleva todo.
          </div>

          {/* Botón empezar */}
          <button
            type="button"
            onClick={handleStart}
            style={{
              width: '100%',
              background: COLORS.green,
              color: '#04130c',
              border: 'none',
              borderRadius: '6px',
              padding: '14px',
              fontSize: '15px',
              fontWeight: 800,
              cursor: 'pointer',
              letterSpacing: '.03em',
              boxShadow: '0 0 12px #34e29b55',
              transition: 'box-shadow 0.2s',
              marginBottom: '12px',
            }}
          >
            🏆 Empezar
          </button>

          {/* Volver */}
          <button
            type="button"
            onClick={onBack}
            style={{
              width: '100%',
              background: 'transparent',
              color: COLORS.muted,
              border: `1px solid ${COLORS.border}`,
              borderRadius: '6px',
              padding: '10px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              letterSpacing: '.02em',
            }}
          >
            ← Volver
          </button>
        </div>
      </div>
    </div>
  )
}
