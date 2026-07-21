import { FONTS } from '../theme'

// Píldora que corona una carta.
//
// Nació como el "⚡ BEST PULL" del result de Pack Battle. Se saca aquí porque el resumen del
// gacha necesita la misma pieza para la rareza: si se copiara, cualquier ajuste visual acabaría
// aplicándose en un sitio y no en el otro, y son dos pantallas que el jugador ve seguidas.
//
// El color entra por parámetro porque el significado cambia: dorado para "la mejor", el color de
// la rareza cuando lo que se anuncia es la rareza.

export function CardBadge({ label, color, glow = true }: {
  label: string
  /** Color base de la píldora. El texto va oscuro encima, así que conviene un tono claro. */
  color: string
  glow?: boolean
}) {
  return (
    <span
      style={{
        position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', zIndex: 2,
        fontFamily: FONTS.mono, fontSize: 9, fontWeight: 700, letterSpacing: '.12em',
        color: '#12100a',
        background: `linear-gradient(90deg, ${color}, ${color}cc)`,
        borderRadius: 999, padding: '4px 10px', whiteSpace: 'nowrap',
        boxShadow: glow ? `0 4px 14px ${color}59` : undefined,
      }}
    >
      {label}
    </span>
  )
}
