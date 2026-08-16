import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FONTS } from '../../theme'
import { NAV_ROUTES } from '../../layouts/navRoutes'

import { NAV_ICONS } from './LeftRail'
import type { HubNav } from './hubMockData'

// Home body: the three game modes as a numbered vertical stack with connector
// lines, each routing straight into its mode. Order mirrors the mockup —
// Royale → Pack → Gacha — loudest to calmest.

interface ModeSection {
  n: string
  nav: HubNav       // which navbar icon to watermark alongside the number
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
    n: '', nav: 'royale', name: 'The first Battle Royale with NFT cards in history is now available…', tag: '', to: '/play/lobby?mode=royale',
    desc: '10 players… 9 rounds… 1 single winner…\n\nThe last one standing takes the ENTIRE pot that all 10 players build up during the 9 rounds, a total of 54 graded cards.\n\nDon’t worry if you still don’t get it, the best way for you to understand it is to see it for yourself, that’s why I’ve got a demo ready for you.\n\nThere’s only one game per day, don’t miss your spot… if there’s even a spot left by then, of course.',
    cta: 'Enter the Royale', rgb: '255,46,126', title: '#ff6ba4', ctaBg: '#ff2e7e', ctaHover: '#ff4d92', ctaText: '#fff',
  },
  {
    n: '', nav: 'pack', name: 'Pack Battle', tag: '', to: '/play/lobby?mode=pack',
    desc: 'Very simple, very easy, these are quick matches for 2 to 4 players.\n\nPlayers open one or more packs at the same time and whoever gets the highest accumulated value takes all the cards.\n\nBut that’s not all…\n\nYOU’VE GOT FUCKING EMOTES.\n\nYou pull a trash card? You don’t even have to cry yourself, Squirtle will do it for you.\n\nIf you’re not the crying type but you’re definitely the raging type, don’t worry, Charmander will rage for you.\n\nAnd there are a few more that are going to blow your mind… But careful, the only way to try them is by playing a match.',
    cta: 'I want to see those emotes', rgb: '60,232,168', title: '#3ce8a8', ctaBg: '#3ce8a8', ctaHover: '#5cf0bb', ctaText: '#06170f',
  },
  {
    n: '', nav: 'gacha', name: 'Gacha', tag: '', to: NAV_ROUTES.gacha,
    desc: 'I’m not explaining anything here.\n\nBecause if you don’t know what gacha is, you’re better off leaving fast before you find out… it’s way too addictive.\n\nIf you already know what it is… I’m sorry, it’s already too late for you…',
    cta: 'One Pull Won’t Hurt… ', rgb: '122,110,255', title: '#a99bff', ctaBg: '#7a6eff', ctaHover: '#8f84ff', ctaText: '#fff',
  },
]

// Text bridges shown between sections (index i sits after SECTIONS[i]).
const CONNECTORS = [
  'What the hell is up with you, bro? What kind of problem do you have with our Battle Royale?\n\nWell… I’ve still got more shit for you, pay attention.',
  'Still scrolling? WTF bro… What the fuck are you looking for… Mimikyu?\n\nFine, I’ve still got one last bullet.',
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
              {/* watermark cluster — the mode's navbar icon + big number, faint accent.
                  The icon uses a SOLID colour + group opacity (not a low-alpha stroke): its
                  many overlapping stroke paths would otherwise compound alpha at crossings and
                  read as darker "layered" patches. Opacity flattens the icon, then fades once. */}
              <span aria-hidden style={{
                position: 'absolute', top: -20, right: 10, pointerEvents: 'none',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <span style={{ display: 'inline-flex', width: 60, height: 60, alignItems: 'center', justifyContent: 'center', color: `rgb(${s.rgb})`, opacity: 0.16 }}>
                  <span style={{ display: 'inline-flex', transform: 'scale(2.6)' }}>{NAV_ICONS[s.nav]}</span>
                </span>
                <span style={{ fontFamily: FONTS.mono, fontSize: 96, fontWeight: 700, lineHeight: 1, color: `rgba(${s.rgb},.13)` }}>{s.n}</span>
              </span>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', marginBottom: 10 }}>
                <span style={{ fontSize: 24, fontWeight: 700, color: s.title }}>{s.name}</span>
                <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: '#7a8492' }}>{s.tag}</span>
              </div>
              <p style={{ position: 'relative', margin: '0 0 18px', fontSize: 14.5, lineHeight: 1.6, color: '#aab3bf', whiteSpace: 'pre-line' }}>{s.desc}</p>
              <ModeCta s={s} />
            </section>

            {i < CONNECTORS.length && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 18, margin: 'clamp(22px,3vw,34px) 0' }}>
                <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.14))' }} />
                <p style={{ margin: 0, maxWidth: 700, textAlign: 'center', fontSize: 15, lineHeight: 1.55, color: '#8b95a3', whiteSpace: 'pre-line' }}>{CONNECTORS[i]}</p>
                <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,rgba(255,255,255,.14),transparent)' }} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}