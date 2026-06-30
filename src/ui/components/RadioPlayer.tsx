import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useRadio } from '../radio/useRadio'
import { useIsWide } from '../useIsWide'
import { COLORS, FONTS } from '../theme'

const iconBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 8,
  background: 'transparent',
  border: 'none',
  color: COLORS.text,
  cursor: 'pointer',
  padding: 0,
}

export function RadioPlayer() {
  const radio = useRadio()
  const wide = useIsWide('(min-width: 760px)')
  const [open, setOpen] = useState(false)

  // Attempt autoplay once; the store falls back to the first user gesture.
  useEffect(() => { radio.tryAutoplay() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (radio.tracks.length === 0) return null

  const title = radio.track?.title ?? '—'

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <button type="button" aria-label="Anterior" onClick={radio.prev} style={iconBtn}>⏮</button>
      <button
        type="button"
        aria-label={radio.isPlaying ? 'Pausar' : 'Reproducir'}
        onClick={radio.toggle}
        style={{ ...iconBtn, color: radio.isPlaying ? COLORS.green : COLORS.text }}
      >
        {radio.isPlaying ? '⏸' : '▶'}
      </button>
      <button type="button" aria-label="Siguiente" onClick={radio.next} style={iconBtn}>⏭</button>

      <button
        type="button"
        aria-label="Lista de canciones"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          maxWidth: wide ? 160 : 90,
          minWidth: 0,
          background: 'transparent',
          border: 'none',
          color: COLORS.muted,
          cursor: 'pointer',
          fontFamily: FONTS.body,
          fontSize: 12,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        <span style={{ fontSize: 9 }}>▾</span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 130 }} />
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16 }}
              style={
                wide
                  ? {
                      position: 'absolute',
                      top: 'calc(100% + 10px)',
                      right: 0,
                      width: 260,
                      zIndex: 140,
                      background: COLORS.panel,
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: 12,
                      padding: 8,
                      boxShadow: '0 8px 24px #00000055',
                    }
                  : {
                      position: 'fixed',
                      left: 0,
                      right: 0,
                      bottom: 60, // above the mobile bottom-nav
                      zIndex: 140,
                      background: COLORS.panel,
                      borderTop: `1px solid ${COLORS.border}`,
                      borderRadius: '14px 14px 0 0',
                      padding: 12,
                      boxShadow: '0 -8px 24px #00000066',
                    }
              }
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 240, overflowY: 'auto' }}>
                {radio.tracks.map((t, i) => {
                  const isCurrent = i === radio.index
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => { radio.select(i); setOpen(false) }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        textAlign: 'left',
                        background: isCurrent ? COLORS.panel2 : 'transparent',
                        border: 'none',
                        borderRadius: 8,
                        padding: '8px 10px',
                        cursor: 'pointer',
                        color: isCurrent ? COLORS.green : COLORS.text,
                        fontFamily: FONTS.body,
                        fontSize: 13,
                      }}
                    >
                      <span style={{ width: 12, fontSize: 10 }}>{isCurrent && radio.isPlaying ? '▸' : ''}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.title}
                        <span style={{ color: COLORS.muted }}> · {t.artist}</span>
                      </span>
                    </button>
                  )
                })}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${COLORS.border}` }}>
                <button
                  type="button"
                  aria-label="Mezclar"
                  aria-pressed={radio.shuffle}
                  onClick={radio.toggleShuffle}
                  style={{ ...iconBtn, width: 32, color: radio.shuffle ? COLORS.green : COLORS.muted }}
                >
                  🔀
                </button>
                <input
                  type="range"
                  aria-label="Volumen"
                  min={0}
                  max={1}
                  step={0.01}
                  value={radio.volume}
                  onChange={(e) => radio.setVolume(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
