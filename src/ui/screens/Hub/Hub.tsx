import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS } from '../../theme'
import type { HubNav } from './hubMockData'
import { STAKE_OPTIONS } from './hubMockData'
import { QuickMatch } from './QuickMatch'
import { LiveBattles } from './LiveBattles'
import { useOpenBattles } from '../../../onchain/useOpenBattles'
import { openBattleToLive } from './openBattleToLive'
import { joinBattle } from '../../../onchain/packBattleClient'
import { useDelegationGate } from '../../components/useDelegationGate'
import { DelegationGate } from '../../components/DelegationGate'
import { CreateBattleModal } from './CreateBattleModal'
import { BattleWaiting } from './BattleWaiting'

export function Hub() {
  const navigate = useNavigate()
  const { identityToken } = useIdentityToken()
  const [stake, setStake] = useState<number>(STAKE_OPTIONS[1])
  const { battles } = useOpenBattles()
  const gate = useDelegationGate()
  const [waitingId, setWaitingId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const liveBattles = battles.map(openBattleToLive)

  function go(id: HubNav) {
    if (id === 'mana')   return navigate('/play/mana')
    if (id === 'royale') return navigate('/play/royale')
    if (id === 'pack')   return navigate('/play/arena')
    if (id === 'gacha')  return navigate('/play/gacha')
  }

  function onBattleAction(b: { id: string; action: 'watch' | 'join' }) {
    setActionError(null)
    if (b.action === 'watch') { setWaitingId(b.id); return }
    if (!identityToken) { setActionError('Inicia sesión para unirte.'); return }
    gate.requireDelegation(async () => {
      try {
        await joinBattle(identityToken, b.id)
        setWaitingId(b.id)
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e))
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
            · {liveBattles.length} lobbies abiertos
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
        <LiveBattles battles={liveBattles} onSelectMode={go} onBattleAction={onBattleAction} />
      </div>

      <DelegationGate gate={gate} />
      {createOpen && (
        <CreateBattleModal
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => { setCreateOpen(false); setWaitingId(id) }}
        />
      )}
      {waitingId && <BattleWaiting battleId={waitingId} onClose={() => setWaitingId(null)} />}
    </div>
  )
}
