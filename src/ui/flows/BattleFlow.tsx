import { type ReactNode, type CSSProperties } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { COLORS, FONTS } from '../theme'
import { useBattle } from '../../onchain/useBattle'
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
  const exit = () => navigate('/app')

  if (!battle) {
    return <Centered>
      <div style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.muted }}>
        {error ? 'reconectando…' : 'Cargando batalla…'}
      </div>
    </Centered>
  }

  if (battle.status === 'lobby') {
    return <Centered>
      <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 18 }}>Esperando jugadores</div>
      <div style={{ fontFamily: FONTS.mono, fontSize: 24, color: COLORS.green }}>
        {battle.players.length}/{battle.max_players}
      </div>
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

  // running | settled → reveal (+ result when settled)
  const vm = battleToReveal(battle, meWallet)
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      {vm.mode === 'royale'
        ? <RoyaleReveal vm={vm} reducedMotion={!!reduced} />
        : <PackReveal vm={vm} reducedMotion={!!reduced} />}
      {battle.status === 'settled' && <BattleResult vm={vm} onExit={exit} />}
    </div>
  )
}

const backBtn: CSSProperties = {
  marginTop: 8, background: '#0c1019', color: COLORS.text, border: `1px solid ${COLORS.border}`,
  borderRadius: 10, padding: '10px 22px', fontWeight: 700, cursor: 'pointer',
}
