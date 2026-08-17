import { useEffect, useState } from 'react'
import { COLORS, FONTS } from '../../theme'
import { marcarVisto, yaVisto } from './demoVisto'

// Ruta del vídeo dentro de public/. Cambiar aquí si el fichero se renombra o se mueve.
// Servido desde /srv/battlearena/media por Caddy, NO desde public/: un mp4 de 13 MB en git se
// queda en el historial para siempre y cada versión nueva suma otros tantos. Fuera del repo se
// sustituye copiando el fichero, sin commit ni despliegue. Que exista lo comprueba verify.sh.
export const DEMO_VIDEO_SRC = '/media/battleroyale-demo.mp4'

const PINK = '#ff2e7e'

/**
 * Aviso de la demo de Battle Royale: pide verla ANTES de pagar una plaza.
 *
 * Vivía en la página de Battle Royale, arriba del todo, y llegaba antes que el precio y el botón de
 * unirse. Al unirse las dos páginas en un solo Lobby había que decidir tres cosas, porque un banner
 * a pantalla completa sobre UN modo en una página que ahora tiene DOS es otra cosa:
 *
 *  · COMPACTO. Una fila, no un bloque: el titular y la frase caben al lado del botón. En el Lobby
 *    lo que se viene a hacer es mirar partidas, y lo de antes ocupaba media pantalla.
 *  · SE VA CUANDO YA SE HA VISTO. Ver `demoVisto`: cumplido su trabajo, seguir enseñándolo es un
 *    cartel fijo, y los carteles fijos se dejan de leer.
 *  · SOLO SI HAY ROYALE DELANTE. Quien está mirando solo Pack Battle no está a punto de pagar una
 *    plaza de Royale, así que el aviso no le avisa de nada. Lo decide quien lo pinta.
 *
 * El botón abre la demo en un modal en vez de navegar: el jugador no pierde el sitio en la página
 * ni el lobby que estaba mirando.
 */
export function RoyaleDemoNotice() {
  const [open, setOpen] = useState(false)
  // Se lee una vez al montar; la preferencia no cambia sola desde fuera de esta pantalla.
  const [visto, setVisto] = useState(() => yaVisto())

  if (visto) return null

  function abrir() {
    // Se marca AL ABRIR, no al terminar: medir cuánto ha visto alguien pediría un umbral inventado,
    // y abrirlo ya es la señal de que el aviso hizo su trabajo.
    marcarVisto()
    setOpen(true)
  }

  return (
    <>
      <section style={{
        position: 'relative', overflow: 'hidden', borderRadius: 14,
        border: `1px solid rgba(255,46,126,.32)`,
        background: `radial-gradient(420px 140px at 8% 0%,rgba(255,46,126,.13),transparent 65%),linear-gradient(160deg,#160a12,#0b0d13)`,
        padding: '13px clamp(14px,1.8vw,20px)',
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      }}>
        <div style={{ flex: '1 1 340px', minWidth: 0 }}>
          <h2 style={{
            margin: 0, fontFamily: FONTS.display, fontWeight: 800,
            fontSize: 16, letterSpacing: '-.01em', lineHeight: 1.2, color: COLORS.text,
          }}>
            New to Battle Royale? Watch the demo first.
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.5, color: '#aab3bf' }}>
            It's short, and by the end you'll know how the game works before paying for a spot.
          </p>
        </div>

        <button
          type="button"
          onClick={abrir}
          style={{
            flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '10px 18px', borderRadius: 11, border: 0, cursor: 'pointer', minHeight: 44,
            fontFamily: FONTS.display, fontSize: 14, fontWeight: 800, color: '#fff',
            background: `linear-gradient(135deg,${PINK},#c2265e)`,
            boxShadow: `0 10px 26px -12px ${PINK}`,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
          Watch demo
        </button>

        {/* Poder quitarlo sin verlo. No todo el mundo lo necesita, y un aviso del que no se puede
            salir se lee como publicidad. */}
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => { marcarVisto(); setVisto(true) }}
          style={{
            flex: 'none', width: 30, height: 30, borderRadius: 8, cursor: 'pointer',
            border: '1px solid rgba(255,255,255,.14)', background: 'transparent',
            color: COLORS.muted, fontSize: 13, lineHeight: 1,
          }}
        >
          ✕
        </button>
      </section>

      {open && <DemoVideoModal onClose={() => { setOpen(false); setVisto(true) }} />}
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
