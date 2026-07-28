import { useEffect, useMemo, useState } from 'react'
import { COLORS, FONTS } from '../../theme'
import { spinSequence, spinStepMs, tintFor } from './royaleShared'

// El cartel que cierra cada ronda: quién cae. Sirve para las dos formas de caer, porque lo que hay
// que enseñar —el nombre del eliminado en grande— es el mismo:
//
//   · Empate en el último puesto (`tied.length > 1`): se decide por azar (provably-fair on-chain,
//     desempate por asiento en la demo), así que la ruleta gira entre los empatados y aterriza en
//     el que ya estaba elegido. El resultado es fiel, solo va animado.
//   · Eliminación normal: no hubo azar que enseñar, así que el cartel sale ya resuelto, sin girar.
export function EliminationOverlay({ tied, eliminated, nameOf, reducedMotion }: {
  tied: string[]; eliminated: string | null; nameOf: (w: string) => string; reducedMotion: boolean
}) {
  const isTie = tied.length > 1

  const seq = useMemo(() => spinSequence(tied, eliminated), [tied, eliminated])

  // Sin empate se arranca ya aterrizado: no hay sorteo que enseñar, solo el anuncio.
  const [i, setI] = useState(reducedMotion || !isTie ? Math.max(0, seq.length - 1) : 0)
  const landed = seq.length === 0 || i >= seq.length - 1

  useEffect(() => {
    if (reducedMotion || !isTie || landed) return
    const t = setTimeout(() => setI((n) => n + 1), spinStepMs(i, seq.length))
    return () => clearTimeout(t)
  }, [i, seq.length, landed, reducedMotion, isTie])

  const current = seq[Math.min(i, Math.max(0, seq.length - 1))] ?? eliminated ?? ''

  const eyebrow = isTie ? 'TIED FOR LAST PLACE' : 'ROUND OVER'
  const headline = isTie
    ? (landed ? 'Eliminated at random' : 'Picking a player at random…')
    : 'Eliminated this round'

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 24, background: 'rgba(6,8,11,.72)' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 12, letterSpacing: '.28em', color: COLORS.muted, marginBottom: 8 }}>{eyebrow}</div>
        <div style={{ fontFamily: FONTS.display, fontSize: 'clamp(18px,2.4vw,24px)', fontWeight: 700, color: COLORS.text }}>
          {headline}
        </div>
      </div>

      <div style={{
        minWidth: 'min(340px,86%)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14,
        padding: '20px 26px', borderRadius: 16,
        border: `2px solid ${landed ? 'rgba(255,94,122,.7)' : COLORS.border}`,
        background: landed ? 'rgba(255,94,122,.12)' : 'rgba(255,255,255,.04)',
        boxShadow: landed ? '0 0 50px -14px rgba(255,94,122,.85)' : 'none',
        transition: 'border-color .2s, box-shadow .2s, background .2s',
      }}>
        <span style={{ flex: 'none', width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 800, color: '#06170f', background: tintFor(current) }}>
          {(nameOf(current) || '?').slice(0, 1).toUpperCase()}
        </span>
        <span style={{ fontFamily: FONTS.display, fontSize: 'clamp(22px,3vw,30px)', fontWeight: 800, letterSpacing: '-.01em', color: landed ? COLORS.red : COLORS.text }}>
          {nameOf(current)}
        </span>
      </div>

      <div style={{ fontFamily: FONTS.mono, fontSize: 12, letterSpacing: '.16em', color: landed ? '#ff8198' : COLORS.muted, minHeight: 16 }}>
        {landed ? '✕ ELIMINATED' : `${tied.length} tied`}
      </div>
    </div>
  )
}
