import { useRef, useState } from 'react'
import { COLORS, FONTS } from '../../theme'

// Sobre de gacha con tilt 3D, en lugar del modal de progreso.
//
// Se muestra desde que arranca la tirada, así que la espera pasa de "un spinner" a algo con lo
// que se juega: el sobre se inclina siguiendo al ratón y el brillo se mueve con él. Cuando los
// sobres están listos NO se revela solo — el usuario decide cuándo, pulsando el botón o el
// propio sobre. Ese click es el momento de la tirada, y quitárselo es quitarle la gracia.

const PACK_W = 280
const PACK_H = 480
const MAX_TILT = 16          // grados; más que esto y el sobre se deforma raro en los bordes

/** Los dos colores de foil (arriba/abajo) por tramo de precio. La misma pieza de arte sirve
 *  para todas las máquinas: lo que cambia es la paleta, así que una de $1000 no se confunde
 *  con una de $25 sin tener que dibujar un sobre nuevo por máquina. */
export function packPalette(price: number): { top: string; bottom: string; topGlow: string; bottomGlow: string } {
  if (price >= 1000) return { top: '#ffd76a', bottom: '#4ea8ff', topGlow: '#ffb800', bottomGlow: '#4ea8ff' }
  if (price >= 250) return { top: '#b06bff', bottom: '#22d3ee', topGlow: '#a855f7', bottomGlow: '#22d3ee' }
  if (price >= 100) return { top: '#ffa14e', bottom: '#ff4d6d', topGlow: '#ff7a1a', bottomGlow: '#ff4d6d' }
  if (price >= 50) return { top: '#ff2e7e', bottom: '#4ea8ff', topGlow: '#ff2e7e', bottomGlow: '#4ea8ff' }
  return { top: '#3ce8a8', bottom: '#4ea8ff', topGlow: '#3ce8a8', bottomGlow: '#4ea8ff' }
}

const CODE_PREFIX: Record<string, string> = {
  pokemon: 'PKM', onepiece: 'ONE PIECE', sports: 'SPORTS', sweet: 'SWEETS', espider: 'SPIDER',
}

/** `pokemon_50` → `["PKM", "50"]`. El código de máquina es `prefijo_sufijo`; el sufijo suele ser
 *  el precio pero puede ser otra cosa (`pokemon_cnft`), así que se usa tal cual en mayúsculas. */
export function packTitle(machineCode: string): [string, string] {
  const i = machineCode.lastIndexOf('_')
  const rawPrefix = i === -1 ? machineCode : machineCode.slice(0, i)
  const suffix = i === -1 ? '' : machineCode.slice(i + 1)
  return [CODE_PREFIX[rawPrefix] ?? rawPrefix.toUpperCase(), suffix.toUpperCase()]
}

/** El título va en UNA línea siempre. `ONE PIECE 250` a 38px se parte en dos y empuja el sello
 *  fuera del sobre, así que se encoge según el largo. 0.58 es el ancho medio de glifo de Space
 *  Grotesk 700 itálica respecto al tamaño de fuente; 248 es el ancho útil (280 menos márgenes). */
export function fitTitleSize(prefix: string, suffix: string): number {
  const len = (prefix + (suffix ? ' ' + suffix : '')).length
  return Math.max(20, Math.min(38, Math.floor(248 / (len * 0.58))))
}

type Props = {
  machineCode: string
  price: number
  /** Sobres de la tanda; solo afecta al texto del sello. */
  count: number
  /** true = ya se puede revelar. */
  ready: boolean
  done: number
  total: number
  onOpen: () => void
  reduced: boolean
}

export function GachaPackTilt({ machineCode, price, count, ready, done, total, onOpen, reduced }: Props) {
  const [tilt, setTilt] = useState({ rx: 0, ry: 0, lx: 30, ly: 25, hovering: false })
  const cardRef = useRef<HTMLDivElement | null>(null)
  const pal = packPalette(price)
  const [prefix, suffix] = packTitle(machineCode)
  const titleSize = fitTitleSize(prefix, suffix)

  function onMove(e: React.MouseEvent) {
    if (reduced) return
    const r = cardRef.current?.getBoundingClientRect()
    if (!r) return
    const px = (e.clientX - r.left) / r.width
    const py = (e.clientY - r.top) / r.height
    // El lado bajo el ratón se hunde y el opuesto se acerca: por eso rx va invertido.
    setTilt({ rx: -(py - 0.5) * 2 * MAX_TILT, ry: (px - 0.5) * 2 * MAX_TILT, lx: px * 100, ly: py * 100, hovering: true })
  }
  function onLeave() { setTilt({ rx: 0, ry: 0, lx: 30, ly: 25, hovering: false }) }

  const zig = (c: string) =>
    `linear-gradient(-45deg,${c} 5.5px,transparent 0),linear-gradient(45deg,${c} 5.5px,transparent 0)`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26 }}>
      <div style={{ perspective: 1100 }} onMouseMove={onMove} onMouseLeave={onLeave}>
        <div
          ref={cardRef}
          onClick={ready ? onOpen : undefined}
          role={ready ? 'button' : undefined}
          tabIndex={ready ? 0 : undefined}
          aria-label={ready ? 'Open your pack' : undefined}
          onKeyDown={ready ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } } : undefined}
          style={{
            position: 'relative', width: PACK_W, height: PACK_H,
            transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
            transformStyle: 'preserve-3d',
            transition: tilt.hovering ? 'transform .08s linear' : 'transform .6s cubic-bezier(.22,1,.36,1)',
            filter: 'drop-shadow(0 34px 45px rgba(0,0,0,.75))',
            cursor: ready ? 'pointer' : 'default',
          }}
        >
          {/* foil superior */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 26,
            background: `repeating-linear-gradient(90deg,#2a0a18 0,${pal.top} 3px,#3f0f24 6px,${pal.top}cc 9px,#2a0a18 12px)`,
            boxShadow: 'inset 0 3px 3px rgba(255,255,255,.3),inset 0 -4px 5px rgba(0,0,0,.55)' }} />
          <div style={{ position: 'absolute', top: 26, left: 0, right: 0, height: 8,
            background: zig('#3f0f24'), backgroundSize: '11px 8px', backgroundRepeat: 'repeat-x',
            filter: 'drop-shadow(0 2px 2px rgba(0,0,0,.5))' }} />
          {/* foil inferior */}
          <div style={{ position: 'absolute', bottom: 26, left: 0, right: 0, height: 8, transform: 'scaleY(-1)',
            background: zig('#0e2b52'), backgroundSize: '11px 8px', backgroundRepeat: 'repeat-x',
            filter: 'drop-shadow(0 -2px 2px rgba(0,0,0,.5))' }} />
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 26,
            background: `repeating-linear-gradient(90deg,#08182f 0,${pal.bottom} 3px,#0e2b52 6px,${pal.bottom}cc 9px,#08182f 12px)`,
            boxShadow: 'inset 0 3px 3px rgba(255,255,255,.25),inset 0 -4px 5px rgba(0,0,0,.6)' }} />

          {/* cuerpo */}
          <div style={{ position: 'absolute', top: 32, bottom: 32, left: 0, right: 0, overflow: 'hidden',
            background: 'linear-gradient(155deg,#2a0c1e 0%,#1c0a16 46%,#081226 54%,#0a1830 100%)' }}>
            <div style={{ position: 'absolute', inset: 0,
              background: `linear-gradient(155deg,${pal.topGlow}38 0%,transparent 46%,transparent 54%,${pal.bottomGlow}38 100%)` }} />
            {/* grano: da textura de papel/foil y evita que los degradados se vean planos */}
            <div style={{ position: 'absolute', inset: 0, opacity: .5, mixBlendMode: 'overlay',
              backgroundImage: "url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22300%22%3E%3Cfilter id=%22n%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.012 0.02%22 numOctaves=%224%22 seed=%227%22/%3E%3CfeDiffuseLighting lighting-color=%22white%22 surfaceScale=%223.2%22%3E%3CfeDistantLight azimuth=%22235%22 elevation=%2242%22/%3E%3C/feDiffuseLighting%3E%3C/filter%3E%3Crect width=%22300%22 height=%22300%22 filter=%22url(%23n)%22/%3E%3C/svg%3E')",
              backgroundSize: '300px 300px' }} />
            {/* luz que sigue al cursor */}
            <div style={{ position: 'absolute', inset: '-40%', pointerEvents: 'none',
              background: `radial-gradient(220px 260px at ${tilt.lx}% ${tilt.ly}%,rgba(255,255,255,.2),transparent 60%)` }} />
            <div style={{ position: 'absolute', inset: 0,
              background: 'linear-gradient(90deg,rgba(0,0,0,.4),transparent 12%,transparent 86%,rgba(0,0,0,.5))' }} />
            <div style={{ position: 'absolute', top: '-20%', left: '-30%', width: '160%', height: '70%',
              background: 'linear-gradient(155deg,transparent 40%,rgba(255,255,255,.08) 49%,rgba(255,255,255,.16) 50%,transparent 52%)' }} />

            <img src="/logo.png" alt="" style={{ position: 'absolute', top: 42, left: '50%', transform: 'translateX(-50%)',
              width: 238, height: 238, objectFit: 'contain', pointerEvents: 'none',
              filter: `drop-shadow(0 0 24px ${pal.topGlow}66) drop-shadow(0 14px 12px rgba(0,0,0,.45))` }} />

            <div style={{ position: 'absolute', top: 300, left: 0, right: 0, display: 'flex',
              flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: FONTS.display, fontSize: titleSize, fontWeight: 700, letterSpacing: '.05em',
                fontStyle: 'italic', whiteSpace: 'nowrap' }}>
                <span style={{ color: pal.topGlow, textShadow: `0 0 22px ${pal.topGlow}cc,0 4px 6px rgba(0,0,0,.6)` }}>{prefix}</span>
                {suffix && ' '}
                <span style={{ color: pal.bottomGlow, textShadow: `0 0 22px ${pal.bottomGlow}cc,0 4px 6px rgba(0,0,0,.6)` }}>{suffix}</span>
              </span>
              <span style={{ fontFamily: FONTS.mono, fontSize: 9, fontWeight: 700, letterSpacing: '.22em',
                color: '#cdd4dd', background: 'rgba(8,8,18,.8)', border: '1px solid rgba(255,255,255,.18)',
                borderRadius: 4, padding: '5px 14px', boxShadow: '0 3px 8px rgba(0,0,0,.5)' }}>
                {count} GRADED GAME CARD{count === 1 ? '' : 'S'}
              </span>
            </div>

            {!reduced && (
              <div className="ba-packshine" style={{ position: 'absolute', top: 0, left: 0, width: 80, height: '100%',
                background: 'linear-gradient(90deg,rgba(255,255,255,.14),transparent)', pointerEvents: 'none' }} />
            )}
          </div>
        </div>
      </div>

      <button
        onClick={ready ? onOpen : undefined}
        disabled={!ready}
        style={{
          minWidth: 280, borderRadius: 12, padding: '14px 22px', fontSize: 15, fontWeight: 800,
          fontFamily: FONTS.display, letterSpacing: '.02em',
          cursor: ready ? 'pointer' : 'default',
          border: ready ? 'none' : `1px solid ${COLORS.border}`,
          background: ready ? `linear-gradient(90deg,${pal.topGlow},${pal.bottomGlow})` : COLORS.panel2,
          color: ready ? '#08111d' : COLORS.muted,
        }}>
        {ready ? 'Open pack' : `Generating pack… ${Math.min(done + 1, total)}/${total}`}
      </button>
    </div>
  )
}
