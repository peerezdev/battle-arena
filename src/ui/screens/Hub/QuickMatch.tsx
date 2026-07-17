import { COLORS, GRADIENT, FONTS } from '../../theme'
import { useReducedMotion } from '../../useReducedMotion'

type QuickMode = 'pack' | 'royale'

const MODE_COPY: Record<QuickMode, { name: string; desc: string; cta: string }> = {
  pack: {
    name: 'Pack Battle',
    desc: 'Open a pack head-to-head — the higher pull takes both cards.',
    cta: 'Create Pack Battle',
  },
  royale: {
    name: 'Battle Royale',
    desc: 'Up to 10 players open packs in rounds — the lowest value drops each round. Last one standing takes the pot.',
    cta: 'Create Battle Royale',
  },
}

interface Props {
  mode?: QuickMode
  onCreate: () => void
  /** When omitted, the free-demo link is hidden (e.g. Battle Royale has no demo). */
  onPlayDemo?: () => void
  /** When false, the create CTA is hidden (e.g. Battle Royale creation gated during launch). */
  canCreate?: boolean
}

export function QuickMatch({
  mode = 'pack',
  onCreate,
  onPlayDemo,
  canCreate = true,
}: Props) {
  const reducedMotion = useReducedMotion()
  const copy = MODE_COPY[mode]
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
            {copy.name}
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
          {copy.desc}
        </p>

        {/* CTA row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          {canCreate && (
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
              <span style={{ position: 'relative', zIndex: 1 }}>{copy.cta}</span>
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
          )}
          {onPlayDemo && (
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
          )}
        </div>
    </div>
  )
}
