import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useRadio } from '../radio/useRadio'
import { useIsWide } from '../useIsWide'
import { COLORS, FONTS } from '../theme'

const AC = COLORS.green                                   // accent (eq / live / volume)
const DISC = `conic-gradient(from 0deg, ${COLORS.green}, ${COLORS.violet}, ${COLORS.green})`
const TOGGLE_BG = 'linear-gradient(135deg,#5cffd8,#00c79a)'  // green play button

const iconBtn: React.CSSProperties = {
  width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
  border: 0, background: 'transparent', color: '#9aa4b2', cursor: 'pointer', borderRadius: 9, padding: 0,
}

// Speaker icon reactive to level: 0 → muted (X), low → 1 wave, high → 2 waves.
function SpeakerIcon({ level, muted }: { level: number; muted: boolean }) {
  const off = muted || level <= 0
  return (
    <svg width="17" height="17" viewBox="0 0 24 24">
      <path d="M3 10v4h3l4 4V6L6 10H3z" fill="currentColor" />
      {off ? (
        <path d="M15 10l5 5M20 10l-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      ) : (
        <>
          <path d="M14 9.5a4 4 0 0 1 0 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          {level >= 55 && <path d="M16.5 7a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
        </>
      )}
    </svg>
  )
}

export function RadioPlayer() {
  const radio = useRadio()
  const wide = useIsWide('(min-width: 760px)')
  const [open, setOpen] = useState(false)     // station list
  const [volOpen, setVolOpen] = useState(false)

  if (radio.tracks.length === 0) return null

  const title = radio.track?.title ?? '—'
  const playing = radio.isPlaying
  const pct = Math.round(radio.volume * 100)
  const muted = radio.volume <= 0

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 11, padding: '6px 8px', borderRadius: 14, background: 'rgba(255,255,255,.045)', border: `1px solid ${COLORS.border}`, color: COLORS.text }}>
      {/* Artwork (desktop) — spinning disc + equalizer */}
      {wide && (
        <span style={{ position: 'relative', flex: 'none', display: 'inline-flex' }}>
          <span style={{ width: 34, height: 34, borderRadius: '50%', background: DISC, boxShadow: `0 0 14px -4px ${AC}99, inset 0 0 0 1px rgba(255,255,255,.12)`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', animation: 'ca-spin 6s linear infinite', animationPlayState: playing ? 'running' : 'paused' }}>
            <span style={{ width: '34%', height: '34%', borderRadius: '50%', background: '#0a0d12', border: '1.5px solid rgba(255,255,255,.3)' }} />
          </span>
          <span style={{ position: 'absolute', bottom: -2, right: -3, display: 'inline-flex', alignItems: 'flex-end', gap: 2, height: 9, padding: 2, borderRadius: 6, background: '#0a0d12' }}>
            {[0, 0.13, 0.26].map((d, i) => (
              <i key={i} style={{ width: 2, height: 9, borderRadius: 2, background: AC, transformOrigin: 'bottom', display: 'block', animation: 'ca-eq .9s ease-in-out infinite', animationDelay: `${d}s`, animationPlayState: playing ? 'running' : 'paused', transform: playing ? undefined : 'scaleY(.3)', opacity: playing ? 1 : 0.4 }} />
            ))}
          </span>
        </span>
      )}

      {/* Meta — LIVE label (desktop) + fixed-width track name (so it never resizes the widget) */}
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, minWidth: 0 }}>
        {wide && <span style={{ fontFamily: FONTS.mono, fontSize: 8.5, letterSpacing: '.16em', color: AC }}>● EN VIVO</span>}
        <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: wide ? 104 : 68 }}>{title}</span>
      </div>

      {wide && <span style={{ width: 1, height: 26, background: COLORS.border, margin: '0 2px' }} />}

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {wide && (
          <button type="button" aria-label="Anterior" onClick={radio.prev} style={iconBtn}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zM20 5v14l-11-7z" /></svg>
          </button>
        )}
        <button type="button" aria-label={playing ? 'Pausar' : 'Reproducir'} onClick={radio.toggle}
          style={{ ...iconBtn, width: 34, height: 34, borderRadius: 10, color: '#06170f', background: TOGGLE_BG, boxShadow: `0 0 18px -6px ${AC}` }}>
          {playing
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>}
        </button>
        <button type="button" aria-label="Siguiente" onClick={radio.next} style={iconBtn}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 5l11 7-11 7z" /></svg>
        </button>

        {/* Volume — speaker toggles a small popover with the slider (closes on mouse leave) */}
        <span style={{ position: 'relative', display: 'inline-flex' }} onMouseLeave={() => setVolOpen(false)}>
          <button type="button" aria-label="Volumen" onClick={() => setVolOpen((o) => !o)} style={iconBtn}>
            <SpeakerIcon level={pct} muted={muted} />
          </button>
          {volOpen && (
            <span style={{ position: 'absolute', top: 'calc(100% + 9px)', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 9, padding: '10px 13px', borderRadius: 12, background: '#10151d', border: `1px solid ${COLORS.border}`, boxShadow: '0 16px 34px -12px rgba(0,0,0,.8)', zIndex: 140, whiteSpace: 'nowrap' }}>
              <input type="range" aria-label="Nivel de volumen" min={0} max={100} value={pct}
                onChange={(e) => radio.setVolume(Number(e.target.value) / 100)}
                style={{ width: 92, accentColor: AC, cursor: 'pointer' }} />
              <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: '#9aa4b2', width: 26, textAlign: 'right' }}>{pct}</span>
            </span>
          )}
        </span>

        {/* Station switcher — opens the track list */}
        <button type="button" aria-label="Cambiar emisora" onClick={() => setOpen((o) => !o)} style={{ ...iconBtn, width: 26, color: '#6c7682' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <>
            <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 130 }} />
            <motion.div
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.16 }}
              style={wide
                ? { position: 'absolute', top: 'calc(100% + 10px)', right: 0, width: 260, zIndex: 140, background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 8, boxShadow: '0 8px 24px #00000055' }
                : { position: 'fixed', left: 0, right: 0, bottom: 60, zIndex: 140, background: COLORS.panel, borderTop: `1px solid ${COLORS.border}`, borderRadius: '14px 14px 0 0', padding: 12, boxShadow: '0 -8px 24px #00000066' }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 240, overflowY: 'auto' }}>
                {radio.tracks.map((t, i) => {
                  const isCurrent = i === radio.index
                  return (
                    <button key={t.id} type="button" onClick={() => { radio.select(i); setOpen(false) }}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', background: isCurrent ? COLORS.panel2 : 'transparent', border: 'none', borderRadius: 8, padding: '8px 10px', cursor: 'pointer', color: isCurrent ? COLORS.green : COLORS.text, fontFamily: FONTS.body, fontSize: 13 }}>
                      <span style={{ width: 12, fontSize: 10 }}>{isCurrent && playing ? '▸' : ''}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.title}<span style={{ color: COLORS.muted }}> · {t.artist}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${COLORS.border}` }}>
                <button type="button" aria-label="Mezclar" aria-pressed={radio.shuffle} onClick={radio.toggleShuffle}
                  style={{ ...iconBtn, width: 32, color: radio.shuffle ? COLORS.green : COLORS.muted }}>🔀</button>
                <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: COLORS.muted }}>{radio.tracks.length} stations</span>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
