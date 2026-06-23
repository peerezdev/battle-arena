import { type ReactNode, type CSSProperties, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS } from '../theme'
import { useBattle } from '../../onchain/useBattle'
import { cancelBattle } from '../../onchain/packBattleClient'
import { useEmbeddedSolanaAddress } from '../../wallet/embedded'
import { useReducedMotion } from '../useReducedMotion'
import { battleToReveal } from '../screens/battle/battleReveal'
import { RoyaleReveal } from '../screens/battle/RoyaleReveal'
import { PackReveal } from '../screens/battle/PackReveal'
import { BattleResult } from '../screens/battle/BattleResult'

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
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [revealDone, setRevealDone] = useState(false)
  const exit = () => navigate('/app')

  function onCancelLobby() {
    if (!battle || !identityToken) return
    setCancelError(null)
    cancelBattle(identityToken, battle.id).catch((e) => {
      setCancelError(e instanceof Error ? e.message : String(e))
    })
  }

  if (!battle) {
    return <Centered>
      <div style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.muted }}>
        {error ? 'No se pudo cargar la batalla' : 'Cargando batalla…'}
      </div>
      {error && <button onClick={exit} style={backBtn}>Volver</button>}
    </Centered>
  }

  if (battle.status === 'lobby') {
    const isCreator = !!meWallet && battle.creator_wallet === meWallet
    return <Centered>
      <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 18 }}>Esperando jugadores</div>
      <div style={{ fontFamily: FONTS.mono, fontSize: 24, color: COLORS.green }}>
        {battle.players.length}/{battle.max_players}
      </div>
      {isCreator && (
        <button onClick={onCancelLobby} style={{ ...backBtn, borderColor: `${COLORS.red}55`, color: COLORS.red }}>
          Cancelar lobby
        </button>
      )}
      {cancelError && <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.red }}>{cancelError}</div>}
      <button onClick={exit} style={backBtn}>Volver</button>
    </Centered>
  }

  if (battle.status === 'voided' || battle.status === 'cancelled') {
    return <Centered>
      <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 18 }}>
        {battle.status === 'voided' ? 'Batalla anulada — reembolsado' : 'Lobby cancelado'}
      </div>
      <button onClick={exit} style={backBtn}>Volver</button>
    </Centered>
  }

  // running | settled → reveal (+ result, but only AFTER the pack reveal animation finishes)
  const vm = battleToReveal(battle, meWallet)
  const showResult = battle.status === 'settled' && (vm.mode === 'royale' || revealDone)
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      {vm.mode === 'royale'
        ? <RoyaleReveal vm={vm} reducedMotion={!!reduced} />
        : <PackReveal vm={vm} reducedMotion={!!reduced} onComplete={() => setRevealDone(true)} />}
      {showResult && <BattleResult vm={vm} battleId={battle.id} onExit={exit} />}
    </div>
  )
}

const backBtn: CSSProperties = {
  marginTop: 8, background: '#0c1019', color: COLORS.text, border: `1px solid ${COLORS.border}`,
  borderRadius: 10, padding: '10px 22px', fontWeight: 700, cursor: 'pointer',
}
