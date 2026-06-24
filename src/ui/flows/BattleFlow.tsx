import { type ReactNode, type CSSProperties, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS, GRADIENT } from '../theme'
import { useBattle } from '../../onchain/useBattle'
import { cancelBattle, joinBot } from '../../onchain/packBattleClient'
import { useEmbeddedSolanaAddress } from '../../wallet/embedded'
import { useReducedMotion } from '../useReducedMotion'
import { battleToReveal } from '../screens/battle/battleReveal'
import { RoyaleReveal } from '../screens/battle/RoyaleReveal'
import { PackReveal } from '../screens/battle/PackReveal'
import { BattleResult } from '../screens/battle/BattleResult'
import { CardBack } from '../screens/battle/CardBack'
import { shortWallet } from '../screens/battle/RoyaleReveal'

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
  const [joiningBot, setJoiningBot] = useState(false)
  const [botError, setBotError] = useState<string | null>(null)
  const exit = () => navigate('/app')

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
      .catch((e) => setBotError(e instanceof Error ? e.message : String(e)))
      .finally(() => setJoiningBot(false))
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
    const slots = Array.from({ length: battle.max_players }, (_, i) => battle.players[i] ?? null)
    return (
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 20 }}>Esperando jugadores</div>
        <div style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.muted }}>
          {battle.players.length}/{battle.max_players} · {battle.mode.toUpperCase()}
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 680 }}>
          {slots.map((p, i) => {
            const isMe = !!p && !!meWallet && p.wallet === meWallet
            const accent = isMe ? COLORS.green : COLORS.violet
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, width: 132 }}>
                {p ? (
                  <>
                    <div style={{
                      width: 56, height: 56, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: FONTS.display, fontWeight: 900, fontSize: 16, border: `2px solid ${accent}`,
                      color: accent, boxShadow: `0 0 14px ${accent}66`,
                    }}>
                      {isMe ? 'TÚ' : p.wallet.slice(0, 2)}
                    </div>
                    <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: isMe ? COLORS.green : COLORS.muted }}>
                      {isMe ? 'Tú' : shortWallet(p.wallet)}
                    </div>
                  </>
                ) : (
                  <>
                    <CardBack width={92} height={128} accent={COLORS.border} label="vacío" />
                    <button onClick={onJoinBot} disabled={joiningBot} style={joinBotBtn}>
                      {joiningBot ? '…' : '+ Join Bot'}
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>
        {botError && <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.red }}>{botError}</div>}
        {isCreator && (
          <button onClick={onCancelLobby} style={{ ...backBtn, borderColor: `${COLORS.red}55`, color: COLORS.red }}>
            Cancelar lobby
          </button>
        )}
        {cancelError && <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.red }}>{cancelError}</div>}
        <button onClick={exit} style={backBtn}>Volver</button>
      </div>
    )
  }

  if (battle.status === 'voided' || battle.status === 'cancelled') {
    return <Centered>
      <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 18 }}>
        {battle.status === 'voided' ? 'Batalla anulada — reembolsado' : 'Lobby cancelado'}
      </div>
      <button onClick={exit} style={backBtn}>Volver</button>
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
          : <PackReveal vm={vm} reducedMotion={!!reduced} onComplete={() => setRevealDone(true)} />}
      </div>
    )
  }

  // royale: rounds list + result below when settled (unchanged)
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <RoyaleReveal vm={vm} reducedMotion={!!reduced} />
      {battle.status === 'settled' && <BattleResult vm={vm} battleId={battle.id} onExit={exit} />}
    </div>
  )
}

const backBtn: CSSProperties = {
  marginTop: 8, background: '#0c1019', color: COLORS.text, border: `1px solid ${COLORS.border}`,
  borderRadius: 10, padding: '10px 22px', fontWeight: 700, cursor: 'pointer',
}

const joinBotBtn: CSSProperties = {
  background: GRADIENT, color: '#06120c', border: 'none', borderRadius: 10,
  padding: '8px 14px', fontWeight: 800, fontSize: 12, cursor: 'pointer', fontFamily: FONTS.display,
}
