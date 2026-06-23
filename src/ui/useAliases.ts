import { useEffect, useState } from 'react'
import { config } from '../onchain/config'

// Module-level cache so the same wallet is resolved once across components/renders.
const cache = new Map<string, string | null>()

/** GET /users/{wallet} → alias (username) or null. Never throws. */
export async function fetchAlias(wallet: string): Promise<string | null> {
  try {
    const r = await fetch(`${config.backendUrl}/users/${encodeURIComponent(wallet)}`, {
      headers: { 'ngrok-skip-browser-warning': 'true' },
    })
    if (!r.ok) return null
    const d = await r.json()
    return (d?.alias as string | null) ?? null
  } catch {
    return null
  }
}

/** Resolve wallet → alias (username), cached per wallet. Returns a map; unknown
 *  wallets resolve to null so callers fall back to the abbreviated wallet. */
export function useAliases(wallets: string[]): Record<string, string | null> {
  const [aliases, setAliases] = useState<Record<string, string | null>>(() => {
    const seed: Record<string, string | null> = {}
    for (const w of wallets) if (cache.has(w)) seed[w] = cache.get(w)!
    return seed
  })
  const key = wallets.join(',')

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const next: Record<string, string | null> = {}
      await Promise.all(
        wallets.map(async (w) => {
          if (cache.has(w)) {
            next[w] = cache.get(w)!
            return
          }
          const a = await fetchAlias(w)
          cache.set(w, a)
          next[w] = a
        }),
      )
      if (!cancelled) setAliases((prev) => ({ ...prev, ...next }))
    }
    if (wallets.length) run()
    return () => {
      cancelled = true
    }
    // `key` captures the wallet list; wallets identity changes each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return aliases
}
