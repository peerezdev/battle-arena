import { useEffect } from 'react'
import { BigPullTicker } from './BigPullTicker'
import { BestHitCard } from './BestHitCard'
import { NewsCarousel } from './NewsCarousel'
import { ModeGuide } from './ModeGuide'
import { useEmbeddedSolanaAddress } from '../../../wallet/embedded'
import { loadMachineList } from '../../useMachines'

/**
 * Home — the overview landing. Quick Match + Live games now live on the mode-specific pages
 * (Pack Battle / Battle Royale); Home keeps the ticker, news, best hit, and the mode guide that
 * routes players into each mode.
 */
export function Hub() {
  const meWallet = useEmbeddedSolanaAddress()

  // Warm the machine catalogue so the Pack/Royale pages open with machines ready.
  useEffect(() => { void loadMachineList() }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <BigPullTicker meWallet={meWallet} />
      <div style={{ padding: '24px 16px 40px' }}>
        <NewsCarousel />
        <div style={{ maxWidth: 460, margin: '0 0 26px' }}>
          <BestHitCard meWallet={meWallet} />
        </div>
        <ModeGuide />
      </div>
    </div>
  )
}
