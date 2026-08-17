import { COLORS, GRADIENT, FONTS } from '../../theme'
import { useReducedMotion } from '../../useReducedMotion'

// Se queda SOLO en botones. Antes traía rótulo, titular y descripción, y los tres estaban de más
// en el Lobby unificado: la guía de modos de arriba ya explica a qué se juega, y las tarjetas de
// abajo ya dicen qué hay abierto. Lo único que faltaba aquí era la acción.
//
// Y el botón dice "Create Match" a secas: el modo se elige dentro del modal, así que prometer
// "Create Pack Battle" con los dos modos a la vista sería mentir a medias.
const CTA = 'Create Match'

interface Props {
  onCreate: () => void
  /** When omitted, the free-demo link is hidden (e.g. Battle Royale has no demo). */
  onPlayDemo?: () => void
  /** When false, the create CTA is hidden (e.g. Battle Royale creation gated during launch). */
  canCreate?: boolean
}

export function QuickMatch({
  onCreate,
  onPlayDemo,
  canCreate = true,
}: Props) {
  const reducedMotion = useReducedMotion()
  return (
    <div style={{ padding: 'clamp(6px,1vw,14px) 2px' }}>
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
              <span style={{ position: 'relative', zIndex: 1 }}>{CTA}</span>
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
