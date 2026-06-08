/**
 * BattleBoard — Hearthstone-style responsive battle board.
 *
 * Phases:
 *  - 'allocate': local player places troops on their 3 front columns.
 *    Opponent's fronts are hidden face-down.
 *  - 'reveal': both sides shown; front winners highlighted with
 *    a stagger animation (skipped when reduced-motion).
 *
 * Responsive layout:
 *  Mobile (<768 / default): compact — 3 front columns, opponent above,
 *    your zone below. No horizontal overflow at 375px.
 *  Desktop (≥768 md:): same structure, generous gaps, max-width 900px.
 *
 * Privacy invariant: opponent banked/reserve is NEVER shown as a number.
 *  A lock icon + "oculto" is shown instead.
 */

import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Allocation, FrontKey, FrontWinner, MatchState } from '../../engine'
import { solidez, availableEnergy } from '../../engine'
import { COLORS, player as playerTheme, FONTS } from '../theme'
import { useReducedMotion } from '../useReducedMotion'
import { FrontSigil } from './FrontSigil'
import { ArenaBackdrop } from './ArenaBackdrop'
import { playSfx, haptic } from '../sound'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type BoardPhase = 'allocate' | 'reveal'

interface AllocateProps {
  phase: 'allocate'
  playerKey: 'a' | 'b'
  playerLabel: string
  onCommit: (a: Allocation) => void
}

interface RevealProps {
  phase: 'reveal'
  allocA: Allocation
  allocB: Allocation
  frontWinners: Record<FrontKey, FrontWinner>
  roundWinner: FrontWinner
  onContinue: () => void
}

export type BattleBoardProps = {
  state: MatchState
} & (AllocateProps | RevealProps)

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const FRONT_KEYS: FrontKey[] = ['apertura', 'choque', 'remate']
const FRONT_LABELS: Record<FrontKey, string> = {
  apertura: 'Apertura',
  choque: 'Choque',
  remate: 'Remate',
}
const STAGGER_MS = 700

/** Clamp-apply a delta to one Allocation key, sum ≤ available. */
function clampApply(
  prev: Allocation,
  key: FrontKey,
  delta: number,
  available: number,
): Allocation {
  const next = Math.max(0, prev[key] + delta)
  const others = FRONT_KEYS.filter((k) => k !== key).reduce((s, k) => s + prev[k], 0)
  return { ...prev, [key]: Math.min(next, available - others) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Presentational sub-components (stateless)
// ─────────────────────────────────────────────────────────────────────────────

/** Small glowing energy orb token. */
function EnergyOrb({
  color,
  reduced,
  size = 13,
}: {
  color: string
  reduced: boolean
  size?: number
}) {
  return (
    <span
      style={
        {
          '--orb-color': color,
          width: size,
          height: size,
          borderRadius: '50%',
          background: `radial-gradient(circle at 38% 36%, ${color}ee 0%, ${color}88 55%, ${color}44 100%)`,
          boxShadow: `0 0 5px ${color}, 0 0 10px ${color}44`,
          display: 'inline-block',
          flexShrink: 0,
          animation: reduced ? 'none' : 'orb-pulse 2.2s ease-in-out infinite',
        } as React.CSSProperties
      }
      aria-hidden="true"
    />
  )
}

/** Circular hero portrait: initials + name + win pips. */
function HeroPortrait({
  name,
  accentColor,
  winsCount,
  winsNeeded,
  reduced,
}: {
  name: string
  accentColor: string
  winsCount: number
  winsNeeded: number
  reduced: boolean
}) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '3px',
        flexShrink: 0,
      }}
    >
      {/* Circle */}
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          background: `radial-gradient(circle at 40% 38%, ${accentColor}33, #0a0e1a 80%)`,
          border: `2px solid ${accentColor}88`,
          boxShadow: reduced ? 'none' : `0 0 10px ${accentColor}44`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: FONTS.orbitron,
          fontWeight: 800,
          fontSize: '14px',
          color: accentColor,
          flexShrink: 0,
        }}
      >
        {initials}
      </div>
      {/* Name */}
      <span
        style={{
          fontSize: '8px',
          color: COLORS.muted,
          fontFamily: FONTS.mono,
          letterSpacing: '.03em',
          maxWidth: 54,
          textAlign: 'center',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>
      {/* Win pips */}
      <div style={{ display: 'flex', gap: '3px' }}>
        {Array.from({ length: winsNeeded }, (_, i) => (
          <span
            key={i}
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: i < winsCount ? accentColor : COLORS.border,
              boxShadow: i < winsCount && !reduced ? `0 0 4px ${accentColor}` : 'none',
              display: 'inline-block',
            }}
          />
        ))}
      </div>
    </div>
  )
}

/** Your mana crystal strip: number + orb row + breakdown. */
function ManaCrystals({
  available,
  base,
  edge,
  banked,
  accentColor,
  reduced,
}: {
  available: number
  base: number
  edge: number
  banked: number
  accentColor: string
  reduced: boolean
}) {
  const parts: string[] = []
  if (base > 0) parts.push(`${base}b`)
  if (edge > 0) parts.push(`+${edge}e`)
  if (banked > 0) parts.push(`+${banked}bk`)

  return (
    <div
      style={{
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderRadius: '8px',
        padding: '5px 8px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}
    >
      <div>
        <div
          style={{
            fontSize: '8px',
            color: COLORS.muted,
            fontFamily: FONTS.mono,
            letterSpacing: '.05em',
            marginBottom: '2px',
          }}
        >
          MANÁ
        </div>
        <div
          style={{
            fontSize: '20px',
            fontWeight: 800,
            fontFamily: FONTS.orbitron,
            color: accentColor,
            lineHeight: 1,
          }}
        >
          {available}
        </div>
        {parts.length > 0 && (
          <div
            style={{
              fontSize: '8px',
              color: COLORS.muted,
              fontFamily: FONTS.mono,
              marginTop: '1px',
            }}
          >
            {parts.join(' ')}
          </div>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '3px',
          maxWidth: 88,
        }}
      >
        {Array.from({ length: Math.min(available, 12) }, (_, i) => (
          <EnergyOrb key={i} color={accentColor} reduced={reduced} size={11} />
        ))}
        {available > 12 && (
          <span
            style={{
              fontSize: '9px',
              color: COLORS.muted,
              fontFamily: FONTS.mono,
              alignSelf: 'center',
            }}
          >
            +{available - 12}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Opponent reserve — always hidden (hard privacy requirement).
 * Shows a lock icon + "oculto", never a number.
 */
function OpponentReserve() {
  return (
    <div
      style={{
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderRadius: '8px',
        padding: '5px 8px',
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
      }}
      aria-label="Reserva del rival: oculta"
    >
      {/* Lock SVG */}
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        stroke={COLORS.muted}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2" />
        <rect x="2.5" y="7" width="11" height="8" rx="2" />
        <circle cx="8" cy="11.5" r="1" fill={COLORS.muted} stroke="none" />
      </svg>
      <div>
        <div
          style={{
            fontSize: '8px',
            color: COLORS.muted,
            fontFamily: FONTS.mono,
            letterSpacing: '.04em',
          }}
        >
          MANÁ
        </div>
        <div
          style={{
            fontSize: '10px',
            color: COLORS.muted,
            fontFamily: FONTS.mono,
            fontStyle: 'italic',
          }}
        >
          oculto
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FrontColumn: one column per front (apertura / choque / remate)
// ─────────────────────────────────────────────────────────────────────────────

interface FrontColumnAllocateProps {
  mode: 'allocate'
  frontKey: FrontKey
  allocValue: number
  availablePool: number
  disabled: boolean
  onAdd: () => void
  onRemove: () => void
  accentColor: string
  reduced: boolean
}

interface FrontColumnRevealProps {
  mode: 'reveal'
  frontKey: FrontKey
  allocA: number
  allocB: number
  winner: FrontWinner
  nameA: string
  nameB: string
  aguanteNote: string | null
  isRevealed: boolean
  reduced: boolean
}

type FrontColumnProps = FrontColumnAllocateProps | FrontColumnRevealProps

function FrontColumn(props: FrontColumnProps) {
  const label = FRONT_LABELS[props.frontKey]

  if (props.mode === 'reveal') {
    const { allocA, allocB, winner, nameA, nameB, aguanteNote, isRevealed, reduced } = props
    const displayWinner: FrontWinner = isRevealed ? winner : 'disputed'
    const winColor =
      displayWinner === 'a'
        ? COLORS.green
        : displayWinner === 'b'
        ? COLORS.red
        : COLORS.muted
    const winLabel =
      displayWinner === 'a' ? nameA : displayWinner === 'b' ? nameB : '—'

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '3px',
          flex: 1,
          minWidth: 0,
        }}
      >
        {/* Opponent value (top) */}
        <div
          style={{
            background:
              isRevealed && winner === 'b'
                ? `linear-gradient(180deg, ${COLORS.red}22, ${COLORS.panel})`
                : COLORS.panel,
            border: `1px solid ${isRevealed && winner === 'b' ? `${COLORS.red}55` : COLORS.border}`,
            borderRadius: '8px',
            padding: '6px 4px',
            width: '100%',
            textAlign: 'center',
            transition: 'border-color .2s, background .2s',
          }}
        >
          <span
            style={{
              fontSize: '20px',
              fontWeight: isRevealed && winner === 'b' ? 800 : 400,
              fontFamily: FONTS.orbitron,
              color: isRevealed && winner === 'b' ? COLORS.red : COLORS.text,
            }}
          >
            {isRevealed ? allocB : '?'}
          </span>
        </div>

        {/* Front sigil + winner label divider */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1px',
            padding: '3px 0',
          }}
        >
          <FrontSigil
            front={props.frontKey}
            color={winColor}
            size={18}
            glow={isRevealed && winner !== 'disputed' && !reduced}
          />
          <span
            style={{
              fontSize: '8px',
              color: COLORS.muted,
              fontFamily: FONTS.mono,
              letterSpacing: '.04em',
            }}
          >
            {label}
          </span>
          {isRevealed && (
            <span
              style={{
                fontSize: '8px',
                fontWeight: 700,
                color: winColor,
                fontFamily: FONTS.mono,
              }}
            >
              {displayWinner === 'disputed' ? 'Emp.' : winLabel}
            </span>
          )}
          {aguanteNote && isRevealed && (
            <span
              style={{
                fontSize: '7px',
                color: COLORS.muted,
                fontFamily: FONTS.mono,
                fontStyle: 'italic',
                textAlign: 'center',
                maxWidth: 72,
                lineHeight: 1.2,
              }}
            >
              Sol.
            </span>
          )}
        </div>

        {/* Your (A) value (bottom) */}
        <div
          style={{
            background:
              isRevealed && winner === 'a'
                ? `linear-gradient(0deg, ${COLORS.green}22, ${COLORS.panel})`
                : COLORS.panel,
            border: `1px solid ${isRevealed && winner === 'a' ? `${COLORS.green}55` : COLORS.border}`,
            borderRadius: '8px',
            padding: '6px 4px',
            width: '100%',
            textAlign: 'center',
            transition: 'border-color .2s, background .2s',
          }}
        >
          <span
            style={{
              fontSize: '20px',
              fontWeight: isRevealed && winner === 'a' ? 800 : 400,
              fontFamily: FONTS.orbitron,
              color: isRevealed && winner === 'a' ? COLORS.green : COLORS.text,
            }}
          >
            {allocA}
          </span>
        </div>
      </div>
    )
  }

  // ── Allocate mode ───────────────────────────────────────────────────────────
  const { allocValue, availablePool, disabled, onAdd, onRemove, accentColor, reduced } = props
  const hasAlloc = allocValue > 0
  const disabledAdd = disabled || availablePool <= 0
  const disabledRemove = disabled || allocValue <= 0
  const frontAccent = hasAlloc ? accentColor : COLORS.muted

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '3px',
        flex: 1,
        minWidth: 0,
      }}
    >
      {/* Opponent face-down placeholder */}
      <div
        style={{
          background: 'linear-gradient(135deg,#16213d,#0d1326)',
          border: `1px solid ${COLORS.border}`,
          borderRadius: '8px',
          padding: '8px 4px',
          width: '100%',
          textAlign: 'center',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '46px',
          color: COLORS.muted,
          fontSize: '13px',
          letterSpacing: '.3em',
        }}
        aria-label="Zona del rival — oculta"
      >
        ···
      </div>

      {/* Front sigil divider */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1px',
          padding: '2px 0',
        }}
      >
        <FrontSigil
          front={props.frontKey}
          color={frontAccent}
          size={16}
          glow={hasAlloc && !reduced}
        />
        <span
          style={{
            fontSize: '8px',
            color: COLORS.muted,
            fontFamily: FONTS.mono,
            letterSpacing: '.04em',
          }}
        >
          {label}
        </span>
      </div>

      {/* Your troop zone — tappable big area + minus */}
      <div
        style={{
          background: COLORS.panel,
          border: `1px solid ${hasAlloc ? `${accentColor}66` : COLORS.border}`,
          borderRadius: '8px',
          padding: '6px 4px',
          width: '100%',
          transition: 'border-color .15s, box-shadow .15s',
          boxShadow: hasAlloc ? `0 0 10px ${accentColor}22` : 'none',
        }}
      >
        {/* Big tap-to-add area */}
        <button
          type="button"
          onClick={onAdd}
          disabled={disabledAdd}
          aria-disabled={disabledAdd || undefined}
          aria-label={`Añadir 1 energía a ${label}`}
          style={{
            width: '100%',
            background: 'transparent',
            border: 'none',
            cursor: disabledAdd ? 'default' : 'pointer',
            opacity: disabledAdd ? 0.5 : 1,
            padding: '3px 0 1px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '3px',
            minHeight: '44px',
          }}
        >
          {/* Orbs stacked in troop zone */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '2px',
              justifyContent: 'center',
              minHeight: '13px',
            }}
          >
            <AnimatePresence>
              {allocValue > 0 &&
                Array.from({ length: Math.min(allocValue, 6) }, (_, i) => (
                  <motion.span
                    key={`${props.frontKey}-orb-${i}`}
                    initial={reduced ? false : { scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={reduced ? undefined : { scale: 0, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 600, damping: 34 }}
                    style={{ display: 'inline-flex' }}
                  >
                    <EnergyOrb color={accentColor} reduced={reduced} size={11} />
                  </motion.span>
                ))}
              {allocValue > 6 && (
                <span
                  style={{
                    fontSize: '8px',
                    color: accentColor,
                    fontFamily: FONTS.mono,
                    alignSelf: 'center',
                  }}
                >
                  +{allocValue - 6}
                </span>
              )}
            </AnimatePresence>
          </div>

          {/* Big amount number */}
          <motion.span
            key={allocValue}
            initial={reduced ? false : { scale: 1.35 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 18 }}
            aria-live="polite"
            style={{
              fontSize: '24px',
              fontWeight: 800,
              fontFamily: FONTS.orbitron,
              color: hasAlloc ? accentColor : COLORS.muted,
              lineHeight: 1,
            }}
          >
            {allocValue}
          </motion.span>
        </button>

        {/* Minus control */}
        <button
          type="button"
          onClick={onRemove}
          disabled={disabledRemove}
          aria-disabled={disabledRemove || undefined}
          aria-label={`Quitar 1 energía de ${label}`}
          style={{
            width: '100%',
            background: COLORS.bg,
            border: `1px solid ${COLORS.border}`,
            color: disabledRemove ? COLORS.border : COLORS.text,
            borderRadius: '6px',
            fontSize: '16px',
            fontWeight: 700,
            cursor: disabledRemove ? 'default' : 'pointer',
            padding: '3px',
            minHeight: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: '3px',
          }}
        >
          −
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// BattleBoard — main export
// ─────────────────────────────────────────────────────────────────────────────

export function BattleBoard(props: BattleBoardProps) {
  const { state } = props
  const reduced = useReducedMotion()

  // ── Allocation state (only used in allocate phase) ─────────────────────────
  const [alloc, setAlloc] = useState<Allocation>({ apertura: 0, choque: 0, remate: 0 })
  const [committing, setCommitting] = useState(false)

  // ── Reveal stagger state ───────────────────────────────────────────────────
  // Initialise to fully-revealed instantly under reduced-motion or in allocate
  // phase (where it's not used); this avoids a flash on first render.
  const isReveal = props.phase === 'reveal'
  const [revealedFronts, setRevealedFronts] = useState<number>(
    isReveal && reduced ? FRONT_KEYS.length : 0,
  )
  const [showRoundBanner, setShowRoundBanner] = useState<boolean>(
    isReveal && reduced,
  )

  // Fire reveal stagger on mount (only when phase === 'reveal' with motion).
  useEffect(() => {
    if (!isReveal) return
    if (reduced) {
      setRevealedFronts(FRONT_KEYS.length)
      setShowRoundBanner(true)
      return
    }
    const timers: ReturnType<typeof setTimeout>[] = []
    FRONT_KEYS.forEach((_, i) => {
      timers.push(
        setTimeout(() => {
          setRevealedFronts((n) => Math.max(n, i + 1))
          playSfx('reveal')
          haptic(10)
        }, 350 + i * STAGGER_MS),
      )
    })
    timers.push(
      setTimeout(() => {
        setShowRoundBanner(true)
        if (props.phase === 'reveal') {
          playSfx(props.roundWinner === 'disputed' ? 'tick' : 'win')
          if (props.roundWinner !== 'disputed') haptic([15, 40, 15])
        }
      }, 350 + FRONT_KEYS.length * STAGGER_MS),
    )
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Derived values ─────────────────────────────────────────────────────────
  const playerKey: 'a' | 'b' = props.phase === 'allocate' ? props.playerKey : 'a'
  const opponentKey: 'a' | 'b' = playerKey === 'a' ? 'b' : 'a'
  const accentColor = playerTheme[playerKey].color
  const opponentAccent = playerTheme[opponentKey].color

  const available = availableEnergy(state, playerKey)
  const spent = alloc.apertura + alloc.choque + alloc.remate
  const pool = available - spent

  const base = state.config.baseEnergyPerRound
  const edge = state.edgePerRound[playerKey]
  const banked = state.bankedEnergy[playerKey]

  const myCard = playerKey === 'a' ? state.cardA : state.cardB
  const oppCard = playerKey === 'a' ? state.cardB : state.cardA

  const roundsToWin = state.config.roundsToWin
  const myWins = state.roundWins[playerKey]
  const oppWins = state.roundWins[opponentKey]
  const nameA = state.cardA.name
  const nameB = state.cardB.name

  // ── Commit handler ─────────────────────────────────────────────────────────
  function handleCommit() {
    if (committing || props.phase !== 'allocate') return
    setCommitting(true)
    playSfx('commit')
    haptic([12, 30, 12])
    const delay = reduced ? 0 : 260
    setTimeout(() => props.onCommit(alloc), delay)
  }

  // ── Reveal helpers ─────────────────────────────────────────────────────────
  function aguanteNote(frontKey: FrontKey): string | null {
    if (props.phase !== 'reveal') return null
    const aVal = props.allocA[frontKey]
    const bVal = props.allocB[frontKey]
    const winner = props.frontWinners[frontKey]
    if (aVal === bVal && winner !== 'disputed') {
      const solA = solidez(state.cardA)
      const solB = solidez(state.cardB)
      const winnerSol = winner === 'a' ? solA : solB
      const loserSol = winner === 'a' ? solB : solA
      const winName = winner === 'a' ? nameA : nameB
      return `Aguante: ${winName} gana por Solidez ${winnerSol} vs ${loserSol}`
    }
    return null
  }

  // Round winner display values (reveal only)
  const roundWinColor =
    props.phase === 'reveal'
      ? props.roundWinner === 'a'
        ? COLORS.green
        : props.roundWinner === 'b'
        ? COLORS.red
        : COLORS.muted
      : COLORS.muted

  const roundWinLabel =
    props.phase === 'reveal'
      ? props.roundWinner === 'disputed'
        ? 'Ronda nula (rejugar)'
        : props.roundWinner === 'a'
        ? `Gana la ronda: ${nameA}`
        : `Gana la ronda: ${nameB}`
      : ''

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <ArenaBackdrop
      reducedMotion={reduced}
      accentA={accentColor}
      accentB={opponentAccent}
    >
      <div
        style={{
          color: COLORS.text,
          fontFamily: 'Inter, system-ui, sans-serif',
          padding: '10px 10px 24px',
        }}
      >
        {/* ── Outer max-width wrapper ── */}
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>

          {/* ── Header: round label + score ── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '10px',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: '9px',
                  color: COLORS.muted,
                  letterSpacing: '.07em',
                  fontFamily: FONTS.mono,
                  marginBottom: '1px',
                }}
              >
                RONDA {state.round + 1}
              </div>
              <div
                style={{
                  fontSize: '15px',
                  fontWeight: 800,
                  color: accentColor,
                  fontFamily: FONTS.orbitron,
                }}
              >
                {props.phase === 'allocate' ? props.playerLabel : 'Resultados'}
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                gap: '5px',
                alignItems: 'center',
              }}
            >
              <span
                style={{
                  fontWeight: 700,
                  fontFamily: FONTS.orbitron,
                  fontSize: '16px',
                  color: COLORS.green,
                }}
              >
                {state.roundWins.a}
              </span>
              <span style={{ fontSize: '12px', color: COLORS.muted, fontFamily: FONTS.mono }}>
                –
              </span>
              <span
                style={{
                  fontWeight: 700,
                  fontFamily: FONTS.orbitron,
                  fontSize: '16px',
                  color: COLORS.red,
                }}
              >
                {state.roundWins.b}
              </span>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════
           *  OPPONENT ZONE (top)
           * ═══════════════════════════════════════════════ */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 8px',
              background: `linear-gradient(180deg, ${opponentAccent}0c, transparent 100%)`,
              borderRadius: '10px 10px 0 0',
              border: `1px solid ${opponentAccent}22`,
              borderBottom: 'none',
            }}
          >
            <HeroPortrait
              name={oppCard.name}
              accentColor={opponentAccent}
              winsCount={oppWins}
              winsNeeded={roundsToWin}
              reduced={reduced}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: '10px',
                  fontFamily: FONTS.mono,
                  color: opponentAccent,
                  letterSpacing: '.04em',
                  marginBottom: '4px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {oppCard.gradeCompany} {oppCard.grade} — {oppCard.name}
              </div>
              {/* Opponent reserve: always hidden */}
              <OpponentReserve />
            </div>
          </div>

          {/* ═══════════════════════════════════════════════
           *  3 FRONT COLUMNS (the board)
           * ═══════════════════════════════════════════════ */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: '6px',
              padding: '8px 6px',
              background: COLORS.panel,
              border: `1px solid ${COLORS.border}`,
              borderTop: `1px solid ${opponentAccent}22`,
              borderBottom: `1px solid ${accentColor}22`,
            }}
          >
            {FRONT_KEYS.map((fk, idx) => {
              if (props.phase === 'reveal') {
                const isRevealed = revealedFronts > idx
                const winner = props.frontWinners[fk]
                const note = aguanteNote(fk)
                return (
                  <div key={fk} style={{ position: 'relative' }}>
                    <FrontColumn
                      mode="reveal"
                      frontKey={fk}
                      allocA={props.allocA[fk]}
                      allocB={props.allocB[fk]}
                      winner={winner}
                      nameA={nameA}
                      nameB={nameB}
                      aguanteNote={note}
                      isRevealed={isRevealed}
                      reduced={reduced}
                    />
                    {/* Spotlight pulse on reveal */}
                    {isRevealed && winner !== 'disputed' && !reduced && (
                      <motion.div
                        initial={{ opacity: 0.5 }}
                        animate={{ opacity: 0 }}
                        transition={{ duration: 0.9 }}
                        style={{
                          position: 'absolute',
                          inset: 0,
                          borderRadius: '8px',
                          background: `radial-gradient(ellipse at center, ${
                            winner === 'a' ? COLORS.green : COLORS.red
                          }33 0%, transparent 70%)`,
                          pointerEvents: 'none',
                        }}
                      />
                    )}
                  </div>
                )
              }

              // allocate phase
              return (
                <FrontColumn
                  key={fk}
                  mode="allocate"
                  frontKey={fk}
                  allocValue={alloc[fk]}
                  availablePool={pool}
                  disabled={committing}
                  onAdd={() => {
                    if (committing || pool <= 0) return
                    setAlloc((prev) => clampApply(prev, fk, +1, available))
                    playSfx('tick')
                    haptic(8)
                  }}
                  onRemove={() => {
                    if (committing || alloc[fk] <= 0) return
                    setAlloc((prev) => clampApply(prev, fk, -1, available))
                    playSfx('tick')
                    haptic(8)
                  }}
                  accentColor={accentColor}
                  reduced={reduced}
                />
              )
            })}
          </div>

          {/* ═══════════════════════════════════════════════
           *  YOUR ZONE (bottom)
           * ═══════════════════════════════════════════════ */}
          <div
            style={{
              padding: '8px 8px',
              background: `linear-gradient(0deg, ${accentColor}0c, transparent 100%)`,
              borderRadius: '0 0 10px 10px',
              border: `1px solid ${accentColor}22`,
              borderTop: 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <HeroPortrait
                name={myCard.name}
                accentColor={accentColor}
                winsCount={myWins}
                winsNeeded={roundsToWin}
                reduced={reduced}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: '10px',
                    fontFamily: FONTS.mono,
                    color: accentColor,
                    letterSpacing: '.04em',
                    marginBottom: '4px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {myCard.gradeCompany} {myCard.grade} — {myCard.name}
                </div>
                {/* Mana crystals only during allocation */}
                {props.phase === 'allocate' && (
                  <ManaCrystals
                    available={available}
                    base={base}
                    edge={edge}
                    banked={banked}
                    accentColor={accentColor}
                    reduced={reduced}
                  />
                )}
              </div>
            </div>

            {/* Pool info row (allocate only) */}
            {props.phase === 'allocate' && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: '6px',
                  fontSize: '10px',
                  color: COLORS.muted,
                  fontFamily: FONTS.mono,
                  padding: '0 2px',
                }}
              >
                <span>
                  Sin asignar:{' '}
                  <strong
                    style={{ color: accentColor, fontFamily: FONTS.orbitron }}
                  >
                    {pool}
                  </strong>
                </span>
                <span>
                  Asignada:{' '}
                  <strong
                    style={{ color: accentColor, fontFamily: FONTS.orbitron }}
                  >
                    {spent}
                  </strong>
                  {pool > 0 ? ` · ${pool} se banca` : ''}
                </span>
              </div>
            )}
          </div>

          {/* ═══════════════════════════════════════════════
           *  REVEAL: aguante notes + round winner banner
           * ═══════════════════════════════════════════════ */}
          {props.phase === 'reveal' && (
            <>
              {/* Aguante notes for each front */}
              {FRONT_KEYS.map((fk, idx) => {
                const note = aguanteNote(fk)
                if (!note || revealedFronts <= idx) return null
                return (
                  <div
                    key={fk}
                    style={{
                      fontSize: '10px',
                      color: COLORS.muted,
                      fontFamily: FONTS.mono,
                      fontStyle: 'italic',
                      padding: '3px 8px',
                      borderLeft: `2px solid ${COLORS.border}`,
                      marginTop: '4px',
                    }}
                  >
                    {FRONT_LABELS[fk]}: {note}
                  </div>
                )
              })}

              {/* Round winner banner */}
              <AnimatePresence>
                {showRoundBanner && (
                  <motion.div
                    initial={reduced ? false : { opacity: 0, scale: 0.92, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                    style={{
                      background:
                        props.roundWinner === 'disputed'
                          ? COLORS.panel
                          : playerTheme[props.roundWinner as 'a' | 'b']?.gradient ??
                            COLORS.panel,
                      border: `1px solid ${roundWinColor}55`,
                      borderRadius: '10px',
                      padding: '12px 14px',
                      textAlign: 'center',
                      marginTop: '10px',
                      boxShadow: `0 0 16px ${roundWinColor}44`,
                    }}
                  >
                    <div
                      style={{
                        fontSize: '9px',
                        color: COLORS.muted,
                        letterSpacing: '.07em',
                        marginBottom: '4px',
                        fontFamily: FONTS.mono,
                      }}
                    >
                      RESULTADO DE LA RONDA
                    </div>
                    <div
                      style={{
                        fontSize: '17px',
                        fontWeight: 800,
                        color: roundWinColor,
                        fontFamily: FONTS.orbitron,
                      }}
                    >
                      {roundWinLabel}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}

          {/* ═══════════════════════════════════════════════
           *  COMMIT button (allocate phase)
           * ═══════════════════════════════════════════════ */}
          {props.phase === 'allocate' && (
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
                background: accentColor,
                color: playerKey === 'a' ? '#04130c' : '#1a040a',
                border: 'none',
                borderRadius: '10px',
                padding: '15px',
                fontSize: '15px',
                fontWeight: 800,
                fontFamily: FONTS.orbitron,
                cursor: committing ? 'default' : 'pointer',
                letterSpacing: '.03em',
                boxShadow: `0 0 14px ${accentColor}66`,
                minHeight: '52px',
                opacity: committing ? 0.7 : 1,
                pointerEvents: committing ? 'none' : undefined,
                marginTop: '12px',
              }}
            >
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  display: 'inline-block',
                  verticalAlign: 'middle',
                  marginRight: '6px',
                  marginBottom: '2px',
                }}
              >
                <path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2" />
                <rect x="2.5" y="7" width="11" height="8" rx="2" />
                <circle cx="8" cy="11.5" r="1" fill="currentColor" stroke="none" />
              </svg>
              COMMIT · {spent} asignada
              {pool > 0 ? ` · ${pool} se banca` : ''}
            </motion.button>
          )}

          {/* ═══════════════════════════════════════════════
           *  CONTINUE button (reveal phase)
           * ═══════════════════════════════════════════════ */}
          {props.phase === 'reveal' && (
            <AnimatePresence>
              {showRoundBanner && (
                <motion.button
                  initial={reduced ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  onClick={props.onContinue}
                  whileTap={reduced ? undefined : { scale: 0.97 }}
                  style={{
                    width: '100%',
                    background: COLORS.green,
                    color: '#04130c',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '15px',
                    fontSize: '15px',
                    fontWeight: 800,
                    fontFamily: FONTS.orbitron,
                    cursor: 'pointer',
                    letterSpacing: '.03em',
                    boxShadow: '0 0 12px #34e29b55',
                    minHeight: '52px',
                    marginTop: '10px',
                  }}
                >
                  Continuar →
                </motion.button>
              )}
            </AnimatePresence>
          )}

        </div>{/* /max-width wrapper */}
      </div>
    </ArenaBackdrop>
  )
}
