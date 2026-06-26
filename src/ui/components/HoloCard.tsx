import { useReducedMotion } from '../useReducedMotion'

/**
 * HoloCard — wraps a card image in a holographic "foil" effect that works on ANY card art.
 * A prismatic gradient blended with `mix-blend-mode` reacts to the card's own colors (so every
 * card shimmers differently), a specular highlight sweeps across, and a rarity-tinted glow frames
 * it. Intensity scales with rarity; commons barely shimmer, legendaries go full rainbow.
 */
const INTENSITY: Record<string, number> = {
  common: 0.16,
  uncommon: 0.32,
  rare: 0.48,
  epic: 0.64,
  legendary: 0.82,
  mythic: 0.82,
}

export function HoloCard({ src, alt, rarity, accent, radius = 12, imgStyle, style }: {
  src: string
  alt?: string
  rarity?: string | null
  accent: string
  radius?: number
  imgStyle?: React.CSSProperties
  style?: React.CSSProperties
}) {
  const reduced = useReducedMotion()
  const intensity = INTENSITY[(rarity ?? '').toLowerCase()] ?? 0.32

  return (
    <div style={{
      position: 'relative', overflow: 'hidden', borderRadius: radius, lineHeight: 0, background: '#0c1019',
      border: `1px solid ${accent}66`,
      boxShadow: `0 0 30px -8px ${accent}, inset 0 0 0 1px ${accent}22`,
      ...style,
    }}>
      <img src={src} alt={alt} style={{ display: 'block', width: '100%', ...imgStyle }} />

      {/* prismatic foil — blends with the card's own colors, so every card looks unique */}
      <span aria-hidden style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'linear-gradient(115deg, transparent 22%, rgba(255,92,170,.6) 37%, rgba(92,196,255,.6) 50%, rgba(120,255,170,.6) 63%, rgba(255,224,120,.6) 76%, transparent 88%)',
        backgroundSize: '220% 220%', mixBlendMode: 'overlay', opacity: intensity,
        animation: reduced ? 'none' : 'ba-holo 7s linear infinite',
      }} />

      {/* moving specular highlight (skipped under reduced motion) */}
      {!reduced && (
        <span aria-hidden style={{
          position: 'absolute', top: 0, bottom: 0, left: 0, width: '45%', pointerEvents: 'none',
          background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.5),transparent)',
          mixBlendMode: 'color-dodge', opacity: Math.min(0.9, intensity + 0.22),
          animation: 'ba-sweep 5s ease-in-out infinite',
        }} />
      )}
    </div>
  )
}
