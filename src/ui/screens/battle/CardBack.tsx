import { COLORS, FONTS, GRADIENT } from '../../theme'

/** The back of a card — shown during the staged (year/grade/rarity) reveal, before the flip.
 *  `accent` tints the glow by rarity. */
export function CardBack({ width, height, accent }: { width: number; height: number; accent: string }) {
  return (
    <div style={{
      width, height, borderRadius: 12,
      border: `1px solid ${accent}66`,
      background: 'radial-gradient(circle at 50% 36%, #1b2236, #0c1019 72%)',
      boxShadow: `0 0 20px ${accent}33, inset 0 0 34px #00000077`,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(135deg,#ffffff08 0 2px,transparent 2px 11px)' }} />
      <div style={{ width: 46, height: 46, borderRadius: 13, background: GRADIENT, boxShadow: `0 0 18px ${accent}88`, transform: 'rotate(45deg)' }} />
      <div style={{ fontFamily: FONTS.display, fontWeight: 900, fontSize: 12, letterSpacing: '.24em', color: COLORS.muted, zIndex: 1 }}>TCG</div>
    </div>
  )
}
