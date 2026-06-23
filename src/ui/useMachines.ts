import { useEffect, useState } from 'react'
import { fetchMachines } from '../onchain/gachaClient'

export interface MachineInfo {
  name: string
  thumb: string | null
}

// Fetched once and shared — the machine catalogue is small and static within a session.
let cache: Record<string, MachineInfo> | null = null
let inflight: Promise<Record<string, MachineInfo>> | null = null

async function load(): Promise<Record<string, MachineInfo>> {
  if (cache) return cache
  if (!inflight) {
    inflight = fetchMachines()
      .then((ms) => {
        const map: Record<string, MachineInfo> = {}
        for (const m of ms) map[m.code] = { name: m.shortName || m.name, thumb: m.thumbnailUrl ?? m.image ?? null }
        cache = map
        return map
      })
      .catch(() => ({}))
  }
  return inflight
}

/** Returns `machine_code → { name, thumb }`. Empty until the catalogue resolves. */
export function useMachines(): Record<string, MachineInfo> {
  const [machines, setMachines] = useState<Record<string, MachineInfo>>(cache ?? {})
  useEffect(() => {
    let cancelled = false
    if (!cache) load().then((m) => { if (!cancelled) setMachines(m) })
    return () => { cancelled = true }
  }, [])
  return machines
}
