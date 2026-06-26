import { useSyncExternalStore } from 'react'

/**
 * Global (persisted) toggle for the gacha card color-grade filter. Lives in the topbar but is
 * applied by the card grid — so it's a tiny external store both can read/write.
 */
const KEY = 'ba.poolColorFilter'

let value: boolean = (() => {
  try { return localStorage.getItem(KEY) !== 'off' } catch { return true }
})()

const listeners = new Set<() => void>()

export function getColorFilter(): boolean {
  return value
}

export function setColorFilter(on: boolean): void {
  value = on
  try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* ignore */ }
  listeners.forEach((l) => l())
}

export function toggleColorFilter(): void {
  setColorFilter(!value)
}

/** Subscribe to the filter preference. Returns the current boolean and re-renders on change. */
export function usePoolColorFilter(): boolean {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb) } },
    getColorFilter,
    getColorFilter,
  )
}
