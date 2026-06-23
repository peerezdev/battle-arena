import { useEffect, useRef, useState } from 'react'

/** Animate 0 → target with requestAnimationFrame (easeOutCubic).
 *  Returns `target` immediately when disabled (e.g. reduced-motion or before reveal),
 *  so callers always render a sane value. */
export function useCountUp(target: number, enabled: boolean, durationMs = 700): number {
  const [value, setValue] = useState(enabled ? 0 : target)
  const startRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) {
      setValue(target)
      return
    }
    startRef.current = null
    let raf = 0
    const tick = (t: number) => {
      if (startRef.current === null) startRef.current = t
      const p = Math.min(1, (t - startRef.current) / durationMs)
      const eased = 1 - Math.pow(1 - p, 3)
      setValue(target * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
      else setValue(target)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, enabled, durationMs])

  return value
}
