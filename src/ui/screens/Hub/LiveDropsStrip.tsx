import { COLORS, FONTS, formatUsd } from '../../theme'
import { useDrops } from '../../drops/useDrops'

/** Mobile-only horizontal Live Drops bar — sits at the top and scrolls sideways
 *  (the desktop dock shows them vertically). */
export function LiveDropsStrip() {
  const drops = useDrops()

  return (
    <div style={{
      flexShrink: 0, borderBottom: `1px solid ${COLORS.border}`, background: 'rgba(255,255,255,.015)',
      padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10,
      overflowX: 'auto', overflowY: 'hidden', whiteSpace: 'nowrap',
    }}>
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 7,
        fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.16em', color: COLORS.muted,
      }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: COLORS.green, boxShadow: `0 0 8px ${COLORS.green}` }} />
        DROPS
      </div>

      {drops.length === 0 ? (
        <span style={{ fontSize: 11, color: COLORS.muted }}>No drops yet — open a pack.</span>
      ) : (
        drops.map((d) => (
          <div key={d.id} style={{
            flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 11px 6px 6px', borderRadius: 11, background: '#ffffff08', border: `1px solid ${COLORS.border}`,
          }}>
            <span style={{ flex: 'none', width: 26, height: 34, borderRadius: 5, overflow: 'hidden', background: '#0c1019', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {d.image ? <img src={d.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 14 }}>🃏</span>}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.text, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</div>
              <div style={{ fontFamily: FONTS.display, fontSize: 12, fontWeight: 800, color: COLORS.green }}>
                {d.valueUsd != null ? formatUsd(d.valueUsd) : '—'}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
