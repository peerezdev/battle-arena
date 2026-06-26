import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS } from '../../theme'
import type { HubNav, LiveBattle } from './hubMockData'
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
import { loadMachineList } from '../../useMachines'

export function Hub() {
  const navigate = useNavigate()
  const { identityToken } = useIdentityToken()
  const meWallet = useEmbeddedSolanaAddress()
  const [stake, setStake] = useState<number>(STAKE_OPTIONS[1])
  const { battles } = useOpenBattles()
  const gate = useDelegationGate()
  const [createOpen, setCreateOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // Warm the machine catalogue cache on lobby load so Create Battle opens with machines ready.
  useEffect(() => { void loadMachineList() }, [])

  const liveBattles = battles.map((b) => openBattleToLive(b, meWallet))

  function go(id: HubNav) {
    if (id === 'mana')   return navigate('/play/mana')
    if (id === 'royale') return navigate('/play/royale')
    if (id === 'pack')   return navigate('/play/arena')
    if (id === 'gacha')  return navigate('/play/gacha')
  }

  function onCancel(b: LiveBattle) {
    setActionError(null)
    if (!identityToken) { setActionError('Sign in to cancel.'); return }
    cancelBattle(identityToken, b.id).catch((e) => {
      setActionError(e instanceof Error ? e.message : String(e))
    })
    // the open list + reserved refresh on their next poll
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
        setActionError(m)
        showToast(m)
      }
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 16px',
        borderBottom: `1px solid ${COLORS.border}` }}>
        <div>
          <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 20,
            letterSpacing: '-0.01em', color: COLORS.text }}>Lobby</span>
          <span style={{ color: COLORS.muted, fontWeight: 500, fontSize: 13, marginLeft: 10 }}>
            · {liveBattles.length} open lobbies
          </span>
        </div>
      </div>
      <div style={{ padding: '24px 16px 40px' }}>
        <QuickMatch
          selectedStake={stake}
          onStake={setStake}
          onFindMatch={() => setCreateOpen(true)}
          onCreate={() => setCreateOpen(true)}
        />
        {actionError && (
          <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.red, margin: '0 0 12px' }}>
            {actionError}
          </div>
        )}
        <LiveBattles battles={liveBattles} onSelectMode={go} onBattleAction={onBattleAction} onCancel={onCancel} onOpen={(b) => navigate('/play/battle/' + b.id)} />
      </div>

      <DelegationGate gate={gate} />
      {createOpen && (
        <CreateBattleModal
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => { setCreateOpen(false); navigate('/play/battle/' + id) }}
        />
      )}
    </div>
  )
}
