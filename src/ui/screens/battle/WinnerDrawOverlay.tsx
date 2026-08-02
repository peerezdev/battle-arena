import { useEffect, useMemo, useState } from 'react'
import { COLORS, FONTS, formatUsd } from '../../theme'
import { POT_GOLD, spinSequence, spinStepMs, tintFor } from './royaleShared'

// El cartel que cierra una Pack Battle empatada: la ruleta gira entre los que comparten el total
// más alto y aterriza en el ganador, que YA estaba decidido por la semilla Provably-Fair del
// backend. La animación no sortea nada; enseña un sorteo que ya ocurrió.
//
// Es hermano de EliminationOverlay y comparte con él la mecánica del giro (spinSequence /
// spinStepMs). Lo que no comparte es el significado: allí se sortea quién CAE —último puesto,
// rojo— y aquí quién GANA. Por eso son dos componentes y no uno con un interruptor.
export function WinnerDrawOverlay({ tied, winner, value, nameOf, reducedMotion }: {
  tied: string[]; winner: string; value: number; nameOf: (w: string) => string; reducedMotion: boolean
}) {
  const seq = useMemo(() => spinSequence(tied, winner), [tied, winner])

  // Con reduced-motion se entrega el resultado y punto, sin ceremonia.
  const [i, setI] = useState(reducedMotion ? Math.max(0, seq.length - 1) : 0)
  const landed = seq.length === 0 || i >= seq.length - 1

  useEffect(() => {
    if (reducedMotion || landed) return
    const t = setTimeout(() => setI((n) => n + 1), spinStepMs(i, seq.length))
    return () => clearTimeout(t)
  }, [i, seq.length, landed, reducedMotion])

  const current = seq[Math.min(i, Math.max(0, seq.length - 1))] ?? winner

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 24, background: 'rgba(6,8,11,.72)' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 12, letterSpacing: '.28em', color: COLORS.muted, marginBottom: 8 }}>
          TIED FOR FIRST · {formatUsd(value)}
        </div>
        <div style={{ fontFamily: FONTS.display, fontSize: 'clamp(18px,2.4vw,24px)', fontWeight: 700, color: COLORS.text }}>
          {landed ? 'Winner drawn at random' : 'Drawing a winner at random…'}
        </div>
      </div>

      <div style={{
        minWidth: 'min(340px,86%)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14,
        padding: '20px 26px', borderRadius: 16,
        border: `2px solid ${landed ? POT_GOLD : COLORS.border}`,
        background: landed ? 'rgba(245,197,66,.12)' : 'rgba(255,255,255,.04)',
        boxShadow: landed ? `0 0 50px -14px ${POT_GOLD}` : 'none',
        transition: 'border-color .2s, box-shadow .2s, background .2s',
      }}>
        <span style={{ flex: 'none', width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 800, color: '#06170f', background: tintFor(current) }}>
          {(nameOf(current) || '?').slice(0, 1).toUpperCase()}
        </span>
        <span style={{ fontFamily: FONTS.display, fontSize: 'clamp(22px,3vw,30px)', fontWeight: 800, letterSpacing: '-.01em', color: landed ? POT_GOLD : COLORS.text }}>
          {nameOf(current)}
        </span>
      </div>

      <div style={{ fontFamily: FONTS.mono, fontSize: 12, letterSpacing: '.16em', color: landed ? POT_GOLD : COLORS.muted, minHeight: 16 }}>
        {landed ? '★ WINNER' : `${tied.length} tied`}
      </div>
    </div>
  )
}
