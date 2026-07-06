import { useEffect, useState, type ReactNode } from 'react'
import { COLORS, FONTS, GRADIENT } from '../theme'

// First-visit onboarding: a Gimmighoul guide + speech bubble walks a new
// collector through the four things the app does (packs, battle, ranking).
// Purely presentational — the parent owns the "seen" flag and closes it.

type AccentKey = 'green' | 'pink' | 'amber'
const ACCENTS: Record<AccentKey, { accent: string; rgb: string }> = {
  green: { accent: '#00ffc4', rgb: '0,255,196' },
  pink:  { accent: '#ff2e97', rgb: '255,46,151' },
  amber: { accent: '#f5c542', rgb: '245,197,66' },
}

const svg = (children: ReactNode) => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
)
const ICONS = {
  logo: svg(<><rect x="3" y="5" width="12" height="16" rx="2.5" /><path d="M8.5 3H17a2.5 2.5 0 0 1 2.5 2.5V17" /><path d="m9 15 1.8-4.5L12.5 13l1.7-3.5L15 12" /></>),
  pack: svg(<><path d="M12 3v4" /><path d="M5 8.5 12 5l7 3.5V17l-7 3.5L5 17z" /><path d="M5 8.5 12 12l7-3.5" /><path d="M12 12v8.5" /></>),
  swords: svg(<><path d="M14.5 17.5 3 6V3h3l11.5 11.5" /><path d="m13 19 6-6" /><path d="m16 16 4 4" /><path d="m19 21 2-2" /><path d="M9.5 6.5 6.5 9.5" /></>),
  trophy: svg(<><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></>),
}

type Chip = { label: string; dot: AccentKey }
type Step = { icon: keyof typeof ICONS; kicker: string; title: string; body: string; accent: AccentKey; chips: Chip[] }

const STEPS: Step[] = [
  {
    icon: 'logo', kicker: 'WELCOME', accent: 'pink',
    title: 'Welcome to Collector Arena',
    body: 'The head-to-head card arena. Open real graded packs, battle other collectors, and keep the highest-value pulls.',
    chips: [{ label: 'REAL GRADED CARDS', dot: 'green' }, { label: 'WINNER TAKES ALL', dot: 'pink' }],
  },
  {
    icon: 'pack', kicker: 'STEP 1 · PACKS', accent: 'green',
    title: 'Open real graded packs',
    body: 'Head to Gacha, pick a machine, and rip authenticated graded cards. Watch the reveal live — then keep them or sell back instantly.',
    chips: [{ label: 'LIVE REVEAL', dot: 'green' }, { label: 'KEEP OR SELL', dot: 'amber' }],
  },
  {
    icon: 'swords', kicker: 'STEP 2 · BATTLE', accent: 'pink',
    title: 'Battle head-to-head',
    body: 'Jump into a Pack Battle (2–4) or a Battle Royale (5–10). Everyone opens at once — the highest pull takes the pot.',
    chips: [{ label: 'PACK BATTLE · 2–4', dot: 'pink' }, { label: 'ROYALE · 5–10', dot: 'green' }],
  },
  {
    icon: 'trophy', kicker: 'STEP 3 · RANKING', accent: 'amber',
    title: 'Climb the Ranking',
    body: 'Every win earns Gimmighouls and pushes you up the seasonal Ranking. Top collectors rise to the top of the board.',
    chips: [{ label: 'EARN GIMMIGHOULS', dot: 'amber' }, { label: 'SEASONAL RANKS', dot: 'green' }],
  },
]

export function OnboardingTutorial({ onClose, reducedMotion = false }: { onClose: () => void; reducedMotion?: boolean }) {
  const [step, setStep] = useState(0)
  const n = STEPS.length
  const cur = STEPS[step]
  const a = ACCENTS[cur.accent]
  const isLast = step === n - 1
  const anim = (s: string): string | undefined => (reducedMotion ? undefined : s)

  const goNext = () => { if (isLast) onClose(); else setStep(step + 1) }
  const goBack = () => setStep((s) => Math.max(0, s - 1))

  // Keyboard: →/Enter advance, ← back, Esc dismiss. Re-bound per step so the
  // handlers see the current index.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') goNext()
      else if (e.key === 'ArrowLeft') goBack()
      else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Getting started"
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        padding: '24px 24px 48px',
        background: 'rgba(3,5,8,.72)',
        backdropFilter: 'blur(9px)', WebkitBackdropFilter: 'blur(9px)',
      }}
    >
      {/* Mascot guide */}
      <div className="ob-mascot" style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 8, animation: anim('ob-in .5s cubic-bezier(.2,.9,.3,1)') }}>
        <img
          src="/gimmighoul3.png"
          alt=""
          style={{ width: 168, height: 190, objectFit: 'contain', filter: 'drop-shadow(0 22px 30px rgba(0,0,0,.55))', animation: anim('ob-float 3.2s ease-in-out infinite') }}
        />
        <span style={{ width: 118, height: 14, borderRadius: '50%', background: 'radial-gradient(ellipse at center,rgba(0,0,0,.6),transparent 70%)' }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 13px', borderRadius: 999, background: 'rgba(255,46,151,.14)', border: '1px solid rgba(255,46,151,.4)', fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.18em', color: '#ff86c2' }}>
          GIMMI · GUIDE
        </span>
      </div>

      {/* Speech bubble */}
      <div className="ob-bubble" style={{ position: 'relative', width: 480, maxWidth: 'calc(100% - 200px)', margin: '0 0 60px -6px', animation: anim('ob-in .45s cubic-bezier(.2,.9,.3,1)') }}>
        {/* tail */}
        <span style={{ position: 'absolute', left: -10, bottom: 50, width: 22, height: 22, transform: 'rotate(45deg)', background: 'linear-gradient(225deg,#101319,#0c0f15)', borderLeft: `1px solid ${COLORS.border}`, borderBottom: `1px solid ${COLORS.border}`, borderRadius: '0 0 0 6px' }} />

        <div style={{ borderRadius: 24, background: 'linear-gradient(180deg,#12151c,#0c0f15)', border: `1px solid ${COLORS.border}`, boxShadow: `0 40px 120px -30px rgba(0,0,0,.9), 0 0 90px -30px ${a.accent}55`, overflow: 'hidden' }}>

          {/* header: progress + counter + skip */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px 0' }}>
            <div style={{ display: 'flex', gap: 6, flex: 1 }}>
              {STEPS.map((s, i) => {
                const sa = ACCENTS[s.accent]
                return (
                  <button
                    key={i}
                    onClick={() => setStep(i)}
                    title={s.title}
                    aria-label={`Go to step ${i + 1}`}
                    style={{ height: 5, flex: 1, border: 0, padding: 0, borderRadius: 99, cursor: 'pointer', background: i <= step ? sa.accent : 'rgba(255,255,255,.1)', boxShadow: i === step ? `0 0 10px rgba(${sa.rgb},.7)` : 'none', transition: 'background .3s' }}
                  />
                )
              })}
            </div>
            <span style={{ fontFamily: FONTS.mono, fontSize: 10.5, letterSpacing: '.14em', color: '#5c6675', whiteSpace: 'nowrap' }}>{step + 1} / {n}</span>
            <button onClick={onClose} title="Skip tour" aria-label="Skip tour"
              style={{ width: 28, height: 28, borderRadius: 9, border: `1px solid ${COLORS.border}`, background: 'rgba(255,255,255,.03)', color: '#6c7682', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>

          {/* step body — re-keyed so the slide-in replays on each step */}
          <div key={step} style={{ padding: '26px 28px 0', animation: anim('ob-step .35s ease-out') }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
              <div style={{ position: 'relative', flex: 'none', width: 56, height: 56 }}>
                <span style={{ position: 'absolute', inset: 0, borderRadius: 18, border: `1px solid rgba(${a.rgb},.35)`, animation: anim('ob-ring 2.4s ease-out infinite') }} />
                <span style={{ position: 'absolute', inset: 0, borderRadius: 18, background: `linear-gradient(160deg, rgba(${a.rgb},.28), rgba(${a.rgb},.07))`, border: `1px solid rgba(${a.rgb},.45)`, boxShadow: `0 14px 40px -12px rgba(${a.rgb},.45), inset 0 1px 0 rgba(255,255,255,.12)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: a.accent }}>
                  {ICONS[cur.icon]}
                </span>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: FONTS.mono, fontSize: 10.5, letterSpacing: '.28em', color: a.accent, marginBottom: 6 }}>{cur.kicker}</div>
                <h2 style={{ margin: 0, fontSize: 23, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.15, color: COLORS.text }}>{cur.title}</h2>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: '#9aa4b2' }}>
              {cur.body}
              <span style={{ display: 'inline-block', width: 9, height: 15, marginLeft: 4, verticalAlign: -2, background: a.accent, animation: anim('ob-pulse 1s steps(2) infinite') }} />
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, minHeight: 30, flexWrap: 'wrap' }}>
              {cur.chips.map((ch, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 13px', borderRadius: 999, background: 'rgba(255,255,255,.045)', border: `1px solid ${COLORS.border}`, fontFamily: FONTS.mono, fontSize: 10.5, letterSpacing: '.08em', color: '#b8c0cb', whiteSpace: 'nowrap' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: ACCENTS[ch.dot].accent, boxShadow: `0 0 7px ${ACCENTS[ch.dot].accent}`, animation: anim('ob-pulse 2s infinite') }} />
                  {ch.label}
                </span>
              ))}
            </div>
          </div>

          {/* footer */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 22 }}>
            {step > 0 && (
              <button onClick={goBack}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '12px 18px', borderRadius: 13, border: `1px solid ${COLORS.border}`, background: 'rgba(255,255,255,.03)', color: '#cdd4dd', cursor: 'pointer', fontFamily: FONTS.body, fontSize: 14, fontWeight: 600 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>Back
              </button>
            )}
            <button onClick={onClose}
              style={{ padding: '12px 10px', border: 0, background: 'transparent', color: '#6c7682', cursor: 'pointer', fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '.12em' }}>SKIP TOUR</button>
            <span style={{ flex: 1 }} />
            <button onClick={goNext}
              style={{ position: 'relative', overflow: 'hidden', display: 'inline-flex', alignItems: 'center', gap: 9, padding: '13px 26px', borderRadius: 14, border: 0, cursor: 'pointer', fontFamily: FONTS.body, fontSize: 15, fontWeight: 700, color: '#06170f', background: GRADIENT, boxShadow: '0 12px 30px -12px rgba(0,255,196,.6)' }}>
              <span style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '40%', background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.45),transparent)', animation: anim('ob-sweep 3s infinite') }} />
              <span style={{ position: 'relative' }}>{isLast ? "Let's go" : 'Next'}</span>
              <svg style={{ position: 'relative' }} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
