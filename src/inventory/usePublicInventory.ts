import { useEffect, useState } from 'react'
import { config } from '../onchain/config'
import { getAssetsByOwner, filterCollectorCryptAssets, dasAssetToCard, type InventoryCard } from './dasClient'

/** Collector Crypt cards owned by an arbitrary wallet (public, read-only via DAS).
 *  Same source as the own-inventory hook, just for a given address. */
export function usePublicInventory(wallet: string | null): { cards: InventoryCard[]; loading: boolean } {
  const [cards, setCards] = useState<InventoryCard[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!wallet) {
      setCards([])
      return
    }
    let cancelled = false
    setLoading(true)
    getAssetsByOwner(config.dasRpcUrl, wallet)
      .then((assets) => {
        if (cancelled) return
        setCards(filterCollectorCryptAssets(assets, config.ccCollectionMint).map(dasAssetToCard))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [wallet])

  return { cards, loading }
}
