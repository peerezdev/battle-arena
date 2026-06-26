import { useCallback, useEffect, useState } from 'react'
import { useEmbeddedSolanaAddress } from '../wallet/embedded'
import { config } from '../onchain/config'

export interface ProfileData {
  username: string | null
  elo: number | null
  gamesPlayed: number | null
  gimmighouls: number | null
  withdrawAddress: string | null
}

export function useProfile(addressOverride?: string | null): ProfileData & { loading: boolean; refresh: () => void } {
  const own = useEmbeddedSolanaAddress()
  const address = addressOverride ?? own
  const [data, setData] = useState<ProfileData>({ username: null, elo: null, gamesPlayed: null, gimmighouls: null, withdrawAddress: null })
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)
  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!address) {
      setData({ username: null, elo: null, gamesPlayed: null, gimmighouls: null, withdrawAddress: null })
      return
    }
    let cancelled = false
    setLoading(true)
    fetch(`${config.backendUrl}/users/${encodeURIComponent(address)}`, { headers: { 'ngrok-skip-browser-warning': 'true' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        if (cancelled || !u) return
        setData({ username: u.alias ?? null, elo: u.elo ?? null, gamesPlayed: u.games_played ?? null, gimmighouls: u.gimmighouls ?? null, withdrawAddress: u.withdraw_address ?? null })
      })
      .catch((err) => {
        if (import.meta.env.DEV) console.warn('[useProfile] fetch error:', err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [address, nonce])

  return { ...data, loading, refresh }
}
