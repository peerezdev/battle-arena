import { useCallback, useEffect, useMemo, useState } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { fetchEmoteCatalog, fetchMyEmotes, setEmoteSlots, type Emote } from '../../onchain/emotesClient'

/** Loads the emote catalog + the signed-in user's owned codes and quick-access slots. */
export function useEmotes() {
  const { identityToken } = useIdentityToken()
  const [catalog, setCatalog] = useState<Emote[]>([])
  const [owned, setOwned] = useState<string[]>([])
  const [slots, setSlots] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetchEmoteCatalog().then((c) => { if (!cancelled) setCatalog(Array.isArray(c) ? c : []) }).catch(() => {})
    if (!identityToken) { setOwned([]); setSlots([]); setLoading(false); return }
    setLoading(true)
    fetchMyEmotes(identityToken)
      .then((m) => { if (!cancelled) { setOwned(m.owned); setSlots(m.slots) } })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [identityToken])

  const byCode = useMemo(() => Object.fromEntries((Array.isArray(catalog) ? catalog : []).map((e) => [e.code, e])) as Record<string, Emote>, [catalog])

  const updateSlots = useCallback(async (next: string[]) => {
    if (!identityToken) return
    const capped = next.slice(0, 3)
    setSlots(capped)   // optimistic
    try {
      const m = await setEmoteSlots(identityToken, capped)
      setSlots(m.slots); setOwned(m.owned)
    } catch { /* keep optimistic value */ }
  }, [identityToken])

  return { catalog, byCode, owned, slots, loading, updateSlots }
}
