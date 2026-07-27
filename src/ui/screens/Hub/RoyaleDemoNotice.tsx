import { useEffect, useState } from 'react'
import { COLORS, FONTS } from '../../theme'

// Ruta del vídeo dentro de public/. Cambiar aquí si el fichero se renombra o se mueve.
export const DEMO_VIDEO_SRC = '/royale-demo.mp4'

const PINK = '#ff2e7e'
const PINK_L = '#ff6ba4'

/**
 * Aviso al principio de la página de Battle Royale: pide ver la demo ANTES de pagar una plaza.
 * Va arriba del todo a propósito — llega antes que el precio y el botón de unirse, que es lo que
 * le da sentido. El botón abre la demo en un modal en vez de navegar: el jugador no pierde el
 * sitio en la página ni el lobby que estaba mirando.
 */
export function RoyaleDemoNotice() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <section style={{
        position: 'relative', overflow: 'hidden', borderRadius: 18,
        border: `1px solid rgba(255,46,126,.32)`,
        background: `radial-gradient(560px 220px at 12% 0%,rgba(255,46,126,.14),transparent 65%),linear-gradient(160deg,#160a12,#0b0d13)`,
        padding: 'clamp(20px,2.4vw,28px) clamp(18px,2.4vw,30px)',
        display: 'flex', alignItems: 'center', gap: 'clamp(16px,2.4vw,32px)', flexWrap: 'wrap',
      }}>
        <div style={{ flex: '1 1 420px', minWidth: 0 }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 10.5, letterSpacing: '.22em', color: PINK_L, textTransform: 'uppercase' }}>
            Battle Royale
          </div>
          <h2 style={{
            margin: '10px 0 8px', fontFamily: FONTS.display, fontWeight: 800,
            fontSize: 'clamp(22px,2.6vw,30px)', letterSpacing: '-.02em', lineHeight: 1.12, color: COLORS.text,
          }}>
            Hold up. One thing first.
          </h2>
          <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: '#aab3bf', maxWidth: 620 }}>
            You shouldn't buy a Battle Royale spot before watching our demo.<br />
            It's short. By the end, you'll know exactly how the game works and whether it's for you.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 9,
            padding: '14px 26px', borderRadius: 13, border: 0, cursor: 'pointer',
            fontFamily: FONTS.display, fontSize: 15, fontWeight: 800, color: '#fff',
            background: `linear-gradient(135deg,${PINK},#c2265e)`,
            boxShadow: `0 14px 34px -12px ${PINK}`,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
          Watch demo
        </button>
      </section>

      {open && <DemoVideoModal onClose={() => setOpen(false)} />}
    </>
  )
}

/** Modal con la demo. Escape y clic fuera cierran; al desmontar el vídeo para solo. */
function DemoVideoModal({ onClose }: { onClose: () => void }) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Battle Royale demo"
      style={{
        position: 'fixed', inset: 0, zIndex: 700, padding: 'clamp(16px,3vw,40px)',
        background: 'rgba(3,4,6,.82)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative', width: 960, maxWidth: '100%',
          borderRadius: 16, overflow: 'hidden', background: '#06080b',
          border: `1px solid rgba(255,46,126,.3)`, boxShadow: '0 40px 120px -30px rgba(0,0,0,.9)',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute', top: 10, right: 10, zIndex: 1,
            width: 34, height: 34, borderRadius: 10, cursor: 'pointer',
            border: '1px solid rgba(255,255,255,.18)', background: 'rgba(6,8,11,.72)',
            color: COLORS.text, fontSize: 15, lineHeight: 1,
          }}
        >
          ✕
        </button>

        {failed ? (
          // Sin el fichero en public/ un <video> roto no dice nada; esto sí.
          <div style={{
            aspectRatio: '16 / 9', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, textAlign: 'center',
          }}>
            <div style={{ fontFamily: FONTS.display, fontWeight: 700, fontSize: 16, color: COLORS.text }}>
              The demo isn't available right now
            </div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 11.5, color: COLORS.muted }}>
              Try again in a moment.
            </div>
          </div>
        ) : (
          <video
            src={DEMO_VIDEO_SRC}
            controls
            autoPlay
            playsInline
            onError={() => setFailed(true)}
            style={{ display: 'block', width: '100%', maxHeight: '80vh', background: '#000' }}
          />
        )}
      </div>
    </div>
  )
}
