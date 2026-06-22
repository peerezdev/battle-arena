import { useState } from 'react'
import { useDelegation } from '../../wallet/useDelegation'

export function useDelegationGate() {
  const { delegated, enable } = useDelegation()
  const [pending, setPending] = useState<(() => void) | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function requireDelegation(action: () => void) {
    if (delegated) { action(); return }
    setError(null)
    setPending(() => action)   // store the fn (useState treats a fn arg as an updater)
  }

  async function confirm() {
    if (!pending) return
    setBusy(true); setError(null)
    try {
      await enable()
      const action = pending
      setPending(null)
      action()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function cancel() { setPending(null); setError(null) }

  return { requireDelegation, open: pending !== null, busy, error, confirm, cancel }
}
