import { useEffect, useState } from 'react'
import { useEmbeddedSolanaAddress } from '../wallet/embedded'
import { config } from '../onchain/config'

export interface BestHit {
  name: string | null
  grade: number | null
  rarity: string | null
  year: string | null
  valueUsd: number | null
}
export interface BestVictory {
  amountUsd: number
  mode: string
  machineCode: string
  opponents: string[]
}
export interface UserStats {
  battles: number
  wins: number
  winRate: number
  totalWageredUsd: number
  bestHit: BestHit | null
  bestVictory: BestVictory | null
}

const EMPTY: UserStats = { battles: 0, wins: 0, winRate: 0, totalWageredUsd: 0, bestHit: null, bestVictory: null }

/** Fetches aggregated profile stats (battles, wins, wagered, best hit, best victory). */
export function useUserStats(addressOverride?: string | null): { stats: UserStats | null; loading: boolean } {
  const own = useEmbeddedSolanaAddress()
  const address = addressOverride ?? own
  const [stats, setStats] = useState<UserStats | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!address) { setStats(null); return }
    let cancelled = false
    setLoading(true)
    fetch(`${config.backendUrl}/users/${encodeURIComponent(address)}/stats`, { headers: { 'ngrok-skip-browser-warning': 'true' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => { if (!cancelled) setStats(s ? { ...EMPTY, ...s } : EMPTY) })
      .catch((err) => { if (import.meta.env.DEV) console.warn('[useUserStats] fetch error:', err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [address])

  return { stats, loading }
}
