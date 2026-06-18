import { useEffect, useState } from 'react'
import { useLinkedSolanaWallets } from '../wallet/embedded'
import { config } from '../onchain/config'
import { getAssetsByOwner, filterCollectorCryptAssets, dasAssetToCard, type InventoryCard } from './dasClient'

export interface OwnedCard extends InventoryCard {
  source: 'embedded' | 'connected'
}

export function useCollectorCryptNfts(): { cards: OwnedCard[]; loading: boolean; refresh: () => void } {
  const wallets = useLinkedSolanaWallets()
  const [cards, setCards] = useState<OwnedCard[]>([])
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)
  // Stable dependency key so the effect doesn't loop on array identity.
  const key = wallets.map((w) => `${w.source}:${w.address}`).join(',')

  useEffect(() => {
    if (wallets.length === 0) {
      setCards([])
      return
    }
    let cancelled = false
    setLoading(true)
    Promise.all(
      wallets.map(async (w) => {
        const assets = await getAssetsByOwner(config.dasRpcUrl, w.address)
        return filterCollectorCryptAssets(assets, config.ccCollectionMint).map((a) => ({
          ...dasAssetToCard(a),
          source: w.source,
        }))
      }),
    )
      .then((groups) => {
        if (!cancelled) setCards(groups.flat())
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `wallets` y `key` van siempre en sync (key deriva de wallets); depender de `key` evita el bucle por identidad del array
  }, [key, nonce])

  return { cards, loading, refresh: () => setNonce((n) => n + 1) }
}
