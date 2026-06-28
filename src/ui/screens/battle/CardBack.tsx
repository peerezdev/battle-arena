import { COLORS, FONTS, GRADIENT } from '../../theme'

/** The back of a card — shown while waiting for a pull and during the staged (year/grade/
 *  rarity) reveal, before the flip. `accent` tints the glow; `label` shows a status (e.g. "abriendo…").
 *  `strong` ramps the glow up to a punchy rarity halo (like the Live Drops beam). */
export function CardBack({ width, height, accent, label, strong = false }: { width: number; height: number; accent: string; label?: string; strong?: boolean }) {
  const glow = strong
    ? `0 0 46px -4px ${accent}, 0 0 18px -2px ${accent}, inset 0 0 30px -6px ${accent}, inset 0 0 36px #00000066`
    : `0 0 20px ${accent}33, inset 0 0 34px #00000077`
  return (
    <div style={{
      width, height, borderRadius: 12,
      border: strong ? `2px solid ${accent}` : `1px solid ${accent}66`,
      background: 'radial-gradient(circle at 50% 36%, #1b2236, #0c1019 72%)',
      boxShadow: glow,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
      position: 'relative', overflow: 'hidden',
      transition: 'border-color .35s ease, box-shadow .35s ease',
    }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(135deg,#ffffff08 0 2px,transparent 2px 11px)' }} />
      <div style={{ width: 46, height: 46, borderRadius: 13, background: GRADIENT, boxShadow: `0 0 ${strong ? 28 : 18}px ${accent}${strong ? 'cc' : '88'}`, transform: 'rotate(45deg)' }} />
      <div style={{ fontFamily: FONTS.display, fontWeight: 900, fontSize: 12, letterSpacing: '.24em', color: COLORS.muted, zIndex: 1 }}>TCG</div>
      {label && (
        <div style={{ position: 'absolute', bottom: 12, fontFamily: FONTS.mono, fontSize: 10, color: COLORS.muted, zIndex: 1 }}>{label}</div>
      )}
    </div>
  )
}
