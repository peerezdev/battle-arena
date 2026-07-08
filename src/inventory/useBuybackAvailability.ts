import { useEffect, useState } from 'react'
import { fetchBuybackAvailable } from '../onchain/gachaClient'
import type { OwnedCard } from './useCollectorCryptNfts'

/**
 * Set of mints (among `cards`) that currently have an active buyback offer.
 *
 * Buyback is only meaningful for embedded-won cards, so only cards with `source === 'embedded'`
 * are probed (via `fetchBuybackAvailable(embeddedAddress, mint)`); connected/public cards are
 * never included. Probes run in parallel and failures are treated as "not available" (excluded).
 */
export function useBuybackAvailability(
  cards: OwnedCard[],
  embeddedAddress: string | null,
): { available: Set<string>; amounts: Map<string, number>; loading: boolean } {
  const [available, setAvailable] = useState<Set<string>>(new Set())
  // mint → buyback offer amount in USDC base units (so callers can preview the payout).
  const [amounts, setAmounts] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(false)

  const embeddedMints = cards.filter((c) => c.source === 'embedded').map((c) => c.mint)
  // Stable dependency key so the effect doesn't loop on array identity.
  const key = `${embeddedAddress ?? ''}|${embeddedMints.join(',')}`

  useEffect(() => {
    if (!embeddedAddress || embeddedMints.length === 0) {
      setAvailable(new Set())
      setAmounts(new Map())
      return
    }
    let cancelled = false
    setLoading(true)
    Promise.all(
      embeddedMints.map(async (mint) => {
        try {
          const r = await fetchBuybackAvailable(embeddedAddress, mint)
          return r.available && r.amount != null ? { mint, amount: r.amount } : null
        } catch {
          return null
        }
      }),
    )
      .then((results) => {
        if (cancelled) return
        const ok = results.filter((x): x is { mint: string; amount: number } => x != null)
        setAvailable(new Set(ok.map((x) => x.mint)))
        setAmounts(new Map(ok.map((x) => [x.mint, x.amount])))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` deriva de embeddedMints+address; depender de `key` evita el bucle por identidad del array
  }, [key])

  return { available, amounts, loading }
}
