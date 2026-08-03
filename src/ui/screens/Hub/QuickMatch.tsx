import { COLORS, GRADIENT, FONTS } from '../../theme'
import { useReducedMotion } from '../../useReducedMotion'

type QuickMode = 'pack' | 'royale'

// `kicker` y `desc` son opcionales: en Battle Royale este bloque va justo DEBAJO de
// RoyaleDemoNotice, que ya presenta el modo y pide ver la demo antes de pagar. Repetir aquí el
// rótulo y la descripción era decir lo mismo dos veces en la misma pantalla, así que el royale se
// queda solo con el titular.
const MODE_COPY: Record<QuickMode, { name: string; lead: string; kicker?: string; desc?: string; cta: string }> = {
  pack: {
    name: 'Pack Battle',
    lead: 'Jump into a',
    kicker: 'Quick match',
    desc: 'Open a pack head-to-head — the higher pull takes both cards.',
    cta: 'Create Pack Battle',
  },
  royale: {
    name: 'Battle Royale',
    // "the next" y no "a": aquí abajo están los lobbies abiertos, así que se entra al siguiente,
    // no a uno cualquiera.
    lead: 'Jump into the next',
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
        {copy.kicker && (
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
            {copy.kicker}
          </div>
        )}

        {/* Heading */}
        <h2
          style={{
            fontFamily: FONTS.display,
            fontWeight: 800,
            fontSize: 32,
            letterSpacing: '-0.01em',
            marginBottom: copy.desc ? 10 : 22,
            color: COLORS.text,
            maxWidth: 520,
          }}
        >
          {copy.lead}{' '}
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
        {copy.desc && (
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
        )}

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
