import { useEffect } from 'react'
import { BigPullTicker } from './BigPullTicker'
import { ModeSections } from './ModeSections'
import { useEmbeddedSolanaAddress } from '../../../wallet/embedded'
import { loadMachineList } from '../../useMachines'

/**
 * Home — the overview landing. Quick Match + Live games live on the mode-specific pages
 * (Pack Battle / Battle Royale); Home is the big-pull ticker plus the mode sections that route
 * players into each mode. NewsCarousel / BestHitCard / ModeGuide are kept for possible reuse
 * but no longer rendered here.
 */
export function Hub() {
  const meWallet = useEmbeddedSolanaAddress()

  // Warm the machine catalogue so the Pack/Royale pages open with machines ready.
  useEffect(() => { void loadMachineList() }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <BigPullTicker meWallet={meWallet} />
      <ModeSections />
    </div>
  )
}
