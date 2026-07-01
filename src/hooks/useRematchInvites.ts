import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useIdentityToken } from '@privy-io/react-auth'
import { useEmbeddedSolanaAddress } from '../wallet/embedded'
import { rematchBattle } from '../onchain/packBattleClient'
import { showToast } from '../ui/toast'
import { useServerEvents } from './useServerEvents'

/**
 * App-wide listener: when a battle you were in gets a rematch (created by someone else), pop a toast
 * with a Join button — even if you already left the result screen. Filters the WS broadcast to the
 * finished battle's participants (and never re-notifies the creator). Join auto-joins the rematch.
 */
export function useRematchInvites(): void {
  const { identityToken } = useIdentityToken()
  const meWallet = useEmbeddedSolanaAddress()
  const navigate = useNavigate()
  const navRef = useRef(navigate); navRef.current = navigate
  const meRef = useRef(meWallet); meRef.current = meWallet
  const tokenRef = useRef(identityToken); tokenRef.current = identityToken

  useServerEvents((msg) => {
    const m = msg as { type?: string; from?: string; players?: string[]; finished_battle_id?: string; rematch_battle_id?: string }
    if (m?.type !== 'rematch') return
    const me = meRef.current
    if (!me || m.from === me || !Array.isArray(m.players) || !m.players.includes(me)) return
    showToast('Rematch — a player wants a rematch', 'info', {
      label: 'Join',
      onClick: async () => {
        // Auto-join the rematch (funds handled by the join path), then go to it. If the join fails
        // (e.g. insufficient funds) still take them there so they can see it / deposit.
        try {
          const r = await rematchBattle(tokenRef.current!, m.finished_battle_id!)
          navRef.current(`/play/battle/${r.battle_id}`)
        } catch (e) {
          navRef.current(`/play/battle/${m.rematch_battle_id}`)
          showToast(e instanceof Error ? e.message : 'Could not join the rematch')
        }
      },
    })
  }, !!meWallet)
}
