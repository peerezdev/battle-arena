import { useSyncExternalStore } from 'react'
import { subscribe, getDrops, type LiveDrop } from './dropsStore'

export function useDrops(): LiveDrop[] {
  return useSyncExternalStore(subscribe, getDrops, getDrops)
}
