export interface LiveDrop {
  id: string
  name: string
  valueUsd: number | null
  rarity: string | null
  image: string | null
  source: 'gacha' | 'pack' | 'royale'
  ts: number
}

const MAX = 20
const KEY = 'ba.liveDrops'
const listeners = new Set<() => void>()

function load(): LiveDrop[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

let drops: LiveDrop[] = load()

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(drops)) } catch { /* ignore */ }
}

export function addDrop(d: LiveDrop): void {
  drops = [d, ...drops.filter((x) => x.id !== d.id)].slice(0, MAX)
  persist()
  listeners.forEach((l) => l())
}

export function getDrops(): LiveDrop[] {
  return drops
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}
