import { useEffect, useState } from 'react'
import { fetchMachines, type GachaMachine } from '../onchain/gachaClient'

export interface MachineInfo {
  name: string
  thumb: string | null
}

// The machine catalogue is small and static within a session — fetch it once and share it.
// Both the lightweight name/thumb map (useMachines) and the full list (useMachineList) read from
// this single cache, so opening the Create Battle modal doesn't re-fetch.
let listCache: GachaMachine[] | null = null
let inflight: Promise<GachaMachine[]> | null = null

/** Fetch (or reuse) the full machine catalogue. Call early to warm the cache. */
export function loadMachineList(): Promise<GachaMachine[]> {
  if (listCache) return Promise.resolve(listCache)
  if (!inflight) {
    inflight = fetchMachines()
      .then((ms) => { listCache = Array.isArray(ms) ? ms : []; return listCache })
      .catch(() => { inflight = null; return [] as GachaMachine[] }) // allow retry on failure
  }
  return inflight
}

/** The full machine list + loading flag. Instant when the cache is already warm. */
export function useMachineList(): { machines: GachaMachine[]; loading: boolean } {
  const [machines, setMachines] = useState<GachaMachine[]>(listCache ?? [])
  const [loading, setLoading] = useState(!listCache)
  useEffect(() => {
    if (listCache) { setMachines(listCache); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    loadMachineList().then((m) => { if (!cancelled) { setMachines(m); setLoading(false) } })
    return () => { cancelled = true }
  }, [])
  return { machines, loading }
}

function toMap(ms: GachaMachine[]): Record<string, MachineInfo> {
  const map: Record<string, MachineInfo> = {}
  for (const m of ms) map[m.code] = { name: m.shortName || m.name, thumb: m.thumbnailUrl ?? m.image ?? null }
  return map
}

/** Returns `machine_code → { name, thumb }`. Empty until the catalogue resolves. */
export function useMachines(): Record<string, MachineInfo> {
  const [machines, setMachines] = useState<Record<string, MachineInfo>>(listCache ? toMap(listCache) : {})
  useEffect(() => {
    let cancelled = false
    loadMachineList().then((m) => { if (!cancelled) setMachines(toMap(m)) })
    return () => { cancelled = true }
  }, [])
  return machines
}
