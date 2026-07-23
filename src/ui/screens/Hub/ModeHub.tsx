import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS } from '../../theme'
import type { LiveBattle, BattleMode } from './hubMockData'
import { QuickMatch } from './QuickMatch'
import { LiveBattles } from './LiveBattles'
import { RoyaleBattleWide } from './RoyaleBattleWide'
import { LastRoyaleCard } from './LastRoyaleCard'
import { lastSettledRoyale } from './lastRoyale'
import { useIsWide } from '../../useIsWide'
import { showToast } from '../../toast'
import { useBattles } from '../../../onchain/useBattles'
import { openBattleToLive } from './openBattleToLive'
import { joinBattle, cancelBattle } from '../../../onchain/packBattleClient'
import { useEmbeddedSolanaAddress } from '../../../wallet/embedded'
import { useDelegationGate } from '../../components/useDelegationGate'
import { DelegationGate } from '../../components/DelegationGate'
import { CreateBattleModal } from './CreateBattleModal'
import { DemoPicker } from './DemoPicker'
import { loadMachineList } from '../../useMachines'
import { canCreateRoyale } from '../../../onchain/config'

/**
 * Mode-focused page (Pack Battle / Battle Royale): the adapted Quick Match (create locked to this
 * mode) plus Live games filtered to this mode only. Shared by the /play/arena and /play/royale routes.
 */
export function ModeHub({ mode }: { mode: Extract<BattleMode, 'pack' | 'royale'> }) {
  const navigate = useNavigate()
  const { identityToken } = useIdentityToken()
  const meWallet = useEmbeddedSolanaAddress()
  const { battles } = useBattles()
  const gate = useDelegationGate()
  const sideBySide = useIsWide('(min-width: 980px)')
  const [createOpen, setCreateOpen] = useState(false)
  const [demoOpen, setDemoOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // Warm the machine catalogue so Create Battle opens with machines ready.
  useEffect(() => { void loadMachineList() }, [])

  const liveBattles = battles
    .map((b) => openBattleToLive(b, meWallet))
    .filter((b) => b.mode === mode)
  // The royale wide cards are join lobbies only — drop live/finished rows the /list feed now carries.
  const royaleOpen = liveBattles.filter((b) => !b.battleStatus || b.battleStatus === 'lobby')
  // Recap card beside Quick Match. Royale page only, and only once a royale has actually finished.
  const lastRoyale = mode === 'royale' ? lastSettledRoyale(liveBattles) : null

  function onCancel(b: LiveBattle) {
    setActionError(null)
    if (!identityToken) { setActionError('Sign in to cancel.'); return }
    cancelBattle(identityToken, b.id).catch((e) => setActionError(e instanceof Error ? e.message : String(e)))
  }

  function onBattleAction(b: LiveBattle) {
    setActionError(null)
    if (b.action === 'watch') { navigate('/play/battle/' + b.id); return }
    if (!identityToken) { setActionError('Sign in to join.'); return }
    gate.requireDelegation(async () => {
      try {
        await joinBattle(identityToken, b.id)
        navigate('/play/battle/' + b.id)
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e)
        setActionError(m); showToast(m)
      }
    })
  }

  return (
    <div style={{ padding: '24px clamp(14px,2.4vw,28px) 44px', display: 'flex', flexDirection: 'column', gap: 26 }}>
      {/* Quick Match with the last-royale recap to its right; stacks under it when there's no room. */}
      <div style={{ display: 'flex', flexDirection: sideBySide ? 'row' : 'column', alignItems: sideBySide ? 'center' : 'stretch', gap: 26 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <QuickMatch
            mode={mode}
            onCreate={() => setCreateOpen(true)}
            onPlayDemo={mode === 'pack' ? () => setDemoOpen(true) : undefined}
            canCreate={mode === 'royale' ? canCreateRoyale(meWallet) : true}
          />
        </div>
        {lastRoyale && (
          <div style={{ flex: 'none', width: sideBySide ? 340 : 'auto' }}>
            <LastRoyaleCard battle={lastRoyale} onOpen={(b) => navigate(`/play/battle/${b.id}?view=result`)} />
          </div>
        )}
      </div>

      <div>
        {actionError && (<div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.red, margin: '0 0 12px' }}>{actionError}</div>)}
        {/* Battle Royale uses the new wide lobby card; Pack Battle keeps the compact LiveBattles grid. */}
        {mode === 'royale' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {royaleOpen.length === 0
              ? <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted }}>No open Battle Royale lobbies right now.</div>
              : royaleOpen.map((b) => (
                  <RoyaleBattleWide key={b.id} battle={b} meWallet={meWallet}
                    onAction={onBattleAction} onCancel={onCancel} onOpen={(x) => navigate('/play/battle/' + x.id)} />
                ))}
          </div>
        ) : (
          <LiveBattles battles={liveBattles} meWallet={meWallet} onBattleAction={onBattleAction} onCancel={onCancel} onOpen={(b) => navigate('/play/battle/' + b.id)} />
        )}
      </div>

      <DelegationGate gate={gate} />
      {createOpen && (
        <CreateBattleModal
          lockedMode={mode}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => { setCreateOpen(false); navigate('/play/battle/' + id) }}
        />
      )}
      {demoOpen && (
        <DemoPicker
          onClose={() => setDemoOpen(false)}
          onPick={(m) => { setDemoOpen(false); navigate('/play/demo/' + m) }}
        />
      )}
    </div>
  )
}
