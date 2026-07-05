import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS } from '../../theme'
import type { LiveBattle, BattleMode } from './hubMockData'
import { STAKE_OPTIONS } from './hubMockData'
import { QuickMatch } from './QuickMatch'
import { LiveBattles } from './LiveBattles'
import { showToast } from '../../toast'
import { useOpenBattles } from '../../../onchain/useOpenBattles'
import { openBattleToLive } from './openBattleToLive'
import { joinBattle, cancelBattle } from '../../../onchain/packBattleClient'
import { useEmbeddedSolanaAddress } from '../../../wallet/embedded'
import { useDelegationGate } from '../../components/useDelegationGate'
import { DelegationGate } from '../../components/DelegationGate'
import { CreateBattleModal } from './CreateBattleModal'
import { DemoPicker } from './DemoPicker'
import { loadMachineList } from '../../useMachines'

/**
 * Mode-focused page (Pack Battle / Battle Royale): the adapted Quick Match (create locked to this
 * mode) plus Live games filtered to this mode only. Shared by the /play/arena and /play/royale routes.
 */
export function ModeHub({ mode }: { mode: Extract<BattleMode, 'pack' | 'royale'> }) {
  const navigate = useNavigate()
  const { identityToken } = useIdentityToken()
  const meWallet = useEmbeddedSolanaAddress()
  const [stake, setStake] = useState<number>(STAKE_OPTIONS[1])
  const { battles } = useOpenBattles()
  const gate = useDelegationGate()
  const [createOpen, setCreateOpen] = useState(false)
  const [demoOpen, setDemoOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // Warm the machine catalogue so Create Battle opens with machines ready.
  useEffect(() => { void loadMachineList() }, [])

  const liveBattles = battles
    .map((b) => openBattleToLive(b, meWallet))
    .filter((b) => b.mode === mode)

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
      <QuickMatch
        mode={mode}
        selectedStake={stake}
        onStake={setStake}
        onCreate={() => setCreateOpen(true)}
        onPlayDemo={mode === 'pack' ? () => setDemoOpen(true) : undefined}
      />

      <div>
        {actionError && (<div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.red, margin: '0 0 12px' }}>{actionError}</div>)}
        <LiveBattles battles={liveBattles} onBattleAction={onBattleAction} onCancel={onCancel} onOpen={(b) => navigate('/play/battle/' + b.id)} />
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
