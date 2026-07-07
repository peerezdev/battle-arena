import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FONTS } from '../../theme'
import { NAV_ROUTES } from '../../layouts/navRoutes'

// Home body: the three game modes as a numbered vertical stack with connector
// lines, each routing straight into its mode. Order mirrors the mockup —
// Royale → Pack → Gacha — loudest to calmest.

interface ModeSection {
  n: string
  name: string
  tag: string
  desc: string
  cta: string
  to: string
  rgb: string       // accent as "r,g,b" for tints
  title: string     // title colour
  ctaBg: string
  ctaHover: string
  ctaText: string
}

const SECTIONS: ModeSection[] = [
  {
    n: '01', name: 'Battle Royale', tag: '2–10 PLAYERS', to: NAV_ROUTES.royale,
    desc: 'Up to 10 players open packs in rounds. The lowest value drops each round — outlast everyone and the whole pot is yours.',
    cta: 'Enter the Royale', rgb: '255,46,126', title: '#ff6ba4', ctaBg: '#ff2e7e', ctaHover: '#ff4d92', ctaText: '#fff',
  },
  {
    n: '02', name: 'Pack Battle', tag: '1V1 · WINNER TAKES ALL', to: NAV_ROUTES.pack,
    desc: 'The classic duel. You and one rival open the same pack — the higher pull walks away with both cards.',
    cta: 'Find a rival', rgb: '60,232,168', title: '#3ce8a8', ctaBg: '#3ce8a8', ctaHover: '#5cf0bb', ctaText: '#06170f',
  },
  {
    n: '03', name: 'Gacha', tag: 'PULL → PLAY', to: NAV_ROUTES.gacha,
    desc: 'No opponents needed. Open Collector Crypt packs solo, then take your best pull straight into battle.',
    cta: 'Spin the Gacha', rgb: '122,110,255', title: '#a99bff', ctaBg: '#7a6eff', ctaHover: '#8f84ff', ctaText: '#fff',
  },
]

// Text bridges shown between sections (index i sits after SECTIONS[i]).
const CONNECTORS = [
  'Too much chaos? Take it one rival at a time.',
  'Or skip the matchmaking — pull solo and battle whatever you hit.',
]

function ModeCta({ s }: { s: ModeSection }) {
  const [hover, setHover] = useState(false)
  return (
    <Link
      to={s.to}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-block', padding: '11px 20px', borderRadius: 11,
        background: hover ? s.ctaHover : s.ctaBg, color: s.ctaText,
        fontFamily: FONTS.body, fontSize: 14, fontWeight: 700, textDecoration: 'none',
        transition: 'background .14s',
      }}
    >
      {s.cta} →
    </Link>
  )
}

export function ModeSections() {
  return (
    <div style={{ padding: 'clamp(28px,4vw,56px) clamp(16px,3vw,32px) 48px' }}>
      <div style={{ width: '100%' }}>
        {SECTIONS.map((s, i) => (
          <div key={s.n}>
            <section style={{
              position: 'relative', overflow: 'hidden', borderRadius: 18,
              background: '#0c0f15', border: `1px solid rgba(${s.rgb},.28)`,
              padding: 'clamp(22px,3vw,30px) clamp(22px,3.4vw,34px)',
            }}>
              <span aria-hidden style={{
                position: 'absolute', top: -26, right: 10, pointerEvents: 'none',
                fontFamily: FONTS.mono, fontSize: 110, fontWeight: 700, color: `rgba(${s.rgb},.09)`,
              }}>{s.n}</span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', marginBottom: 10 }}>
                <span style={{ fontSize: 24, fontWeight: 700, color: s.title }}>{s.name}</span>
                <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: '#7a8492' }}>{s.tag}</span>
              </div>
              <p style={{ margin: '0 0 18px', maxWidth: 440, fontSize: 14.5, lineHeight: 1.6, color: '#aab3bf' }}>{s.desc}</p>
              <ModeCta s={s} />
            </section>

            {i < CONNECTORS.length && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 18, margin: 'clamp(22px,3vw,34px) 0' }}>
                <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.14))' }} />
                <p style={{ margin: 0, maxWidth: 400, textAlign: 'center', fontSize: 15, lineHeight: 1.55, color: '#8b95a3' }}>{CONNECTORS[i]}</p>
                <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,rgba(255,255,255,.14),transparent)' }} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
