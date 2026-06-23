import { useEffect, useRef, useState } from 'react'

/** Animate the displayed number toward `target` (easeOutCubic), starting from the
 *  current value — so a running total ticks up across rounds instead of resetting to 0.
 *  Returns `target` immediately when disabled (reduced-motion / pre-reveal). */
export function useCountUp(target: number, enabled: boolean, durationMs = 700): number {
  const [value, setValue] = useState(enabled ? 0 : target)
  const fromRef = useRef(0)
  const startRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) {
      setValue(target)
      return
    }
    fromRef.current = value // animate from whatever is on screen now
    startRef.current = null
    let raf = 0
    const tick = (t: number) => {
      if (startRef.current === null) startRef.current = t
      const p = Math.min(1, (t - startRef.current) / durationMs)
      const eased = 1 - Math.pow(1 - p, 3)
      setValue(fromRef.current + (target - fromRef.current) * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
      else setValue(target)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // `value` is read as the animation's start point but must not retrigger the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, enabled, durationMs])

  return value
}
