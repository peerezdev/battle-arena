import { COLORS, FONTS } from '../../theme'

/** El dorso de una carta — y también su TAPA mientras gira.
 *
 *  Negro con el logo en blanco y negro. Se usa por las DOS caras durante el giro de una épica:
 *  al dar varias vueltas, la cara delantera pasa por delante del jugador varias veces, y si
 *  llevara la carta de verdad el giro sería un spoiler de lo que va a salir.
 *
 *  `accent` tiñe el borde y el halo (la rareza ya se ha anunciado con la franja, así que el color
 *  no destripa nada), `label` pone un estado abajo ("opening…") y `strong` sube el halo.
 *  `quietMark` esconde el logo: el reveal apilado escribe tres líneas por el centro de la carta
 *  y el logo chocaba con la de en medio. */
export function CardBack({ width, height, accent, label, strong = false, quietMark = false }: {
  width: number; height: number; accent: string; label?: string; strong?: boolean; quietMark?: boolean
}) {
  const glow = strong
    ? `0 0 46px -4px ${accent}, 0 0 18px -2px ${accent}, inset 0 0 30px -6px ${accent}, inset 0 0 36px #00000066`
    : `0 0 20px ${accent}33, inset 0 0 34px #00000077`
  return (
    <div style={{
      width, height, borderRadius: 12,
      border: strong ? `2px solid ${accent}` : `1px solid ${accent}66`,
      background: 'radial-gradient(circle at 50% 38%, #12151b, #05070a 74%)',
      boxShadow: glow,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
      position: 'relative', overflow: 'hidden',
      transition: 'border-color .35s ease, box-shadow .35s ease',
    }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(135deg,#ffffff08 0 2px,transparent 2px 11px)' }} />
      {!quietMark && (
        <img
          src="/logo-rail.png" alt="" aria-hidden
          style={{
            // En escala de grises y a media opacidad: es una marca de agua, no un adorno con
            // color propio que compita con el acento de la rareza.
            width: Math.round(Math.min(width, height) * 0.44), height: 'auto',
            filter: 'grayscale(1) brightness(1.5) contrast(.85)',
            opacity: 0.55, zIndex: 1, userSelect: 'none', pointerEvents: 'none',
          }}
        />
      )}
      {label && (
        <div style={{ position: 'absolute', bottom: 12, fontFamily: FONTS.mono, fontSize: 10, color: COLORS.muted, zIndex: 1 }}>{label}</div>
      )}
    </div>
  )
}
