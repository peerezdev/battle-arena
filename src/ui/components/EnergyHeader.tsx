import { COLORS, FONTS } from '../theme'

interface Props {
  available: number
  unassigned: number
  winsA: number
  winsB: number
  /** Energy breakdown for display (from real state) */
  base: number
  edge: number
  banked: number
  playerColor: string
}

export function EnergyHeader({ available, unassigned, winsA, winsB, base, edge, banked, playerColor }: Props) {
  // Build breakdown string: "10 base + 2 edge + 3 bancado" (omit zeroes)
  const parts: string[] = []
  if (base > 0) parts.push(`${base} base`)
  if (edge > 0) parts.push(`${edge} edge`)
  if (banked > 0) parts.push(`${banked} bancado`)
  const breakdown = parts.length > 0 ? parts.join(' + ') : '—'

  const box = {
    background: COLORS.panel,
    border: `1px solid ${COLORS.border}`,
    borderRadius: '6px',
    padding: '6px',
    textAlign: 'center' as const,
  }

  return (
    <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
      <div style={{ ...box, flex: 1 }}>
        <div style={{ fontSize: '9px', color: COLORS.muted, letterSpacing: '.06em', marginBottom: '2px', fontFamily: FONTS.mono }}>DISPONIBLE</div>
        <div style={{ fontSize: '22px', fontWeight: 800, color: playerColor, lineHeight: 1, fontFamily: FONTS.orbitron }}>{available}</div>
        <div style={{ fontSize: '9px', color: COLORS.muted, marginTop: '2px', fontFamily: FONTS.mono }}>{breakdown}</div>
      </div>
      <div style={{ ...box, flex: 1 }}>
        <div style={{ fontSize: '9px', color: COLORS.muted, letterSpacing: '.06em', marginBottom: '2px', fontFamily: FONTS.mono }}>SIN ASIGNAR</div>
        <div style={{ fontSize: '22px', fontWeight: 800, color: COLORS.text, lineHeight: 1, fontFamily: FONTS.orbitron }}>{unassigned}</div>
      </div>
      <div style={{ ...box, flex: 1 }}>
        <div style={{ fontSize: '9px', color: COLORS.muted, letterSpacing: '.06em', marginBottom: '2px', fontFamily: FONTS.mono }}>RONDAS</div>
        <div style={{ fontSize: '20px', fontWeight: 800, color: COLORS.text, lineHeight: 1, fontFamily: FONTS.orbitron }}>
          <span style={{ color: COLORS.green }}>{winsA}</span>
          <span style={{ color: COLORS.muted }}> – </span>
          <span style={{ color: COLORS.red }}>{winsB}</span>
        </div>
      </div>
    </div>
  )
}
