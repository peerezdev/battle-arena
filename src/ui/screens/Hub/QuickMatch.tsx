import { COLORS, GRADIENT, FONTS } from '../../theme'
import { MOCK_STATS, STAKE_OPTIONS, type HubStat } from './hubMockData'
import { useIsWide } from '../../useIsWide'
import { useReducedMotion } from '../../useReducedMotion'

interface Props {
  stakes?: number[]
  selectedStake: number
  onStake: (n: number) => void
  onFindMatch: () => void
  onCreate: () => void
  stats?: HubStat[]
}

export function QuickMatch({
  stakes = STAKE_OPTIONS,
  selectedStake,
  onStake,
  onFindMatch,
  onCreate,
  stats = MOCK_STATS,
}: Props) {
  const wide = useIsWide('(min-width: 620px)')
  const reducedMotion = useReducedMotion()
  return (
    <div
      style={{
        borderRadius: 20,
        padding: 1,
        background: 'linear-gradient(120deg,#8b5cf655,#2fe28a33,transparent 70%)',
        marginBottom: 26,
      }}
    >
      <div
        style={{
          borderRadius: 19,
          background: 'linear-gradient(135deg,rgba(139,92,246,.16),rgba(13,17,22,.6) 42%,rgba(47,226,138,.10))',
          padding: '26px 16px',
          display: 'flex',
          flexDirection: wide ? 'row' : 'column',
          alignItems: wide ? 'center' : 'stretch',
          gap: wide ? 28 : 18,
          animation: reducedMotion ? 'none' : 'ba-glow 7s ease-in-out infinite',
        }}
      >
        {/* Left: content */}
        <div style={{ flex: 1 }}>
          {/* Kicker */}
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 10.5,
              letterSpacing: '0.18em',
              color: '#b78cff',
              textTransform: 'uppercase',
              marginBottom: 8,
            }}
          >
            Quick match
          </div>

          {/* Heading */}
          <h2
            style={{
              fontFamily: FONTS.display,
              fontWeight: 800,
              fontSize: 26,
              letterSpacing: '-0.01em',
              marginBottom: 8,
              color: COLORS.text,
            }}
          >
            Jump into a{' '}
            <span
              style={{
                background: GRADIENT,
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              Pack Battle
            </span>
          </h2>

          {/* Description */}
          <p
            style={{
              color: COLORS.muted,
              fontSize: 13,
              marginBottom: 18,
              maxWidth: 440,
            }}
          >
            Open a pack head-to-head — the higher pull takes both cards, or play it out in a Mana Duel.
          </p>

          {/* Stake chips */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
            {stakes.map((n) => {
              const active = n === selectedStake
              return (
                <button
                  key={n}
                  onClick={() => onStake(n)}
                  style={{
                    fontFamily: FONTS.display,
                    fontWeight: 700,
                    fontSize: 13,
                    border: `1px solid ${active ? '#2fe28a66' : COLORS.border}`,
                    borderRadius: 10,
                    padding: '9px 15px',
                    cursor: 'pointer',
                    color: active ? COLORS.green : COLORS.muted,
                    background: active ? '#2fe28a14' : 'transparent',
                  }}
                >
                  ${n}
                </button>
              )
            })}
          </div>

          {/* CTA row */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onFindMatch}
              style={{
                background: GRADIENT,
                color: '#06120c',
                border: 'none',
                borderRadius: 12,
                padding: '13px 24px',
                fontFamily: FONTS.display,
                fontWeight: 800,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Find match →
            </button>
            <button
              onClick={onCreate}
              style={{
                background: 'transparent',
                border: `1px solid ${COLORS.border}`,
                color: COLORS.text,
                borderRadius: 12,
                padding: '13px 22px',
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Create battle
            </button>
          </div>
        </div>

        {/* Right: VS visual + stats */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 22,
            paddingLeft: wide ? 24 : 0,
            paddingTop: wide ? undefined : 16,
            borderLeft: wide ? `1px solid ${COLORS.border}` : 'none',
            borderTop: wide ? undefined : `1px solid ${COLORS.border}`,
            width: wide ? 320 : '100%',
            flexShrink: 0,
          }}
        >
          {/* VS visual — two floating cards + badge */}
          <div style={{ position: 'relative', height: 196, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{
              ['--r' as string]: '-9deg', position: 'absolute', left: '15%', width: 116, height: 162, borderRadius: 15,
              background: 'linear-gradient(160deg,#15351f,#0c2418)', border: '1px solid rgba(47,226,138,.45)',
              boxShadow: '0 0 40px -12px rgba(47,226,138,.6),inset 0 1px 0 rgba(255,255,255,.12)',
              transform: 'rotate(-9deg)', animation: reducedMotion ? 'none' : 'ba-float 5s ease-in-out infinite',
            } as React.CSSProperties} />
            <div style={{
              ['--r' as string]: '9deg', position: 'absolute', right: '15%', width: 116, height: 162, borderRadius: 15,
              background: 'linear-gradient(160deg,#2a1f47,#160f2b)', border: '1px solid rgba(139,92,246,.5)',
              boxShadow: '0 0 40px -12px rgba(139,92,246,.6),inset 0 1px 0 rgba(255,255,255,.12)',
              transform: 'rotate(9deg)', animation: reducedMotion ? 'none' : 'ba-float 5s ease-in-out .6s infinite',
            } as React.CSSProperties} />
            <div style={{
              position: 'relative', zIndex: 2, width: 56, height: 56, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: FONTS.mono, fontSize: 17, fontWeight: 700, color: '#fff', background: '#0b0f14',
              border: '2px solid transparent', backgroundImage: `linear-gradient(#0b0f14,#0b0f14),${GRADIENT}`,
              backgroundOrigin: 'border-box', backgroundClip: 'padding-box,border-box',
              boxShadow: '0 0 30px -6px rgba(139,92,246,.7)',
            }}>VS</div>
          </div>

          {/* Stats row */}
          <div style={{ display: 'flex', gap: 10 }}>
            {stats.map((s) => (
              <div key={s.label} style={{ flex: 1, padding: '12px 13px', borderRadius: 14, background: '#ffffff08', border: `1px solid ${COLORS.border}` }}>
                <div
                  style={{
                    fontFamily: FONTS.display, fontWeight: 800, fontSize: 20,
                    ...(s.gradient
                      ? { background: GRADIENT, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }
                      : { color: COLORS.text }),
                  }}
                >
                  {s.value}
                </div>
                <div style={{ fontSize: 10.5, color: COLORS.muted, marginTop: 3 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
