import { useEffect, useRef, useState } from 'react'
import { Connection, PublicKey } from '@solana/web3.js'
import { usePrivy } from '@privy-io/react-auth'
import { useWallets } from '@privy-io/react-auth/solana'
import { config } from '../onchain/config'

// ─── Pure helper (exported for unit tests) ───────────────────────────────────

type TokenAccountLike = {
  account: {
    data: {
      parsed?: {
        info?: {
          tokenAmount?: {
            amount?: string
          }
        }
      }
    }
  }
}

export function sumUsdc(tokenAccounts: TokenAccountLike[]): number {
  let total = 0
  for (const ta of tokenAccounts) {
    const raw = ta?.account?.data?.parsed?.info?.tokenAmount?.amount
    if (raw == null) continue
    const n = Number(raw)
    if (!isNaN(n)) total += n
  }
  return total / 1e6
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useUsdcBalance(): { usdc: number | null; loading: boolean } {
  const { authenticated } = usePrivy()
  const { wallets } = useWallets()
  const [usdc, setUsdc] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const unmountedRef = useRef(false)

  const address = wallets[0]?.address ?? null
  const STAKE_MINT = import.meta.env.VITE_STAKE_MINT as string | undefined

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
    }
  }, [])

  useEffect(() => {
    if (!authenticated || !address || !STAKE_MINT) {
      setUsdc(null)
      setLoading(false)
      return
    }

    let intervalId: ReturnType<typeof setInterval> | null = null

    async function fetchBalance() {
      try {
        const connection = new Connection(config.rpcUrl, 'confirmed')
        const resp = await connection.getParsedTokenAccountsByOwner(
          new PublicKey(address!),
          { mint: new PublicKey(STAKE_MINT!) },
        )
        if (!unmountedRef.current) {
          setUsdc(sumUsdc(resp.value as TokenAccountLike[]))
          setLoading(false)
        }
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn('[useUsdcBalance] RPC error:', err)
        }
        if (!unmountedRef.current) {
          setLoading(false)
        }
      }
    }

    setLoading(true)
    fetchBalance()
    intervalId = setInterval(fetchBalance, 30_000)

    return () => {
      if (intervalId !== null) clearInterval(intervalId)
    }
  }, [authenticated, address, STAKE_MINT])

  return { usdc, loading }
}
