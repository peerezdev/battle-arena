import { useRadio } from '../radio/useRadio'
import { COLORS, FONTS } from '../theme'

const VIOLET = '#a98bff'

const ctrlBtn: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 10, border: 0, flex: 'none',
  background: 'rgba(255,255,255,.08)', color: '#eef2f6', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
}

/**
 * Mobile mini-player — the compact radio card that sits above the bottom nav.
 * Shares the singleton radio store with the desktop header RadioPlayer, so
 * playback survives breakpoint changes and navigation.
 */
export function MobileRadioBar() {
  const radio = useRadio()
  if (radio.tracks.length === 0) return null

  const playing = radio.isPlaying
  const title = radio.track?.title ?? '—'

  // Collapsed → the bar is gone; a small floating button (right, above the nav)
  // brings it back. A green dot signals playback continues while hidden.
  if (radio.collapsed) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '0 12px 8px' }}>
        <button type="button" aria-label="Abrir radio" onClick={() => radio.setCollapsed(false)} style={{
          position: 'relative', width: 44, height: 44, borderRadius: '50%', flex: 'none', padding: 0, cursor: 'pointer',
          border: '1px solid rgba(139,92,246,.42)', background: 'rgba(29,17,46,.92)', color: VIOLET,
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 10px 26px -10px rgba(0,0,0,.7), 0 0 18px -6px rgba(169,139,255,.5)',
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
            <path d="M7.8 7.8a6 6 0 0 0 0 8.4" /><path d="M16.2 7.8a6 6 0 0 1 0 8.4" />
            <path d="M5 5a10 10 0 0 0 0 14" /><path d="M19 5a10 10 0 0 1 0 14" />
          </svg>
          {playing && <span aria-hidden style={{ position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: '50%', background: COLORS.green, boxShadow: `0 0 7px ${COLORS.green}` }} />}
        </button>
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, margin: '0 10px 8px', padding: '9px 12px',
      borderRadius: 14, background: 'rgba(29,17,46,.92)', border: '1px solid rgba(139,92,246,.4)',
      backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
    }}>
      {/* status glyph — equalizer while playing, play triangle while paused */}
      {playing ? (
        <span aria-hidden style={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, height: 12, flex: 'none' }}>
          {[0, 0.2, 0.4].map((d, i) => (
            <span key={i} style={{ width: 2.5, height: '100%', background: VIOLET, borderRadius: 2, transformOrigin: 'bottom', animation: 'ca-eq 1s ease-in-out infinite', animationDelay: `${d}s` }} />
          ))}
        </span>
      ) : (
        <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill={VIOLET} style={{ flex: 'none' }}><path d="M8 5v14l11-7z" /></svg>
      )}

      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.25 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: VIOLET }}>ARENA RADIO · {playing ? 'LIVE' : 'PAUSED'}</div>
      </div>

      <button type="button" aria-label={playing ? 'Pausar' : 'Reproducir'} onClick={radio.toggle} style={ctrlBtn}>
        {playing
          ? <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
          : <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>}
      </button>
      <button type="button" aria-label="Siguiente" onClick={radio.next} style={ctrlBtn}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
      </button>
      <button type="button" aria-label="Ocultar radio" onClick={() => radio.setCollapsed(true)}
        style={{ ...ctrlBtn, width: 30, background: 'rgba(169,139,255,.16)', color: VIOLET }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </div>
  )
}
