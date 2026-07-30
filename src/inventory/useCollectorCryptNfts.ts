import { useEffect, useState } from 'react'
import { useEmbeddedSolanaAddress } from '../wallet/embedded'
import { config } from '../onchain/config'
import { getAssetsByOwner, filterCollectorCryptAssets, dasAssetToCard, type InventoryCard } from './dasClient'

export interface OwnedCard extends InventoryCard {
  source: 'embedded' | 'connected'
}

/**
 * Cartas de Collector Crypt en la embedded wallet del usuario — y solo en esa.
 *
 * Antes se leían TODAS las wallets Solana vinculadas, incluida una externa tipo Phantom, y se
 * mezclaban en la misma cuadrícula. Eso enseñaba cartas sobre las que el inventario no puede hacer
 * nada: el buyback y el withdraw solo funcionan desde la embedded, así que las de una wallet
 * conectada aparecían y luego se negaban a venderse. El inventario muestra ahora la wallet del
 * juego, que es la que puede operar.
 *
 * `source` se mantiene porque la pestaña reutiliza `OwnedCard` para el inventario público de otro
 * jugador, donde marca las cartas como 'connected' para desactivar las acciones.
 */
export function useCollectorCryptNfts(): { cards: OwnedCard[]; loading: boolean; refresh: () => void } {
  const address = useEmbeddedSolanaAddress()
  const [cards, setCards] = useState<OwnedCard[]>([])
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!address) {
      setCards([])
      return
    }
    let cancelled = false
    setLoading(true)
    getAssetsByOwner(config.dasRpcUrl, address)
      .then((assets) => {
        if (cancelled) return
        setCards(
          filterCollectorCryptAssets(assets, config.ccCollectionMints).map((a) => ({
            ...dasAssetToCard(a),
            source: 'embedded' as const,
          })),
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [address, nonce])

  return { cards, loading, refresh: () => setNonce((n) => n + 1) }
}
