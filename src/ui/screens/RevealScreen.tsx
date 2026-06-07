import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Allocation, FrontKey, FrontWinner, MatchState } from '../../engine'
import { solidez } from '../../engine'
import { COLORS, player as playerTheme } from '../theme'
import { FlipCard } from '../components/FlipCard'
import { useReducedMotion } from '../useReducedMotion'
import { playSfx, haptic } from '../sound'

interface Props {
  allocA: Allocation
  allocB: Allocation
  frontWinners: Record<FrontKey, FrontWinner>
  roundWinner: FrontWinner
  nameA: string
  nameB: string
  onContinue: () => void
  state: MatchState
}

const FRONTS: { key: FrontKey; label: string; icon: string }[] = [
  { key: 'apertura', label: 'Apertura', icon: '⚔️' },
  { key: 'choque', label: 'Choque', icon: '💥' },
  { key: 'remate', label: 'Remate', icon: '🎯' },
]

const STAGGER_MS = 700

export function RevealScreen({ allocA, allocB, frontWinners, roundWinner, nameA, nameB, onContinue, state }: Props) {
  const reduced = useReducedMotion()
  const solA = solidez(state.cardA)
  const solB = solidez(state.cardB)

  // `revealed` = how many fronts have been resolved so far.
  // Under reduced motion everything is revealed instantly.
  const [revealed, setRevealed] = useState(reduced ? FRONTS.length : 0)
  const [showBanner, setShowBanner] = useState(reduced)

  useEffect(() => {
    if (reduced) {
      // Optional single cue, no auto-sequence.
      return
    }
    const timers: ReturnType<typeof setTimeout>[] = []
    FRONTS.forEach((f, i) => {
      timers.push(
        setTimeout(() => {
          setRevealed((n) => Math.max(n, i + 1))
          const w = frontWinners[f.key]
          playSfx('reveal')
          if (w !== 'disputed') haptic(10)
        }, 350 + i * STAGGER_MS),
      )
    })
    timers.push(
      setTimeout(() => {
        setShowBanner(true)
        playSfx(roundWinner === 'disputed' ? 'tick' : 'win')
        if (roundWinner !== 'disputed') haptic([15, 40, 15])
      }, 350 + FRONTS.length * STAGGER_MS),
    )
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced])

  function winnerTag(w: FrontWinner) {
    if (w === 'a') return { label: `🟢 ${nameA}`, color: COLORS.green }
    if (w === 'b') return { label: `🔴 ${nameB}`, color: COLORS.red }
    return { label: '⚪ Disputado', color: COLORS.muted }
  }

  function aguanteNote(frontKey: FrontKey): string | null {
    const aVal = allocA[frontKey]
    const bVal = allocB[frontKey]
    const winner = frontWinners[frontKey]
    if (aVal === bVal && winner !== 'disputed') {
      const winnerSol = winner === 'a' ? solA : solB
      const loserSol = winner === 'a' ? solB : solA
      const winName = winner === 'a' ? `🟢 ${nameA}` : `🔴 ${nameB}`
      return `Aguante: gana ${winName} por Solidez ${winnerSol} vs ${loserSol}`
    }
    return null
  }

  const roundWinTag = winnerTag(roundWinner)

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
        {/* Header */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', color: COLORS.muted, letterSpacing: '.06em', marginBottom: '2px' }}>REVEAL</div>
          <div style={{ fontSize: '22px', fontWeight: 800 }}>Resultados de la ronda</div>
        </div>

        {/* Column headers */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr 1fr',
            gap: '4px',
            fontSize: '10px',
            color: COLORS.muted,
            letterSpacing: '.05em',
            marginBottom: '6px',
            padding: '0 4px',
          }}
        >
          <span>FRENTE</span>
          <span style={{ textAlign: 'right', color: COLORS.green }}>🟢 {nameA}</span>
          <span style={{ textAlign: 'right', color: COLORS.red }}>🔴 {nameB}</span>
          <span style={{ textAlign: 'right' }}>GANADOR</span>
        </div>

        {/* Front rows — each flips in and resolves in sequence */}
        {FRONTS.map((f, i) => {
          const isRevealed = revealed > i
          const w = frontWinners[f.key]
          const tag = winnerTag(w)
          const aguante = aguanteNote(f.key)

          const faceContent = (
            <div
              style={{
                background: COLORS.panel,
                border: `1px solid ${isRevealed && w !== 'disputed' ? `${tag.color}66` : COLORS.border}`,
                borderRadius: '8px',
                padding: '10px 12px',
                boxShadow: isRevealed && w !== 'disputed' ? `0 0 14px ${tag.color}33` : 'none',
                transition: 'border-color .2s, box-shadow .2s',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr 1fr',
                  gap: '4px',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontWeight: 600, fontSize: '13px' }}>{f.icon} {f.label}</span>
                <motion.span
                  animate={
                    isRevealed && w === 'a' && !reduced
                      ? { scale: [1, 1.3, 1], textShadow: [`0 0 0px ${COLORS.green}`, `0 0 10px ${COLORS.green}`, `0 0 6px ${COLORS.green}`] }
                      : undefined
                  }
                  transition={{ duration: 0.4 }}
                  style={{
                    textAlign: 'right',
                    fontWeight: w === 'a' ? 800 : 400,
                    fontSize: '18px',
                    color: w === 'a' ? COLORS.green : COLORS.text,
                  }}
                >
                  {allocA[f.key]}
                </motion.span>
                <motion.span
                  animate={
                    isRevealed && w === 'b' && !reduced
                      ? { scale: [1, 1.3, 1], textShadow: [`0 0 0px ${COLORS.red}`, `0 0 10px ${COLORS.red}`, `0 0 6px ${COLORS.red}`] }
                      : undefined
                  }
                  transition={{ duration: 0.4 }}
                  style={{
                    textAlign: 'right',
                    fontWeight: w === 'b' ? 800 : 400,
                    fontSize: '18px',
                    color: w === 'b' ? COLORS.red : COLORS.text,
                  }}
                >
                  {allocB[f.key]}
                </motion.span>
                <span style={{ textAlign: 'right', fontWeight: 700, fontSize: '12px', color: tag.color }}>
                  {tag.label}
                </span>
              </div>
              {aguante && (
                <div
                  style={{
                    fontSize: '11px',
                    color: COLORS.muted,
                    marginTop: '6px',
                    borderTop: `1px solid ${COLORS.border}`,
                    paddingTop: '4px',
                    fontStyle: 'italic',
                  }}
                >
                  {aguante}
                </div>
              )}
            </div>
          )

          const backContent = (
            <div
              style={{
                background: 'linear-gradient(135deg,#16213d,#0d1326)',
                border: `1px solid ${COLORS.border}`,
                borderRadius: '8px',
                padding: '10px 12px',
                minHeight: '44px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                color: COLORS.muted,
                fontSize: '13px',
                fontWeight: 600,
              }}
            >
              <span>{f.icon} {f.label}</span>
              <span style={{ letterSpacing: '.2em' }}>· · ·</span>
            </div>
          )

          return (
            <div key={f.key} style={{ marginBottom: '6px' }}>
              <FlipCard
                flipped={isRevealed}
                reducedMotion={reduced}
                front={faceContent}
                back={backContent}
                minHeight={aguante ? 70 : 50}
              />
            </div>
          )
        })}

        {/* Round winner banner */}
        <AnimatePresence>
          {showBanner && (
            <motion.div
              initial={reduced ? false : { opacity: 0, scale: 0.9, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 22 }}
              style={{
                background: roundWinner === 'disputed' ? COLORS.panel : playerTheme[roundWinner as 'a' | 'b']?.gradient ?? COLORS.panel,
                border: `1px solid ${roundWinTag.color}55`,
                borderRadius: '10px',
                padding: '14px',
                textAlign: 'center',
                margin: '16px 0',
                boxShadow: `0 0 18px ${roundWinTag.color}44`,
              }}
            >
              <div style={{ fontSize: '11px', color: COLORS.muted, letterSpacing: '.06em', marginBottom: '4px' }}>
                RESULTADO DE LA RONDA
              </div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: roundWinTag.color }}>
                {roundWinner === 'disputed' ? 'Ronda nula (rejugar)' : `Gana la ronda: ${roundWinTag.label}`}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Continue button — appears with the banner */}
        <AnimatePresence>
          {showBanner && (
            <motion.button
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              onClick={onContinue}
              whileTap={reduced ? undefined : { scale: 0.97 }}
              style={{
                width: '100%',
                background: COLORS.green,
                color: '#04130c',
                border: 'none',
                borderRadius: '10px',
                padding: '16px',
                fontSize: '15px',
                fontWeight: 800,
                cursor: 'pointer',
                letterSpacing: '.03em',
                boxShadow: '0 0 12px #34e29b55',
                minHeight: '52px',
              }}
            >
              Continuar →
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
