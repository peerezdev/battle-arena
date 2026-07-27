import { useEffect, useRef, useState } from 'react'
import { COLORS, FONTS, formatUsd } from '../../theme'

/** Cuánto se queda en pantalla el "+$X" antes de desvanecerse (ms). */
export const POT_GAIN_MS = 1600

/**
 * "+$120" verde que salta junto al bote cada vez que una carta suma.
 *
 * Se alimenta del bote YA PROYECTADO, que solo crece cuando la carta ha aterrizado (onCardShown
 * corre después del volteo). Así el número nunca adelanta el resultado: aparece con la carta, no
 * antes. Si el bote baja o no cambia, no enseña nada.
 */
export function PotGain({ pot }: { pot: number }) {
  const [gain, setGain] = useState<{ amount: number; id: number } | null>(null)
  const prev = useRef(pot)
  const seq = useRef(0)

  useEffect(() => {
    const delta = pot - prev.current
    prev.current = pot
    if (delta > 0) setGain({ amount: delta, id: ++seq.current })
  }, [pot])

  useEffect(() => {
    if (!gain) return
    const t = setTimeout(() => setGain(null), POT_GAIN_MS)
    return () => clearTimeout(t)
  }, [gain])

  if (!gain) return null
  return (
    <span
      key={gain.id}   // remonta en cada subida: dos cartas seguidas reinician la animación
      aria-live="polite"
      style={{
        fontFamily: FONTS.mono, fontSize: 12, fontWeight: 700, color: COLORS.green,
        whiteSpace: 'nowrap', pointerEvents: 'none',
        animation: `ba-potgain ${POT_GAIN_MS}ms ease-out forwards`,
      }}
    >
      +{formatUsd(gain.amount)}
    </span>
  )
}
