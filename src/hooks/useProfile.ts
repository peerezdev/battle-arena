import { useCallback, useEffect, useState } from 'react'
import { useEmbeddedSolanaAddress } from '../wallet/embedded'
import { config } from '../onchain/config'

export interface ProfileData {
  username: string | null
  elo: number | null
  gamesPlayed: number | null
}

export function useProfile(): ProfileData & { loading: boolean; refresh: () => void } {
  const address = useEmbeddedSolanaAddress()
  const [data, setData] = useState<ProfileData>({ username: null, elo: null, gamesPlayed: null })
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)
  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!address) {
      setData({ username: null, elo: null, gamesPlayed: null })
      return
    }
    let cancelled = false
    setLoading(true)
    fetch(`${config.backendUrl}/users/${encodeURIComponent(address)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        if (cancelled || !u) return
        setData({ username: u.alias ?? null, elo: u.elo ?? null, gamesPlayed: u.games_played ?? null })
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [address, nonce])

  return { ...data, loading, refresh }
}
