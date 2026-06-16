/**
 * Landing — entry screen for BattleArena.
 * Crypto Platform direction: Solana violet→green, dark, Sora display font.
 * Responsive: 2-col hero/games on ≥820px, single-col below.
 */
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { COLORS, GRADIENT, FONTS } from '../theme'
import { useReducedMotion } from '../useReducedMotion'

// ── Responsive helper ─────────────────────────────────────────────────────────
function useIsWide(query = '(min-width: 820px)'): boolean {
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

// ── Props ─────────────────────────────────────────────────────────────────────
export interface LandingProps {
  onLaunch: () => void  // open the Hub
}

// ── Gradient text helper ──────────────────────────────────────────────────────
function GradientText({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <span
      style={{
        background: GRADIENT,
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        ...style,
      }}
    >
      {children}
    </span>
  )
}

// ── Duel card panel ───────────────────────────────────────────────────────────
function DuelPanel({ wide }: { wide: boolean }) {
  return (
    <div
      style={{
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderRadius: '16px',
        padding: wide ? '28px 24px' : '20px 16px',
        boxShadow: '0 8px 32px #00000066',
        width: '100%',
        maxWidth: wide ? '360px' : '100%',
        margin: wide ? '0' : '0 auto',
        boxSizing: 'border-box',
      }}
    >
      {/* Top card — green accent */}
      <div
        style={{
          background: COLORS.panel2,
          border: `1px solid #14F19555`,
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '12px',
          boxShadow: '0 0 16px #14F19522',
        }}
      >
        <div
          style={{
            fontSize: '11px',
            fontFamily: FONTS.mono,
            color: COLORS.green,
            letterSpacing: '.07em',
            marginBottom: '6px',
            textTransform: 'uppercase',
          }}
        >
          PSA 9 · CERT 8842
        </div>
        <div
          style={{
            fontSize: '16px',
            fontWeight: 700,
            fontFamily: FONTS.display,
            color: COLORS.text,
            marginBottom: '4px',
          }}
        >
          🔥 Charizard Base
        </div>
        <div style={{ fontSize: '13px', color: COLORS.muted, marginBottom: '8px' }}>
          Graded Collector Crypt NFT
        </div>
        <div
          style={{
            fontSize: '22px',
            fontWeight: 800,
            fontFamily: FONTS.display,
            background: GRADIENT,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          $1.2k
        </div>
      </div>

      {/* VS divider */}
      <div
        style={{
          textAlign: 'center',
          fontSize: '12px',
          fontFamily: FONTS.mono,
          color: COLORS.muted,
          letterSpacing: '.12em',
          marginBottom: '12px',
        }}
      >
        — VS —
      </div>

      {/* Bottom card — violet accent */}
      <div
        style={{
          background: COLORS.panel2,
          border: `1px solid #9945FF55`,
          borderRadius: '12px',
          padding: '16px',
          boxShadow: '0 0 16px #9945FF22',
        }}
      >
        <div
          style={{
            fontSize: '11px',
            fontFamily: FONTS.mono,
            color: COLORS.violet,
            letterSpacing: '.07em',
            marginBottom: '6px',
            textTransform: 'uppercase',
          }}
        >
          PSA 7 · CERT 1190
        </div>
        <div
          style={{
            fontSize: '16px',
            fontWeight: 700,
            fontFamily: FONTS.display,
            color: COLORS.text,
            marginBottom: '4px',
          }}
        >
          💧 Blastoise Base
        </div>
        <div style={{ fontSize: '13px', color: COLORS.muted, marginBottom: '8px' }}>
          Graded Collector Crypt NFT
        </div>
        <div
          style={{
            fontSize: '22px',
            fontWeight: 800,
            fontFamily: FONTS.display,
            background: GRADIENT,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          $380
        </div>
      </div>
    </div>
  )
}

// ── Game card ─────────────────────────────────────────────────────────────────
interface GameCardProps {
  icon: string
  title: string
  description: string
  pill: string
  onClick: () => void
  reduced: boolean
}

function GameCard({ icon, title, description, pill, onClick, reduced }: GameCardProps) {
  return (
    <motion.div
      onClick={onClick}
      whileHover={reduced ? undefined : { y: -3, boxShadow: `0 8px 28px #9945FF22` }}
      whileTap={reduced ? undefined : { scale: 0.98 }}
      style={{
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderRadius: '14px',
        padding: '20px',
        cursor: 'pointer',
        transition: 'border-color 0.2s',
      }}
    >
      <div style={{ fontSize: '28px', marginBottom: '12px' }}>{icon}</div>
      <div
        style={{
          fontSize: '16px',
          fontWeight: 700,
          fontFamily: FONTS.display,
          color: COLORS.text,
          marginBottom: '8px',
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: '13px',
          color: COLORS.muted,
          lineHeight: 1.6,
          marginBottom: '14px',
        }}
      >
        {description}
      </div>
      <div
        style={{
          display: 'inline-block',
          fontSize: '10px',
          fontFamily: FONTS.mono,
          fontWeight: 700,
          letterSpacing: '.1em',
          textTransform: 'uppercase',
          color: COLORS.violet,
          border: `1px solid #9945FF55`,
          borderRadius: '4px',
          padding: '3px 10px',
        }}
      >
        {pill}
      </div>
    </motion.div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export function Landing({ onLaunch }: LandingProps) {
  const reduced = useReducedMotion()
  const wide = useIsWide('(min-width: 820px)')

  const fadeUp = reduced
    ? {}
    : { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 } }

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily: FONTS.body,
        overflowX: 'hidden',
      }}
    >
      {/* ── NAV ────────────────────────────────────────────────────────────── */}
      <nav
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: `${COLORS.bg}e6`,
          backdropFilter: 'blur(12px)',
          borderBottom: `1px solid ${COLORS.border}`,
          padding: '0 24px',
        }}
      >
        <div
          style={{
            maxWidth: '1100px',
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: '60px',
          }}
        >
          {/* Logo */}
          <div
            style={{
              fontSize: '18px',
              fontWeight: 800,
              fontFamily: FONTS.display,
              color: COLORS.text,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: GRADIENT,
                flexShrink: 0,
              }}
            />
            BattleArena
          </div>

        </div>
      </nav>

      {/* ── HERO ───────────────────────────────────────────────────────────── */}
      <section
        style={{
          maxWidth: '1100px',
          margin: '0 auto',
          padding: wide ? '80px 24px 72px' : '48px 20px 52px',
          display: 'grid',
          gridTemplateColumns: wide ? '1fr 1fr' : '1fr',
          gap: wide ? '60px' : '40px',
          alignItems: 'center',
        }}
      >
        {/* Left: copy */}
        <motion.div
          {...fadeUp}
          transition={{ duration: 0.45, ease: 'easeOut' }}
        >
          {/* Badge */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              fontFamily: FONTS.mono,
              color: COLORS.green,
              border: `1px solid #14F19544`,
              borderRadius: '20px',
              padding: '5px 14px',
              marginBottom: '24px',
              background: '#14F1950a',
            }}
          >
            <span style={{ fontSize: '8px' }}>●</span> Built on Solana
          </div>

          {/* H1 */}
          <h1
            style={{
              fontSize: wide ? '46px' : '34px',
              fontWeight: 800,
              fontFamily: FONTS.display,
              lineHeight: 1.13,
              color: COLORS.text,
              margin: '0 0 20px',
              letterSpacing: '-0.01em',
            }}
          >
            Graded cards,<br />
            <GradientText>made playable.</GradientText>
          </h1>

          {/* Subheadline */}
          <p
            style={{
              fontSize: '16px',
              color: COLORS.muted,
              lineHeight: 1.7,
              margin: '0 0 32px',
              maxWidth: '480px',
            }}
          >
            Pull packs, duel, and battle with graded Collector Crypt NFTs.
            Card value gives an edge — skill and luck decide the winner.
            Trustless settlement on Solana.
          </p>

          {/* CTA row */}
          <div
            style={{
              display: 'flex',
              gap: '12px',
              flexWrap: 'wrap',
              marginBottom: '28px',
            }}
          >
            {/* Primary gradient button */}
            <motion.button
              onClick={onLaunch}
              whileTap={reduced ? undefined : { scale: 0.97 }}
              style={{
                background: GRADIENT,
                border: 'none',
                borderRadius: '10px',
                padding: '13px 28px',
                fontSize: '15px',
                fontWeight: 700,
                color: '#0b0e14',
                cursor: 'pointer',
                fontFamily: FONTS.body,
                letterSpacing: '.01em',
                boxShadow: '0 0 20px #9945FF33',
              }}
            >
              Launch App
            </motion.button>
          </div>

          {/* Chips */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            {['◆ Non-custodial', '◆ No seed phrase', '◆ Deposit from any chain'].map((chip) => (
              <span
                key={chip}
                style={{
                  fontSize: '12px',
                  fontFamily: FONTS.mono,
                  color: COLORS.muted,
                  background: COLORS.panel,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: '6px',
                  padding: '5px 12px',
                }}
              >
                {chip}
              </span>
            ))}
          </div>
        </motion.div>

        {/* Right: duel card panel */}
        <motion.div
          initial={reduced ? undefined : { opacity: 0, x: 20 }}
          animate={reduced ? undefined : { opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.15, ease: 'easeOut' }}
          style={{
            display: 'flex',
            justifyContent: wide ? 'flex-end' : 'center',
          }}
        >
          <DuelPanel wide={wide} />
        </motion.div>
      </section>

      {/* ── GAMES SECTION ──────────────────────────────────────────────────── */}
      <section
        style={{
          background: COLORS.panel,
          borderTop: `1px solid ${COLORS.border}`,
          borderBottom: `1px solid ${COLORS.border}`,
          padding: wide ? '72px 24px' : '52px 20px',
        }}
      >
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          {/* Eyebrow */}
          <motion.div
            {...fadeUp}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          >
            <div
              style={{
                fontSize: '11px',
                fontFamily: FONTS.mono,
                color: COLORS.violet,
                letterSpacing: '.12em',
                textTransform: 'uppercase',
                marginBottom: '12px',
              }}
            >
              Four ways to play
            </div>
            <h2
              style={{
                fontSize: wide ? '32px' : '26px',
                fontWeight: 800,
                fontFamily: FONTS.display,
                color: COLORS.text,
                margin: '0 0 12px',
                letterSpacing: '-0.01em',
              }}
            >
              A catalog of games on your cards
            </h2>
            <p
              style={{
                fontSize: '15px',
                color: COLORS.muted,
                lineHeight: 1.65,
                margin: '0 0 40px',
                maxWidth: '560px',
              }}
            >
              Skill, luck, or both — every game uses your graded NFTs as the playing piece.
            </p>
          </motion.div>

          {/* Games grid */}
          <motion.div
            initial={reduced ? undefined : { opacity: 0, y: 12 }}
            animate={reduced ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.1, ease: 'easeOut' }}
            style={{
              display: 'grid',
              gridTemplateColumns: wide ? 'repeat(4, 1fr)' : 'repeat(2, 1fr)',
              gap: '16px',
            }}
          >
            <GameCard
              icon="⚔️"
              title="Pack Battle"
              description="Both players open a pack; the winner takes both cards. Resolve by value or play it out."
              pill="WINNER TAKES ALL"
              onClick={onLaunch}
              reduced={reduced}
            />
            <GameCard
              icon="👑"
              title="Battle Royale"
              description="Up to 10 players open packs in rounds; lowest value falls; the last one standing takes the pot."
              pill="2–10 PLAYERS"
              onClick={onLaunch}
              reduced={reduced}
            />
            <GameCard
              icon="🎰"
              title="Gacha"
              description="Open Collector Crypt packs and jump straight into a battle with the card you pull."
              pill="PULL → PLAY"
              onClick={onLaunch}
              reduced={reduced}
            />
            <GameCard
              icon="🎯"
              title="Mana Duel"
              description="Hidden mana allocation across three fronts. Skill-first; card value gives a capped edge."
              pill="SKILL"
              onClick={onLaunch}
              reduced={reduced}
            />
          </motion.div>
        </div>
      </section>

      {/* ── TRUST BAND ─────────────────────────────────────────────────────── */}
      <section
        style={{
          padding: wide ? '72px 24px' : '52px 20px',
          background: `linear-gradient(135deg, #9945FF08 0%, #14F19508 100%)`,
        }}
      >
        <div
          style={{
            maxWidth: '1100px',
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: wide ? 'repeat(3, 1fr)' : '1fr',
            gap: wide ? '40px' : '28px',
          }}
        >
          {[
            {
              title: 'Trustless settlement',
              body: 'On-chain escrow and payout on Solana. You sign, the program pays — we never custody your funds.',
            },
            {
              title: 'Anti-manipulation',
              body: "Card edge comes from Collector Crypt's insuredValue, not prices a player can move.",
            },
            {
              title: 'Provably fair',
              body: "Every pull is powered by Collector Crypt's verifiable random function (VRF).",
            },
          ].map((item, i) => (
            <motion.div
              key={item.title}
              initial={reduced ? undefined : { opacity: 0, y: 10 }}
              animate={reduced ? undefined : { opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: i * 0.1, ease: 'easeOut' }}
              style={{
                background: COLORS.panel,
                border: `1px solid ${COLORS.border}`,
                borderRadius: '14px',
                padding: '24px 22px',
              }}
            >
              <div
                style={{
                  width: '32px',
                  height: '3px',
                  background: GRADIENT,
                  borderRadius: '2px',
                  marginBottom: '16px',
                }}
              />
              <div
                style={{
                  fontSize: '16px',
                  fontWeight: 700,
                  fontFamily: FONTS.display,
                  color: COLORS.text,
                  marginBottom: '10px',
                }}
              >
                {item.title}
              </div>
              <div
                style={{
                  fontSize: '14px',
                  color: COLORS.muted,
                  lineHeight: 1.65,
                }}
              >
                {item.body}
              </div>
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  )
}
