import { useEffect, useRef, useState } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { isBalanceHeld, useBalanceHeld } from './balanceHold'
import { config } from '../onchain/config'

// ─── Hook ────────────────────────────────────────────────────────────────────
//
// On-chain USDC balance of the caller's embedded wallet.
//
// Read through the backend (GET /users/me/usdc), NOT directly from the RPC. The public
// mainnet RPC (api.mainnet-beta.solana.com) returns 403 to browser Origins, so a browser
// cannot query token balances there at all. The backend has no Origin header and already
// holds the per-network rpc_url + USDC mint, so it reads the balance reliably — identical
// behavior on devnet and mainnet, and no RPC provider key exposed in the client.

export function useUsdcBalance(): { usdc: number | null; loading: boolean } {
  // Al soltar la congelación hay que repintar en cuanto se pueda: si no, el saldo real tardaría
  // hasta 30s en aparecer y el usuario vería un número que ya no es el suyo.
  const held = useBalanceHeld()
  const { identityToken } = useIdentityToken()
  const [usdc, setUsdc] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const unmountedRef = useRef(false)

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
    }
  }, [])

  useEffect(() => {
    if (!identityToken) {
      setUsdc(null)
      setLoading(false)
      return
    }
    const token = identityToken // narrowed to string for the async closure below

    let intervalId: ReturnType<typeof setInterval> | null = null

    async function fetchBalance() {
      try {
        const resp = await fetch(`${config.backendUrl}/users/me/usdc`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'ngrok-skip-browser-warning': 'true',
          },
        })
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const data = (await resp.json()) as { usdc?: number }
        if (!unmountedRef.current) {
          // Con una tirada sin revelar, el saldo se queda como estaba: el auto-buyback del turbo
          // lo sube en cuanto CC abre el sobre por dentro, y verlo subir destripa el resultado
          // antes del reveal. Se sigue consultando (así al soltar ya está fresco), pero no se pinta.
          if (!isBalanceHeld()) setUsdc(typeof data.usdc === 'number' ? data.usdc : 0)
          setLoading(false)
        }
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn('[useUsdcBalance] balance error:', err)
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
  }, [identityToken, held])

  return { usdc, loading }
}
