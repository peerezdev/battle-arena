import { FONTS } from '../../theme'
import { SITE_DOMAIN, type Pnl } from './pnl'

// Tarjeta de resultado de un ganador, en 16:9 para poder compartirla tal cual.
//
// La paleta es cálida a propósito y NO es la del tema: la interfaz va en cian y magenta, y esta
// tarjeta vive fuera —en una captura, en un chat— donde lo que tiene que leerse de un vistazo es
// la cifra. El dorado la sostiene mejor que el verde de la interfaz. Es la misma decisión que ya
// está tomada con los colores de rareza, que tampoco siguen la marca.
const ORO = '#ffd166'
const ORO_2 = '#ff9d4d'
const CREMA = '#fdf3e3'
const CREMA_2 = '#e8d5c0'
const APAGADO = '#c9ae95'
const PERDIDA = '#ff8a8a'

/** Dólares redondos, sin céntimos: en una cifra a este tamaño los decimales son ruido. */
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

/**
 * Todo se mide en `cqw` (porcentaje del ancho de la tarjeta), así que la composición es la misma
 * a cualquier tamaño: la misma tarjeta sirve para un hueco de 320px en el móvil y para una
 * exportación de 1200px. Con píxeles fijos habría que mantener una escala por cada sitio donde
 * se use. El diseño original está trazado sobre 640px de ancho; de ahí salen las proporciones.
 */
export function PnlCard({ pnl, winnerName, shareHref }: {
  pnl: Pnl
  winnerName: string
  /** Con enlace sale el botón de compartir, abajo a la derecha. Sin él la tarjeta queda limpia,
   *  que es como tiene que ir a una captura o a una exportación. */
  shareHref?: string
}) {
  const gano = pnl.profit >= 0
  const signo = gano ? '+' : '−'

  return (
    <div
      data-testid="pnl-card"
      style={{
        containerType: 'inline-size',
        position: 'relative', width: '100%', aspectRatio: '16 / 9',
        borderRadius: '2.5cqw', border: `1px solid ${ORO}73`, overflow: 'hidden', display: 'flex',
        background: '#120810',
        backgroundImage: pnl.background ? `url(${pnl.background})` : undefined,
        backgroundSize: 'cover', backgroundPosition: 'center',
        fontFamily: FONTS.display, color: CREMA,
      }}
    >
      {/* Velo que se abre hacia la derecha: el texto se lee sobre negro y la carta asoma al fondo. */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'linear-gradient(90deg,rgba(18,8,14,.96) 0%,rgba(18,8,14,.9) 40%,rgba(18,8,14,.15) 72%,transparent 100%)',
      }} />

      <div style={{
        width: '56%', padding: '3.75cqw 0 3.75cqw 4.06cqw',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.4cqw' }}>
          <img src="/logo.png" alt="" style={{ width: '5cqw', height: '5cqw', objectFit: 'contain' }} />
          <div>
            <div style={{ fontSize: '2.19cqw', fontWeight: 700, color: CREMA }}>Collector Arena</div>
            <div style={{ fontFamily: FONTS.mono, fontSize: '1.25cqw', letterSpacing: '.2em', color: ORO }}>{pnl.mode}</div>
          </div>
        </div>

        <div>
          <div style={{ fontSize: '1.875cqw', fontWeight: 600, color: CREMA_2 }}>
            {winnerName} · <span style={{ color: ORO }}>WINNER</span>
          </div>

          <div style={{ fontSize: '6.875cqw', fontWeight: 700, lineHeight: 1.05 }}>
            {/* Una pérdida no se pinta de oro: el degradado es para celebrar, y aquí no hay nada
                que celebrar aunque se haya ganado la partida. */}
            <span style={gano
              ? { background: `linear-gradient(90deg,${ORO},${ORO_2})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }
              : { color: PERDIDA }}>
              {signo}{usd(Math.abs(pnl.profit))}
            </span>
          </div>

          {pnl.multiple != null && (
            <div style={{ fontFamily: FONTS.mono, fontSize: '1.875cqw', fontWeight: 700, color: gano ? '#ffb45c' : PERDIDA, marginTop: '.3cqw' }}>
              ×{pnl.multiple.toFixed(1)} RETURN
            </div>
          )}

          <div style={{
            display: 'flex', gap: '2.8cqw', marginTop: '1.875cqw',
            borderTop: `1px solid ${ORO}40`, paddingTop: '1.5625cqw',
          }}>
            <Dato label="ENTRY" value={usd(pnl.entry)} color={CREMA} />
            <Dato label="PAYOUT" value={usd(pnl.payout)} color={ORO} />
          </div>
        </div>

        <span style={{ fontFamily: FONTS.mono, fontSize: '1.5625cqw', color: '#d8bfa4' }}>{SITE_DOMAIN}</span>
      </div>

      {/* Esquina inferior derecha, sobre la parte donde el velo ya se ha abierto: no pisa ninguna
          cifra y queda lejos del dominio, que firma abajo a la izquierda. */}
      {shareHref && (
        <a
          href={shareHref}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            position: 'absolute', right: '3.1cqw', bottom: '3.1cqw', zIndex: 2,
            display: 'inline-flex', alignItems: 'center', gap: '.9cqw',
            padding: '1.1cqw 1.9cqw', borderRadius: '1.4cqw',
            border: `1px solid ${ORO}59`, background: 'rgba(18,8,14,.72)',
            color: CREMA, fontFamily: FONTS.display, fontSize: '1.5cqw', fontWeight: 700,
            textDecoration: 'none', whiteSpace: 'nowrap',
          }}
        >
          <XGlyph /> Share on X
        </a>
      )}
    </div>
  )
}

function XGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="1.6cqw" height="1.6cqw" fill="currentColor" aria-hidden="true">
      <path d="M18.9 2H22l-6.8 7.8L23 22h-6.3l-4.9-6.4L6.2 22H3l7.3-8.3L2.3 2h6.4l4.4 5.9L18.9 2Z" />
    </svg>
  )
}

function Dato({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ fontFamily: FONTS.mono, fontSize: '1.25cqw', letterSpacing: '.14em', color: APAGADO }}>{label}</div>
      <div style={{ fontSize: '2.19cqw', fontWeight: 700, color }}>{value}</div>
    </div>
  )
}
