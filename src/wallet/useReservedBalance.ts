import { useEffect, useRef, useState } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { fetchReservedBalance } from '../onchain/packBattleClient'

/** On-chain USDC minus reserved (both dollars); clamps at 0. Falls back to usdc when reserved unknown. */
export function availableUsd(usdc: number | null, reserved: number | null): number | null {
  if (usdc == null) return null
  if (reserved == null) return usdc
  return Math.max(0, usdc - reserved)
}

/**
 * `reserved` = pack-battle soft holds, in dollars — money still in the wallet, so it drives
 * `available = on-chain − reserved`. `locked` = reserved + royale buy-ins already collected
 * on-chain into escrow — for DISPLAY only ("funds tied up in open battles"); never feed it to
 * availableUsd or royale money would be subtracted twice.
 */
export function useReservedBalance(): { reserved: number | null; locked: number | null } {
  const { identityToken } = useIdentityToken()
  const [reserved, setReserved] = useState<number | null>(null)
  const [locked, setLocked] = useState<number | null>(null)
  const unmounted = useRef(false)

  useEffect(() => {
    unmounted.current = false
    return () => { unmounted.current = true }
  }, [])

  useEffect(() => {
    if (!identityToken) { setReserved(null); setLocked(null); return }
    let timer: ReturnType<typeof setInterval> | null = null

    const poll = async () => {
      try {
        const { reserved: base, locked_royale = 0 } = await fetchReservedBalance(identityToken)
        if (!unmounted.current) {
          setReserved(base / 1e6)                    // base units → dollars (drives available)
          setLocked((base + locked_royale) / 1e6)    // pack holds + royale escrow (display)
        }
      } catch {
        if (!unmounted.current) { setReserved(null); setLocked(null) }  // never block the balance display
      }
    }

    poll()
    timer = setInterval(poll, 15_000)
    return () => { if (timer) clearInterval(timer) }
  }, [identityToken])

  return { reserved, locked }
}
