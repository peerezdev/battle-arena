import { useState } from 'react'
import { motion } from 'framer-motion'
import { EnergyHeader } from '../components/EnergyHeader'
import { PlayerCard } from '../components/PlayerCard'
import { AdvantageBanner } from '../components/AdvantageBanner'
import { EnergyAllocator } from '../components/EnergyAllocator'
import { ArenaBackdrop } from '../components/ArenaBackdrop'
import type { Allocation, MatchState } from '../../engine'
import { COLORS, player as playerTheme, FONTS } from '../theme'
import { useReducedMotion } from '../useReducedMotion'
import { playSfx, haptic } from '../sound'

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

/** Apply a delta to one key of an Allocation, clamping each field ≥ 0 and sum ≤ available. */
function clampApply(prev: Allocation, key: keyof Allocation, delta: number, available: number): Allocation {
  const next = Math.max(0, prev[key] + delta)
  const others = (Object.keys(prev) as (keyof Allocation)[])
    .filter(k => k !== key)
    .reduce((s, k) => s + prev[k], 0)
  const clamped = Math.min(next, available - others)
  return { ...prev, [key]: clamped }
}

export function AllocationScreen({ available, winsA, winsB, round, playerLabel, onCommit, state, playerKey }: Props) {
  const [a, setA] = useState<Allocation>({ apertura: 0, choque: 0, remate: 0 })
  const [committing, setCommitting] = useState(false)
  const reduced = useReducedMotion()

  const total = a.apertura + a.choque + a.remate
  const remaining = available - total

  const t = playerTheme[playerKey]
  const base = state.config.baseEnergyPerRound
  const edge = state.edgePerRound[playerKey]
  const banked = state.bankedEnergy[playerKey]

  function handleCommit() {
    if (committing) return
    setCommitting(true)
    playSfx('commit')
    haptic([12, 30, 12])
    const delay = reduced ? 0 : 260
    setTimeout(() => onCommit(a), delay)
  }

  return (
    <ArenaBackdrop
      reducedMotion={reduced}
      accentA={playerKey === 'a' ? COLORS.green : COLORS.red}
      accentB={playerKey === 'a' ? COLORS.red : COLORS.green}
    >
      <div
        style={{
          color: COLORS.text,
          fontFamily: 'Inter, system-ui, sans-serif',
          padding: '0 16px 32px',
        }}
      >
        <div style={{ maxWidth: '420px', margin: '0 auto', paddingTop: '24px' }}>
          {/* Round / player header */}
          <div style={{ marginBottom: '14px' }}>
            <div style={{ fontSize: '11px', color: COLORS.muted, letterSpacing: '.06em', marginBottom: '2px', fontFamily: FONTS.mono }}>
              RONDA {round + 1}
            </div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: t.color, fontFamily: FONTS.orbitron }}>
              {playerLabel}
            </div>
          </div>

          {/* Player cards row */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
            <PlayerCard card={state.cardA} playerKey="a" sheen={!reduced} />
            <PlayerCard card={state.cardB} playerKey="b" sheen={!reduced} />
          </div>

          {/* Advantage banner */}
          <AdvantageBanner state={state} currentPlayer={playerKey} />

          {/* Energy header with breakdown (base + edge + banked) */}
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

          {/* Tap-to-allocate energy tokens */}
          <EnergyAllocator
            alloc={a}
            available={available}
            onChange={(key, delta) => setA(prev => clampApply(prev, key, delta, available))}
            accentColor={t.color}
            reducedMotion={reduced}
            disabled={committing}
          />

          {/* Commit button — disabled once committing to prevent double-submit. */}
          <motion.button
            onClick={handleCommit}
            disabled={committing}
            aria-disabled={committing}
            whileTap={reduced ? undefined : { scale: 0.96 }}
            animate={committing && !reduced ? { scale: [1, 1.04, 1] } : undefined}
            transition={{ duration: 0.26 }}
            aria-label="Confirmar asignación de energía"
            style={{
              width: '100%',
              background: t.color,
              color: playerKey === 'a' ? '#04130c' : '#1a040a',
              border: 'none',
              borderRadius: '10px',
              padding: '16px',
              fontSize: '16px',
              fontWeight: 800,
              fontFamily: FONTS.orbitron,
              cursor: committing ? 'default' : 'pointer',
              letterSpacing: '.03em',
              boxShadow: `0 0 14px ${t.color}66`,
              minHeight: '52px',
              opacity: committing ? 0.7 : 1,
              pointerEvents: committing ? 'none' : undefined,
            }}
          >
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '6px', marginBottom: '2px' }}
            >
              {/* Shackle arc */}
              <path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2" />
              {/* Lock body */}
              <rect x="2.5" y="7" width="11" height="8" rx="2" />
              {/* Keyhole dot */}
              <circle cx="8" cy="11.5" r="1" fill="currentColor" stroke="none" />
            </svg>
            COMMIT · {total} asignada{remaining > 0 ? ` · ${remaining} se banca` : ''}
          </motion.button>
        </div>
      </div>
    </ArenaBackdrop>
  )
}
