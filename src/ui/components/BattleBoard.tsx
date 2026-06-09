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
 *  Mobile (<768): compact — natural top-down stack, 3 front columns,
 *    opponent above, your zone below. No horizontal overflow at 375px.
 *  Desktop (≥768): FULL-HEIGHT board — opponent pinned to the top, your
 *    zone + commit pinned to the BOTTOM, the 3 fronts expand in the middle.
 *    Larger typography / elements, wider max-width, generous gaps.
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
// Responsive helper: true on desktop-width viewports (≥768px).
// ─────────────────────────────────────────────────────────────────────────────

function useIsWide(query = '(min-width: 768px)'): boolean {
  const get = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false
  const [wide, setWide] = useState<boolean>(get)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const handler = () => setWide(mql.matches)
    handler()
    mql.addEventListener?.('change', handler)
    return () => mql.removeEventListener?.('change', handler)
  }, [query])
  return wide
}

/** size picker: mobile value on phones, desktop value on ≥768px. */
const pick = (wide: boolean) => (m: number, d: number) => (wide ? d : m)

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
  wide,
}: {
  name: string
  accentColor: string
  winsCount: number
  winsNeeded: number
  reduced: boolean
  wide: boolean
}) {
  const s = pick(wide)
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  const circle = s(48, 82)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: s(3, 6),
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: circle,
          height: circle,
          borderRadius: '50%',
          background: `radial-gradient(circle at 40% 38%, ${accentColor}33, #0a0e1a 80%)`,
          border: `2px solid ${accentColor}88`,
          boxShadow: reduced ? 'none' : `0 0 ${s(10, 18)}px ${accentColor}44`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: FONTS.orbitron,
          fontWeight: 800,
          fontSize: s(14, 26),
          color: accentColor,
          flexShrink: 0,
        }}
      >
        {initials}
      </div>
      <span
        style={{
          fontSize: s(8, 12),
          color: COLORS.muted,
          fontFamily: FONTS.mono,
          letterSpacing: '.03em',
          maxWidth: s(54, 110),
          textAlign: 'center',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>
      <div style={{ display: 'flex', gap: s(3, 5) }}>
        {Array.from({ length: winsNeeded }, (_, i) => (
          <span
            key={i}
            style={{
              width: s(7, 11),
              height: s(7, 11),
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

/**
 * Your mana strip — single, interactive energy readout.
 * Shows the energy you still have LEFT this round (decreases as you allocate),
 * with plain tags for where the extra came from (ventaja / reserva) and a hint
 * that unspent mana is banked.
 */
function ManaCrystals({
  pool,
  edge,
  banked,
  accentColor,
  reduced,
  wide,
}: {
  pool: number
  edge: number
  banked: number
  accentColor: string
  reduced: boolean
  wide: boolean
}) {
  const s = pick(wide)
  const cap = s(12, 18)
  const tag = (text: string) => (
    <span
      style={{
        fontSize: s(8, 11),
        color: accentColor,
        fontFamily: FONTS.mono,
        background: `${accentColor}1a`,
        border: `1px solid ${accentColor}44`,
        borderRadius: '6px',
        padding: '1px 5px',
      }}
    >
      {text}
    </span>
  )

  return (
    <div
      style={{
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderRadius: '8px',
        padding: s(6, 10),
        display: 'flex',
        alignItems: 'center',
        gap: s(8, 14),
      }}
    >
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: s(5, 7),
            marginBottom: '2px',
          }}
        >
          <span
            style={{
              fontSize: s(8, 12),
              color: COLORS.muted,
              fontFamily: FONTS.mono,
              letterSpacing: '.05em',
            }}
          >
            MANÁ DISPONIBLE
          </span>
          {edge > 0 && tag(`+${edge} ventaja`)}
          {banked > 0 && tag(`+${banked} reserva`)}
        </div>
        <div
          style={{
            fontSize: s(20, 40),
            fontWeight: 800,
            fontFamily: FONTS.orbitron,
            color: accentColor,
            lineHeight: 1,
          }}
        >
          {pool}
        </div>
        <div
          style={{
            fontSize: s(8, 12),
            color: COLORS.muted,
            fontFamily: FONTS.mono,
            fontStyle: 'italic',
            marginTop: '2px',
          }}
        >
          lo que no uses se banca
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: s(3, 5),
          maxWidth: s(88, 260),
        }}
      >
        {Array.from({ length: Math.min(pool, cap) }, (_, i) => (
          <EnergyOrb key={i} color={accentColor} reduced={reduced} size={s(11, 16)} />
        ))}
        {pool > cap && (
          <span
            style={{
              fontSize: s(9, 13),
              color: COLORS.muted,
              fontFamily: FONTS.mono,
              alignSelf: 'center',
            }}
          >
            +{pool - cap}
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
function OpponentReserve({ wide }: { wide: boolean }) {
  const s = pick(wide)
  const ico = s(12, 18)
  return (
    <div
      style={{
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderRadius: '8px',
        padding: s(6, 10),
        display: 'flex',
        alignItems: 'center',
        gap: s(5, 8),
      }}
      aria-label="Reserva del rival: oculta"
    >
      <svg
        width={ico}
        height={ico}
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
            fontSize: s(8, 12),
            color: COLORS.muted,
            fontFamily: FONTS.mono,
            letterSpacing: '.04em',
          }}
        >
          MANÁ
        </div>
        <div
          style={{
            fontSize: s(10, 15),
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
  wide: boolean
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
  wide: boolean
}

type FrontColumnProps = FrontColumnAllocateProps | FrontColumnRevealProps

function FrontColumn(props: FrontColumnProps) {
  const s = pick(props.wide)
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
          gap: s(3, 6),
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
            padding: s(6, 14),
            width: '100%',
            textAlign: 'center',
            transition: 'border-color .2s, background .2s',
          }}
        >
          <span
            style={{
              fontSize: s(20, 40),
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
            padding: s(3, 6) + 'px 0',
          }}
        >
          <FrontSigil
            front={props.frontKey}
            color={winColor}
            size={s(18, 34)}
            glow={isRevealed && winner !== 'disputed' && !reduced}
          />
          <span
            style={{
              fontSize: s(8, 13),
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
                fontSize: s(8, 13),
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
                fontSize: s(7, 11),
                color: COLORS.muted,
                fontFamily: FONTS.mono,
                fontStyle: 'italic',
                textAlign: 'center',
                maxWidth: s(72, 140),
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
            padding: s(6, 14),
            width: '100%',
            textAlign: 'center',
            transition: 'border-color .2s, background .2s',
          }}
        >
          <span
            style={{
              fontSize: s(20, 40),
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
  const orbCap = s(6, 10)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: s(3, 6),
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
          padding: s(8, 14) + 'px 4px',
          width: '100%',
          textAlign: 'center',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: s(46, 56),
          color: COLORS.muted,
          fontSize: s(13, 20),
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
          padding: s(2, 4) + 'px 0',
        }}
      >
        <FrontSigil
          front={props.frontKey}
          color={frontAccent}
          size={s(16, 30)}
          glow={hasAlloc && !reduced}
        />
        <span
          style={{
            fontSize: s(8, 13),
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
          padding: s(6, 10) + 'px 4px',
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
            gap: s(3, 6),
            minHeight: s(44, 64),
          }}
        >
          {/* Orbs stacked in troop zone */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: s(2, 4),
              justifyContent: 'center',
              minHeight: s(13, 18),
            }}
          >
            <AnimatePresence>
              {allocValue > 0 &&
                Array.from({ length: Math.min(allocValue, orbCap) }, (_, i) => (
                  <motion.span
                    key={`${props.frontKey}-orb-${i}`}
                    initial={reduced ? false : { scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={reduced ? undefined : { scale: 0, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 600, damping: 34 }}
                    style={{ display: 'inline-flex' }}
                  >
                    <EnergyOrb color={accentColor} reduced={reduced} size={s(11, 16)} />
                  </motion.span>
                ))}
              {allocValue > orbCap && (
                <span
                  style={{
                    fontSize: s(8, 12),
                    color: accentColor,
                    fontFamily: FONTS.mono,
                    alignSelf: 'center',
                  }}
                >
                  +{allocValue - orbCap}
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
              fontSize: s(24, 42),
              fontWeight: 800,
              fontFamily: FONTS.orbitron,
              color: hasAlloc ? accentColor : COLORS.muted,
              lineHeight: 1,
            }}
          >
            {allocValue}
          </motion.span>
        </button>

        {/* −/+ controls (explicit) */}
        <div style={{ display: 'flex', gap: s(4, 8), marginTop: s(3, 6) }}>
          <button
            type="button"
            onClick={onRemove}
            disabled={disabledRemove}
            aria-disabled={disabledRemove || undefined}
            aria-label={`Quitar 1 energía de ${label}`}
            style={{
              flex: 1,
              background: COLORS.bg,
              border: `1px solid ${COLORS.border}`,
              color: disabledRemove ? COLORS.border : COLORS.text,
              borderRadius: '6px',
              fontSize: s(16, 24),
              fontWeight: 700,
              cursor: disabledRemove ? 'default' : 'pointer',
              padding: '3px',
              minHeight: s(36, 44),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            −
          </button>
          <button
            type="button"
            onClick={onAdd}
            disabled={disabledAdd}
            aria-disabled={disabledAdd || undefined}
            aria-label={`Añadir 1 energía a ${label}`}
            style={{
              flex: 1,
              background: disabledAdd ? COLORS.bg : `${accentColor}1a`,
              border: `1px solid ${disabledAdd ? COLORS.border : `${accentColor}66`}`,
              color: disabledAdd ? COLORS.border : accentColor,
              borderRadius: '6px',
              fontSize: s(16, 24),
              fontWeight: 700,
              cursor: disabledAdd ? 'default' : 'pointer',
              padding: '3px',
              minHeight: s(36, 44),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            +
          </button>
        </div>
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
  const wide = useIsWide()
  const s = pick(wide)

  // ── Allocation state (only used in allocate phase) ─────────────────────────
  const [alloc, setAlloc] = useState<Allocation>({ apertura: 0, choque: 0, remate: 0 })
  const [committing, setCommitting] = useState(false)

  // ── Reveal stagger state ───────────────────────────────────────────────────
  const isReveal = props.phase === 'reveal'
  const [revealedFronts, setRevealedFronts] = useState<number>(
    isReveal && reduced ? FRONT_KEYS.length : 0,
  )
  const [showRoundBanner, setShowRoundBanner] = useState<boolean>(isReveal && reduced)

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

  // ── Top group: header + opponent zone ──────────────────────────────────────
  const topGroup = (
    <div>
      {/* Header: round label + score */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: s(10, 16),
        }}
      >
        <div
          style={{
            fontSize: s(10, 14),
            color: COLORS.muted,
            letterSpacing: '.1em',
            fontFamily: FONTS.mono,
          }}
        >
          RONDA {state.round + 1}
        </div>
        <div style={{ display: 'flex', gap: s(5, 8), alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontFamily: FONTS.orbitron, fontSize: s(16, 30), color: COLORS.green }}>
            {state.roundWins.a}
          </span>
          <span style={{ fontSize: s(12, 20), color: COLORS.muted, fontFamily: FONTS.mono }}>–</span>
          <span style={{ fontWeight: 700, fontFamily: FONTS.orbitron, fontSize: s(16, 30), color: COLORS.red }}>
            {state.roundWins.b}
          </span>
        </div>
      </div>

      {/* Opponent zone */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: s(10, 18),
          padding: s(8, 14),
          background: `linear-gradient(180deg, ${opponentAccent}14, ${COLORS.panel} 100%)`,
          borderRadius: '12px',
          border: `1px solid ${opponentAccent}33`,
        }}
      >
        <HeroPortrait
          name={oppCard.name}
          accentColor={opponentAccent}
          winsCount={oppWins}
          winsNeeded={roundsToWin}
          reduced={reduced}
          wide={wide}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: s(10, 15),
              fontFamily: FONTS.mono,
              color: opponentAccent,
              letterSpacing: '.04em',
              marginBottom: s(4, 7),
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {oppCard.gradeCompany} {oppCard.grade} — {oppCard.name}
          </div>
          <OpponentReserve wide={wide} />
        </div>
      </div>
    </div>
  )

  // ── Middle: the 3-front board grid ─────────────────────────────────────────
  const board = (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: s(6, 22),
        padding: s(8, 18) + 'px ' + s(6, 18) + 'px',
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderRadius: '12px',
        width: '100%',
        boxSizing: 'border-box',
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
                wide={wide}
              />
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
            wide={wide}
          />
        )
      })}
    </div>
  )

  // ── Bottom group: your zone + reveal notes/banner + action button ──────────
  const bottomGroup = (
    <div>
      {/* Turn / identity label — relocated here, with YOUR side */}
      {props.phase === 'allocate' && (
        <div
          style={{
            fontSize: s(13, 20),
            fontWeight: 800,
            color: accentColor,
            fontFamily: FONTS.orbitron,
            marginBottom: s(5, 8),
            paddingLeft: '2px',
          }}
        >
          {props.playerLabel}
        </div>
      )}
      {/* Your zone */}
      <div
        style={{
          padding: s(8, 14),
          background: `linear-gradient(0deg, ${accentColor}14, ${COLORS.panel} 100%)`,
          borderRadius: '12px',
          border: `1px solid ${accentColor}33`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: s(10, 18) }}>
          <HeroPortrait
            name={myCard.name}
            accentColor={accentColor}
            winsCount={myWins}
            winsNeeded={roundsToWin}
            reduced={reduced}
            wide={wide}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: s(10, 15),
                fontFamily: FONTS.mono,
                color: accentColor,
                letterSpacing: '.04em',
                marginBottom: s(4, 7),
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {myCard.gradeCompany} {myCard.grade} — {myCard.name}
            </div>
            {props.phase === 'allocate' && (
              <ManaCrystals
                pool={pool}
                edge={edge}
                banked={banked}
                accentColor={accentColor}
                reduced={reduced}
                wide={wide}
              />
            )}
          </div>
        </div>

      </div>

      {/* Reveal: aguante notes + round winner banner */}
      {props.phase === 'reveal' && (
        <>
          {FRONT_KEYS.map((fk, idx) => {
            const note = aguanteNote(fk)
            if (!note || revealedFronts <= idx) return null
            return (
              <div
                key={fk}
                style={{
                  fontSize: s(10, 14),
                  color: COLORS.muted,
                  fontFamily: FONTS.mono,
                  fontStyle: 'italic',
                  padding: s(3, 6) + 'px 8px',
                  borderLeft: `2px solid ${COLORS.border}`,
                  marginTop: '4px',
                }}
              >
                {FRONT_LABELS[fk]}: {note}
              </div>
            )
          })}

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
                      : playerTheme[props.roundWinner as 'a' | 'b']?.gradient ?? COLORS.panel,
                  border: `1px solid ${roundWinColor}55`,
                  borderRadius: '10px',
                  padding: s(12, 18) + 'px ' + s(14, 18) + 'px',
                  textAlign: 'center',
                  marginTop: s(10, 16),
                  boxShadow: `0 0 16px ${roundWinColor}44`,
                }}
              >
                <div
                  style={{
                    fontSize: s(9, 13),
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
                    fontSize: s(17, 30),
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

      {/* COMMIT button (allocate) */}
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
            padding: s(15, 20),
            fontSize: s(15, 22),
            fontWeight: 800,
            fontFamily: FONTS.orbitron,
            cursor: committing ? 'default' : 'pointer',
            letterSpacing: '.03em',
            boxShadow: `0 0 14px ${accentColor}66`,
            minHeight: s(52, 64),
            opacity: committing ? 0.7 : 1,
            pointerEvents: committing ? 'none' : undefined,
            marginTop: s(12, 16),
          }}
        >
          <svg
            aria-hidden="true"
            width={s(14, 18)}
            height={s(14, 18)}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '6px', marginBottom: '2px' }}
          >
            <path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2" />
            <rect x="2.5" y="7" width="11" height="8" rx="2" />
            <circle cx="8" cy="11.5" r="1" fill="currentColor" stroke="none" />
          </svg>
          COMMIT · {spent} asignada{pool > 0 ? ` · ${pool} se banca` : ''}
        </motion.button>
      )}

      {/* CONTINUE button (reveal) */}
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
                padding: s(15, 20),
                fontSize: s(15, 22),
                fontWeight: 800,
                fontFamily: FONTS.orbitron,
                cursor: 'pointer',
                letterSpacing: '.03em',
                boxShadow: '0 0 12px #34e29b55',
                minHeight: s(52, 64),
                marginTop: s(10, 16),
              }}
            >
              Continuar →
            </motion.button>
          )}
        </AnimatePresence>
      )}
    </div>
  )

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <ArenaBackdrop reducedMotion={reduced} accentA={accentColor} accentB={opponentAccent}>
      {/* Fixed-height viewport: action button (COMMIT / Continuar) stays pinned at
          the bottom and is ALWAYS visible — only the upper area scrolls if needed. */}
      <div
        style={{
          color: COLORS.text,
          fontFamily: 'Inter, system-ui, sans-serif',
          height: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: wide ? 'min(1500px, 95vw)' : '900px',
            margin: '0 auto',
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            padding: wide ? '16px 24px 14px' : '8px 10px 12px',
            boxSizing: 'border-box',
          }}
        >
          {/* TOP: round bar + opponent — pinned at the top */}
          <div style={{ flexShrink: 0 }}>{topGroup}</div>
          {/* MIDDLE: the 3 fronts — centered, scrolls only if it can't fit */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: wide ? '14px 0' : '8px 0',
            }}
          >
            {board}
          </div>
          {/* BOTTOM: your zone + reveal banner + action — pinned at the bottom */}
          <div style={{ flexShrink: 0 }}>{bottomGroup}</div>
        </div>
      </div>
    </ArenaBackdrop>
  )
}
