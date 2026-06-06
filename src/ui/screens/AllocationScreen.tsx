import { useState } from 'react'
import { FrontSlider } from '../components/FrontSlider'
import { EnergyHeader } from '../components/EnergyHeader'
import { PlayerCard } from '../components/PlayerCard'
import { AdvantageBanner } from '../components/AdvantageBanner'
import type { Allocation, MatchState } from '../../engine'
import { COLORS, player as playerTheme } from '../theme'

interface Props {
  available: number
  winsA: number
  winsB: number
  round: number
  playerLabel: string
  onCommit: (a: Allocation) => void
  /** Full match state for advantage banner and energy breakdown */
  state: MatchState
  /** Which player is allocating ('a' or 'b') */
  playerKey: 'a' | 'b'
}

export function AllocationScreen({ available, winsA, winsB, round, playerLabel, onCommit, state, playerKey }: Props) {
  const [a, setA] = useState<Allocation>({ apertura: 0, choque: 0, remate: 0 })
  const total = a.apertura + a.choque + a.remate
  const remaining = available - total
  const maxFor = (k: keyof Allocation) => a[k] + remaining

  const t = playerTheme[playerKey]
  const base = state.config.baseEnergyPerRound
  const edge = state.edgePerRound[playerKey]
  const banked = state.bankedEnergy[playerKey]

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
      <div style={{ maxWidth: '420px', margin: '0 auto', paddingTop: '24px' }}>
        {/* Round / player header */}
        <div style={{ marginBottom: '14px' }}>
          <div style={{ fontSize: '11px', color: COLORS.muted, letterSpacing: '.06em', marginBottom: '2px' }}>
            RONDA {round + 1}
          </div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: t.color }}>
            {playerLabel}
          </div>
        </div>

        {/* Player cards row */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
          <PlayerCard card={state.cardA} playerKey="a" />
          <PlayerCard card={state.cardB} playerKey="b" />
        </div>

        {/* Advantage banner */}
        <AdvantageBanner state={state} currentPlayer={playerKey} />

        {/* Energy header with breakdown */}
        <EnergyHeader
          available={available}
          unassigned={remaining}
          winsA={winsA}
          winsB={winsB}
          base={base}
          edge={edge}
          banked={banked}
          playerColor={t.color}
        />

        {/* Sliders */}
        <div
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '14px',
          }}
        >
          <FrontSlider
            label="Apertura"
            icon="⚔️"
            value={a.apertura}
            max={maxFor('apertura')}
            onChange={(v) => setA({ ...a, apertura: v })}
            accentColor={t.color}
            sliderClass={t.sliderClass}
          />
          <FrontSlider
            label="Choque"
            icon="💥"
            value={a.choque}
            max={maxFor('choque')}
            onChange={(v) => setA({ ...a, choque: v })}
            accentColor={t.color}
            sliderClass={t.sliderClass}
          />
          <FrontSlider
            label="Remate"
            icon="🎯"
            value={a.remate}
            max={maxFor('remate')}
            onChange={(v) => setA({ ...a, remate: v })}
            accentColor={t.color}
            sliderClass={t.sliderClass}
          />

          {/* Running total */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '12px',
              color: COLORS.muted,
              borderTop: `1px solid ${COLORS.border}`,
              paddingTop: '10px',
              marginTop: '4px',
            }}
          >
            <span>Total asignado</span>
            <span style={{ color: total > available ? COLORS.red : COLORS.text, fontWeight: 700 }}>
              {total} / {available}
            </span>
          </div>
        </div>

        {/* Commit button */}
        <button
          onClick={() => onCommit(a)}
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
          }}
        >
          🔒 COMMIT
        </button>
      </div>
    </div>
  )
}
