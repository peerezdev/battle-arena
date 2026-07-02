export interface LiveDrop {
  id: string
  name: string
  valueUsd: number | null
  rarity: string | null
  image: string | null
  source: 'gacha' | 'pack' | 'royale'
  wallet: string
  username: string | null
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

// Merge a batch of drops (the server's recent-drops backlog, replayed on WS
// connect) into the store: dedupe by id (incoming wins), sort newest-first, cap
// to MAX. Lets a freshly-connected client converge on the same feed regardless
// of what its origin's localStorage happened to hold.
export function seedDrops(incoming: LiveDrop[]): void {
  if (incoming.length === 0) return
  const byId = new Map<string, LiveDrop>()
  for (const d of drops) byId.set(d.id, d)
  for (const d of incoming) byId.set(d.id, d) // incoming wins on id collision
  drops = [...byId.values()].sort((a, b) => b.ts - a.ts).slice(0, MAX)
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
