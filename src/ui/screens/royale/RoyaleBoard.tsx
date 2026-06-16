import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { RoyaleState, Rarity } from '../../../royale/types'
import { COLORS, FONTS, RARITY, SHADOW, formatUsd } from '../../theme'

interface Props {
  state: RoyaleState
  onPlayRound: () => void
  onFinish: () => void
  reducedMotion: boolean
}

const RARITY_COLOR: Record<Rarity, string> = {
  common: RARITY.common,
  uncommon: RARITY.uncommon,
  rare: RARITY.rare,
  epic: RARITY.epic,
}

const RARITY_LABEL: Record<Rarity, string> = {
  common: 'COM',
  uncommon: 'UNC',
  rare: 'RARE',
  epic: 'EPIC',
}
// RARITY_COLOR is now derived from shared tokens (no local purple for epic)

/** Total value of all cards in the pot */
function potValue(pot: RoyaleState['pot']): number {
  return pot.reduce((s, c) => s + c.valueUsd, 0)
}

/** True when player id 0 is eliminated */
function humanIsOut(state: RoyaleState): boolean {
  return state.players[0]?.status === 'eliminated'
}

export function RoyaleBoard({ state, onPlayRound, onFinish, reducedMotion }: Props) {
  // Track which eliminated player to flash after a round resolves
  const [flashedId, setFlashedId] = useState<number | null>(null)
  const [revealRound, setRevealRound] = useState<number>(0) // last round whose result was shown

  const histLen = state.history.length

  useEffect(() => {
    if (histLen === 0) return
    const last = state.history[histLen - 1]
    if (last.round === revealRound) return // already processed
    setRevealRound(last.round)

    if (reducedMotion) return
    // Flash eliminated player briefly
    setFlashedId(last.eliminatedId)
    const t = setTimeout(() => setFlashedId(null), 900)
    return () => clearTimeout(t)
  }, [histLen, reducedMotion]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalPot = potValue(state.pot)
  const activePlayers = state.players.filter((p) => p.status === 'active').length
  const isFinished = state.phase === 'finished'
  const humanOut = humanIsOut(state)

  return (
    <div
      style={{
        minHeight: '100%',
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily: 'Inter, system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          maxWidth: '640px',
          margin: '0 auto',
          width: '100%',
          padding: '16px 16px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          boxSizing: 'border-box',
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <div>
            <div
              style={{
                fontSize: '11px',
                fontFamily: FONTS.mono,
                color: COLORS.muted,
                letterSpacing: '.08em',
                marginBottom: '2px',
              }}
            >
              🏆 BATTLE ROYALE
            </div>
            <div
              style={{
                fontSize: '22px',
                fontWeight: 800,
                fontFamily: FONTS.display,
                color: COLORS.text,
                lineHeight: 1,
              }}
            >
              ROUND{' '}
              <span style={{ color: COLORS.green }}>{state.round}</span>
            </div>
          </div>

          {/* Survivors + pot */}
          <div style={{ textAlign: 'right' }}>
            <div
              style={{
                fontSize: '11px',
                fontFamily: FONTS.mono,
                color: COLORS.muted,
                letterSpacing: '.06em',
                marginBottom: '2px',
              }}
            >
              {activePlayers} survivor{activePlayers !== 1 ? 's' : ''}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', justifyContent: 'flex-end' }}>
              <span
                style={{
                  fontSize: '18px',
                  fontWeight: 800,
                  fontFamily: FONTS.display,
                  color: '#f59e0b',
                }}
              >
                {formatUsd(totalPot)}
              </span>
              <span
                style={{
                  fontSize: '11px',
                  fontFamily: FONTS.mono,
                  color: COLORS.muted,
                }}
              >
                ({state.pot.length} card{state.pot.length !== 1 ? 's' : ''} in pot)
              </span>
            </div>
          </div>
        </div>

        {/* Spectating banner */}
        {humanOut && !isFinished && (
          <div
            style={{
              background: '#1a0a0e',
              border: `1px solid ${COLORS.red}55`,
              borderRadius: '8px',
              padding: '10px 14px',
              fontSize: '12px',
              color: COLORS.red,
              fontFamily: FONTS.mono,
              letterSpacing: '.03em',
            }}
          >
            You're out — watching the finish
          </div>
        )}

        {/* ── Player grid ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: '10px',
          }}
        >
          <AnimatePresence>
            {state.players.map((player) => {
              const isHuman = player.id === 0
              const isActive = player.status === 'active'
              const isWinner = player.status === 'winner'
              const isEliminated = player.status === 'eliminated'
              const isFlashing = flashedId === player.id
              const lastCard = player.pulls[player.pulls.length - 1] ?? null

              const accentColor = isHuman
                ? COLORS.green
                : isWinner
                ? '#f59e0b'
                : isEliminated
                ? COLORS.red
                : COLORS.text

              const borderColor = isFlashing
                ? COLORS.red
                : isHuman && isActive
                ? `${COLORS.green}88`
                : isWinner
                ? '#f59e0b88'
                : isEliminated
                ? `${COLORS.red}44`
                : COLORS.border

              return (
                <motion.div
                  key={player.id}
                  layout={!reducedMotion}
                  animate={
                    isFlashing && !reducedMotion
                      ? { boxShadow: [`0 0 0px ${COLORS.red}`, `0 0 18px ${COLORS.red}`, `0 0 0px ${COLORS.red}`] }
                      : { boxShadow: 'none' }
                  }
                  transition={
                    isFlashing && !reducedMotion
                      ? { duration: 0.9, ease: 'easeInOut' }
                      : { duration: 0.2 }
                  }
                  style={{
                    background: isEliminated ? `${COLORS.red}08` : COLORS.panel,
                    border: `1px solid ${borderColor}`,
                    borderRadius: '10px',
                    padding: '12px',
                    opacity: isEliminated ? 0.55 : 1,
                    transition: 'border-color .2s, opacity .3s',
                    position: 'relative',
                    overflow: 'hidden',
                    boxShadow: isEliminated ? 'none' : isHuman ? SHADOW.glow(COLORS.green) : SHADOW.panel,
                  }}
                >
                  {/* Winner crown */}
                  {isWinner && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '6px',
                        right: '8px',
                        fontSize: '14px',
                      }}
                      aria-hidden="true"
                    >
                      👑
                    </div>
                  )}

                  {/* Player name */}
                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: 700,
                      color: accentColor,
                      fontFamily: FONTS.mono,
                      letterSpacing: '.02em',
                      marginBottom: '2px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      textDecoration: isEliminated ? 'line-through' : 'none',
                    }}
                  >
                    {player.name}
                  </div>

                  {/* Status */}
                  <div
                    style={{
                      fontSize: '10px',
                      fontFamily: FONTS.mono,
                      letterSpacing: '.04em',
                      color: isEliminated
                        ? COLORS.red
                        : isWinner
                        ? '#f59e0b'
                        : COLORS.muted,
                      marginBottom: lastCard ? '8px' : '0',
                    }}
                  >
                    {isEliminated && player.eliminatedRound !== null
                      ? `out R${player.eliminatedRound}`
                      : isWinner
                      ? 'WINNER'
                      : 'active'}
                  </div>

                  {/* Latest card */}
                  {lastCard && (
                    <div
                      style={{
                        background: COLORS.bg,
                        border: `1px solid ${RARITY_COLOR[lastCard.rarity]}44`,
                        borderRadius: '6px',
                        padding: '6px 8px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px',
                          marginBottom: '2px',
                        }}
                      >
                        {/* Rarity dot */}
                        <span
                          style={{
                            width: '7px',
                            height: '7px',
                            borderRadius: '50%',
                            background: RARITY_COLOR[lastCard.rarity],
                            flexShrink: 0,
                            display: 'inline-block',
                          }}
                          aria-hidden="true"
                        />
                        <span
                          style={{
                            fontSize: '9px',
                            fontFamily: FONTS.mono,
                            fontWeight: 700,
                            letterSpacing: '.06em',
                            color: RARITY_COLOR[lastCard.rarity],
                          }}
                        >
                          {RARITY_LABEL[lastCard.rarity]}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: '10px',
                          fontFamily: FONTS.mono,
                          color: COLORS.text,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          marginBottom: '2px',
                        }}
                      >
                        {lastCard.name}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'baseline',
                        }}
                      >
                        <span
                          style={{
                            fontSize: '12px',
                            fontWeight: 800,
                            fontFamily: FONTS.display,
                            color: COLORS.text,
                          }}
                        >
                          {formatUsd(lastCard.valueUsd)}
                        </span>
                        <span
                          style={{
                            fontSize: '9px',
                            fontFamily: FONTS.mono,
                            color: COLORS.muted,
                          }}
                        >
                          G{lastCard.grade}
                        </span>
                      </div>
                    </div>
                  )}
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>

        {/* ── Latest round summary ── */}
        {state.history.length > 0 && (() => {
          const last = state.history[state.history.length - 1]
          return (
            <div
              style={{
                background: COLORS.panel,
                border: `1px solid ${COLORS.border}`,
                borderRadius: '8px',
                padding: '12px 14px',
              }}
            >
              <div
                style={{
                  fontSize: '10px',
                  fontFamily: FONTS.mono,
                  color: COLORS.muted,
                  letterSpacing: '.07em',
                  marginBottom: '6px',
                }}
              >
                ROUND {last.round} — ELIMINATED
              </div>
              {(() => {
                const eliminated = state.players.find((p) => p.id === last.eliminatedId)
                const elimCard = last.pulls.find((x) => x.playerId === last.eliminatedId)?.card
                if (!eliminated || !elimCard) return null
                return (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: 700,
                        fontFamily: FONTS.mono,
                        color: COLORS.red,
                      }}
                    >
                      {eliminated.name}
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        fontFamily: FONTS.mono,
                        color: COLORS.muted,
                      }}
                    >
                      drew {elimCard.name} ·{' '}
                      <span style={{ color: RARITY_COLOR[elimCard.rarity] }}>
                        {RARITY_LABEL[elimCard.rarity]}
                      </span>{' '}
                      · {formatUsd(elimCard.valueUsd)} · G{elimCard.grade}
                    </span>
                  </div>
                )
              })()}
            </div>
          )
        })()}

        {/* ── Action button ── */}
        {isFinished ? (
          <motion.button
            type="button"
            onClick={onFinish}
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 22 }}
            style={{
              width: '100%',
              background: COLORS.green,
              color: '#04130c',
              border: 'none',
              borderRadius: '10px',
              padding: '16px',
              fontSize: '16px',
              fontWeight: 800,
              cursor: 'pointer',
              letterSpacing: '.03em',
              boxShadow: `${SHADOW.panel}, ${SHADOW.glow(COLORS.green)}`,
              fontFamily: FONTS.display,
            }}
          >
            See result →
          </motion.button>
        ) : (
          <button
            type="button"
            onClick={onPlayRound}
            style={{
              width: '100%',
              background: COLORS.green,
              color: '#04130c',
              border: 'none',
              borderRadius: '10px',
              padding: '16px',
              fontSize: '16px',
              fontWeight: 800,
              cursor: 'pointer',
              letterSpacing: '.03em',
              boxShadow: SHADOW.glow(COLORS.green),
              fontFamily: FONTS.display,
            }}
          >
            🎴 Open pack (round {state.round})
          </button>
        )}
      </div>
    </div>
  )
}
