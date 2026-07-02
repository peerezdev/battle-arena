import { COLORS, GRADIENT, FONTS } from '../../theme'
import { STAKE_OPTIONS } from './hubMockData'
import { useReducedMotion } from '../../useReducedMotion'

interface Props {
  stakes?: number[]
  selectedStake: number
  onStake: (n: number) => void
  onCreate: () => void
  onPlayDemo: () => void
}

export function QuickMatch({
  stakes = STAKE_OPTIONS,
  selectedStake,
  onStake,
  onCreate,
  onPlayDemo,
}: Props) {
  const reducedMotion = useReducedMotion()
  return (
    <div style={{ padding: 'clamp(6px,1vw,14px) 2px' }}>
        {/* Kicker */}
        <div
          style={{
            fontFamily: FONTS.mono,
            fontSize: 10.5,
            letterSpacing: '0.18em',
            color: COLORS.violet,
            textTransform: 'uppercase',
            marginBottom: 10,
          }}
        >
          Quick match
        </div>

        {/* Heading */}
        <h2
          style={{
            fontFamily: FONTS.display,
            fontWeight: 800,
            fontSize: 32,
            letterSpacing: '-0.01em',
            marginBottom: 10,
            color: COLORS.text,
            maxWidth: 520,
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
            fontSize: 13.5,
            marginBottom: 22,
            maxWidth: 460,
          }}
        >
          Open a pack head-to-head — the higher pull takes both cards, or play it out in a Mana Duel.
        </p>

        {/* Stake chips */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
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
                  border: `1px solid ${active ? '#00ffc466' : COLORS.border}`,
                  borderRadius: 10,
                  padding: '9px 15px',
                  cursor: 'pointer',
                  color: active ? COLORS.green : COLORS.muted,
                  background: active ? '#00ffc414' : 'transparent',
                }}
              >
                ${n}
              </button>
            )
          })}
        </div>

        {/* CTA row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <button
            onClick={onCreate}
            style={{
              position: 'relative',
              overflow: 'hidden',
              background: GRADIENT,
              color: '#06120c',
              border: 'none',
              borderRadius: 12,
              padding: '14px 28px',
              fontFamily: FONTS.display,
              fontWeight: 800,
              fontSize: 14.5,
              cursor: 'pointer',
            }}
          >
            <span style={{ position: 'relative', zIndex: 1 }}>Create battle</span>
            <span
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(100deg,transparent,rgba(255,255,255,.55),transparent)',
                animation: reducedMotion ? 'none' : 'ba-sweep 3.4s infinite',
              }}
            />
          </button>
          <button
            onClick={onPlayDemo}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: `1px dashed ${COLORS.muted}`,
              color: COLORS.muted,
              padding: '2px 0',
              fontFamily: FONTS.body,
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            or try a free demo →
          </button>
        </div>
    </div>
  )
}
