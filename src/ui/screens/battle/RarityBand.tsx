import { FONTS } from '../../theme'

/**
 * Franja opaca que anuncia la rareza en grande justo antes de que la carta se voltee.
 * Solo para Rare y Epic — en Common y Uncommon no se monta.
 *
 * Va por encima de la carta y SOBRESALE por los lados (ancho 260% centrado): la idea es que
 * cruce el escenario, no que quepa en la carta. El contenedor que la monta no debe recortar.
 *
 * El fundido de salida vive en esta capa y no en la franja a propósito: la entrada es una
 * animación con `forwards`, y una animación rellenada gana en la cascada a un `opacity` puesto
 * desde el estilo, así que aplicado a la franja no haría nada.
 */
export function RarityBand({ label, color, w, h, phase, turnMs, reduced }: {
  label: string
  color: string
  /** Ancho y alto de la carta: la franja se dimensiona a partir de ellos. */
  w: number
  h: number
  phase: 'in' | 'out'
  /** Lo que tarda el giro de la carta: la franja se desvanece a ese mismo ritmo. */
  turnMs: number
  reduced: boolean
}) {
  const bandH = Math.max(38, Math.round(h * 0.26))
  const font = Math.max(15, Math.min(40, Math.round(w * 0.2)))
  const out = phase === 'out'

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute', inset: 0, zIndex: 6, display: 'grid', placeItems: 'center',
        pointerEvents: 'none',
        opacity: out ? 0 : 1,
        transition: reduced ? 'none' : `opacity ${turnMs}ms cubic-bezier(.4,0,.7,1)`,
      }}
    >
      {/* Onda que sale del golpe */}
      <span style={{
        position: 'absolute', width: bandH * 1.6, height: bandH * 1.6, borderRadius: '50%',
        border: `2px solid ${color}`, opacity: 0,
        animation: reduced ? 'none' : 'ba-bandRing .8s .14s cubic-bezier(.1,.7,.3,1) forwards',
      }} />

      {/* 200vw: la franja tiene que llegar a los dos bordes de CUALQUIER escenario, así que se
          pasa de largo a propósito y es el escenario el que la recorta (overflow:hidden). */}
      <span style={{
        position: 'absolute', left: '50%', width: '200vw', transform: 'translateX(-50%)', height: bandH,
        background: 'linear-gradient(180deg,#0a0d13,#141b2b 48%,#080b11)',
        borderTop: `2px solid ${color}`, borderBottom: `2px solid ${color}`,
        boxShadow: `0 0 44px -6px ${color}, inset 0 0 40px -14px ${color}`,
        display: 'grid', placeItems: 'center',
        animation: reduced ? 'none' : 'ba-bandOpen .5s cubic-bezier(.15,.9,.2,1) forwards',
      }}>
        <span style={{
          fontFamily: FONTS.display, fontWeight: 800, fontSize: font, letterSpacing: '.18em',
          color, textShadow: `0 0 26px ${color}`, whiteSpace: 'nowrap',
          opacity: reduced ? 1 : 0,
          animation: reduced ? 'none' : 'ba-bandWord .7s .08s cubic-bezier(.2,.9,.2,1) forwards',
        }}>
          {label}
        </span>
      </span>
    </div>
  )
}
