import { COLORS, FONTS } from '../../theme'

/** El dorso de una carta — y también su TAPA mientras gira.
 *
 *  Negro con el logo en blanco y negro. Se usa por las DOS caras durante el giro de una épica:
 *  al dar varias vueltas, la cara delantera pasa por delante del jugador varias veces, y si
 *  llevara la carta de verdad el giro sería un spoiler de lo que va a salir.
 *
 *  `accent` tiñe el borde y el halo (la rareza ya se ha anunciado con la franja, así que el color
 *  no destripa nada), `label` pone un estado abajo ("opening…") y `strong` sube el halo.
 *  `quietMark` NO lo esconde: lo baja a marca de agua. El reveal escribe año, grado y rareza por
 *  el centro de la carta, así que ahí el logo va más grande, muy tenue y por DEBAJO del texto —la
 *  carta se sigue reconociendo como la misma por las dos caras sin pelearse con lo que se lee. */
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
      <img
        src="/logo-rail.png" alt="" aria-hidden
        style={{
          // En escala de grises: es una marca, no un adorno con color propio que compita con el
          // acento de la rareza.
          filter: 'grayscale(1) brightness(1.5) contrast(.85)',
          userSelect: 'none', pointerEvents: 'none', height: 'auto',
          ...(quietMark
            // Detrás del texto del reveal: más grande y casi transparente, como una filigrana.
            ? { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
                width: Math.round(Math.min(width, height) * 0.62), opacity: 0.14, zIndex: 0 }
            : { width: Math.round(Math.min(width, height) * 0.44), opacity: 0.55, zIndex: 1 }),
        }}
      />
      {label && (
        <div style={{ position: 'absolute', bottom: 12, fontFamily: FONTS.mono, fontSize: 10, color: COLORS.muted, zIndex: 1 }}>{label}</div>
      )}
    </div>
  )
}
