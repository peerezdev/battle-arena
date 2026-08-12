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

/** Cuántas wallets se piden a la vez.
 *
 *  Antes se pedían TODAS en paralelo con un solo Promise.all. Con una lista larga —el historial
 *  o la página de ganadores— eso son decenas de peticiones simultáneas a /users/{wallet}, y el
 *  backend corre en UN proceso: el endpoint es `async def` pero consulta la base de forma
 *  síncrona, así que cada una bloquea el bucle de eventos mientras dura.
 *
 *  Tumbó producción: una ráfaga a las 14:30 dejó el backend sin atender NADA —ni /health— con
 *  sus 40 hilos esperando y 50 conexiones en CLOSE-WAIT. No se cayó, se quedó mudo, y hubo que
 *  reiniciarlo a mano.
 *
 *  Cuatro es deliberadamente conservador: la caché por módulo hace que una lista solo se resuelva
 *  entera la primera vez, así que la latencia extra se paga una vez y no en cada render. */
const A_LA_VEZ = 4

/** Resuelve de N en N en vez de todas de golpe. */
async function enTandas<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += n) {
    await Promise.all(items.slice(i, i + n).map(fn))
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
      // Las cacheadas no gastan petición, así que se resuelven aparte y solo se limita el resto.
      const pendientes: string[] = []
      for (const w of wallets) {
        if (cache.has(w)) next[w] = cache.get(w)!
        else pendientes.push(w)
      }
      await enTandas(pendientes, A_LA_VEZ, async (w) => {
        const a = await fetchAlias(w)
        cache.set(w, a)
        next[w] = a
      })
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
