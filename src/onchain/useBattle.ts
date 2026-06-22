import { useEffect, useState } from 'react'
import { getBattle, type Battle, type BattleStatus } from './packBattleClient'

const TERMINAL: ReadonlySet<BattleStatus> = new Set(['settled', 'voided', 'cancelled'])

export function useBattle(id: string | null, intervalMs = 2000): {
  battle: Battle | null; loading: boolean; error: string | null
} {
  const [battle, setBattle] = useState<Battle | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) { setBattle(null); return }
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null
    setLoading(true)

    const poll = async () => {
      try {
        const b = await getBattle(id)
        if (cancelled) return
        setBattle(b)
        setError(null)
        if (TERMINAL.has(b.status) && timer) { clearInterval(timer); timer = null }
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))   // transient → keep polling
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    poll()
    timer = setInterval(poll, intervalMs)
    return () => { cancelled = true; if (timer) clearInterval(timer) }
  }, [id, intervalMs])

  return { battle, loading, error }
}
