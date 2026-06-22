import { useEffect, useState } from 'react'
import { listOpenBattles, type OpenBattle } from './packBattleClient'

export function useOpenBattles(intervalMs = 3000): {
  battles: OpenBattle[]; loading: boolean; error: string | null
} {
  const [battles, setBattles] = useState<OpenBattle[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const poll = async () => {
      try {
        const rows = await listOpenBattles()
        if (cancelled) return
        setBattles(rows)
        setError(null)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))   // transient → keep polling
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    poll()
    const timer = setInterval(poll, intervalMs)
    return () => { cancelled = true; clearInterval(timer) }
  }, [intervalMs])

  return { battles, loading, error }
}
