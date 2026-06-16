import { COLORS, GRADIENT, FONTS } from '../../theme'
import { MOCK_STATS, STAKE_OPTIONS, type HubStat } from './hubMockData'

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
  return (
    <div
      style={{
        borderRadius: 20,
        padding: 1,
        background: 'linear-gradient(120deg,#9945FF55,#14F19533,transparent 70%)',
        marginBottom: 26,
      }}
    >
      <div
        style={{
          borderRadius: 19,
          background: 'radial-gradient(120% 140% at 0% 0%,#1a1838,#0e1320 60%)',
          padding: '26px 28px',
          display: 'flex',
          alignItems: 'center',
          gap: 28,
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
                    border: `1px solid ${active ? '#14F19566' : COLORS.border}`,
                    borderRadius: 10,
                    padding: '9px 15px',
                    cursor: 'pointer',
                    color: active ? COLORS.green : COLORS.muted,
                    background: active ? '#14F19514' : 'transparent',
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

        {/* Right: stats */}
        <div
          style={{
            display: 'flex',
            gap: 22,
            paddingLeft: 24,
            borderLeft: `1px solid ${COLORS.border}`,
          }}
        >
          {stats.map((s) => (
            <div key={s.label}>
              <div
                style={{
                  fontFamily: FONTS.display,
                  fontWeight: 800,
                  fontSize: 22,
                  ...(s.gradient
                    ? {
                        background: GRADIENT,
                        WebkitBackgroundClip: 'text',
                        backgroundClip: 'text',
                        color: 'transparent',
                      }
                    : { color: COLORS.text }),
                }}
              >
                {s.value}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: COLORS.muted,
                  letterSpacing: '0.05em',
                  marginTop: 2,
                }}
              >
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
