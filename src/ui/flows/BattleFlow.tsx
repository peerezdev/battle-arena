import { type ReactNode, type CSSProperties, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS } from '../theme'
import { useBattle } from '../../onchain/useBattle'
import { cancelBattle, joinBot, joinAllBots, joinBattle } from '../../onchain/packBattleClient'
import { useEmbeddedSolanaAddress } from '../../wallet/embedded'
import { useReducedMotion } from '../useReducedMotion'
import { battleToReveal } from '../screens/battle/battleReveal'
import { useBattleEmotes } from '../emotes/useBattleEmotes'
import { RoyaleReveal, RoyaleResult } from '../screens/battle/RoyaleReveal'
import { PackReveal } from '../screens/battle/PackReveal'
import { BattleResult } from '../screens/battle/BattleResult'
import { WaitingRoom } from '../screens/battle/WaitingRoom'
import { showToast } from '../toast'

function Centered({ children }: { children: ReactNode }) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 12, padding: 24, textAlign: 'center', color: COLORS.text }}>
      {children}
    </div>
  )
}

export function BattleFlow() {
  const { battleId } = useParams<{ battleId: string }>()
  const navigate = useNavigate()
  const meWallet = useEmbeddedSolanaAddress()
  const reduced = useReducedMotion()
  const { battle, error } = useBattle(battleId ?? null, 1500)
  const { identityToken } = useIdentityToken()
  useBattleEmotes(battleId)   // render emotes thrown by other players in this battle

  const [cancelError, setCancelError] = useState<string | null>(null)
  const [revealDone, setRevealDone] = useState(false)
  const [royaleRevealDone, setRoyaleRevealDone] = useState(false)
  const [joiningBot, setJoiningBot] = useState(false)
  const [joiningAll, setJoiningAll] = useState(false)
  const [botError, setBotError] = useState<string | null>(null)
  const [joiningSelf, setJoiningSelf] = useState(false)
  const exit = () => navigate('/home')

  function onJoinSelf() {
    if (!battle) return
    if (!identityToken) { showToast('Sign in to join'); return }
    setJoiningSelf(true)
    joinBattle(identityToken, battle.id)
      .catch((e) => showToast(e instanceof Error ? e.message : String(e)))   // e.g. insufficient funds
      .finally(() => setJoiningSelf(false))
  }

  function onCancelLobby() {
    if (!battle || !identityToken) return
    setCancelError(null)
    cancelBattle(identityToken, battle.id).catch((e) => {
      setCancelError(e instanceof Error ? e.message : String(e))
    })
  }

  function onJoinBot() {
    if (!battle) return
    setBotError(null)
    setJoiningBot(true)
    joinBot(battle.id)
      .catch((e) => {
        const m = e instanceof Error ? e.message : String(e)
        setBotError(m)
        showToast(m)
      })
      .finally(() => setJoiningBot(false))
  }

  function onJoinAllBots() {
    if (!battle) return
    setBotError(null)
    setJoiningAll(true)
    joinAllBots(battle.id)
      .catch((e) => {
        const m = e instanceof Error ? e.message : String(e)
        setBotError(m)
        showToast(m)
      })
      .finally(() => setJoiningAll(false))
  }

  if (!battle) {
    return <Centered>
      <div style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.muted }}>
        {error ? 'Could not load the battle' : 'Loading battle…'}
      </div>
      {error && <button onClick={exit} style={backBtn}>Back</button>}
    </Centered>
  }

  if (battle.status === 'lobby') {
    return (
      <WaitingRoom
        battle={battle}
        meWallet={meWallet}
        onJoinSelf={onJoinSelf}
        onJoinBot={onJoinBot}
        onJoinAllBots={onJoinAllBots}
        onCancel={onCancelLobby}
        onExit={exit}
        joiningSelf={joiningSelf}
        joiningBot={joiningBot}
        joiningAll={joiningAll}
        botError={botError}
        cancelError={cancelError}
      />
    )
  }

  if (battle.status === 'voided' || battle.status === 'cancelled') {
    return <Centered>
      <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 18 }}>
        {battle.status === 'voided' ? 'Battle voided — refunded' : 'Lobby cancelled'}
      </div>
      <button onClick={exit} style={backBtn}>Back</button>
    </Centered>
  }

  // running | settled → reveal, then a SEPARATE result screen (the pack reveal is replaced,
  // not stacked, once its animation finishes).
  const vm = battleToReveal(battle, meWallet)

  if (vm.mode === 'pack') {
    return (
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {battle.status === 'settled' && revealDone
          ? <BattleResult vm={vm} battleId={battle.id} onExit={exit} />
          : <PackReveal vm={vm} reducedMotion={!!reduced} onComplete={() => setRevealDone(true)} onExit={exit} battleId={battle.id} />}
      </div>
    )
  }

  // royale: cinematic round-by-round reveal while running AND until the final round finishes
  // animating (onComplete). Only then does the champion/standings result screen replace it —
  // like the pack reveal's revealDone gate.
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      {battle.status === 'settled' && royaleRevealDone
        ? <RoyaleResult vm={vm} battleId={battle.id} onExit={exit} />
        : <RoyaleReveal vm={vm} reducedMotion={!!reduced} battleId={battle.id} onComplete={() => setRoyaleRevealDone(true)} />}
    </div>
  )
}

const backBtn: CSSProperties = {
  marginTop: 8, background: '#0c1019', color: COLORS.text, border: `1px solid ${COLORS.border}`,
  borderRadius: 10, padding: '10px 22px', fontWeight: 700, cursor: 'pointer',
}
