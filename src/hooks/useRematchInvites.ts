import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useIdentityToken } from '@privy-io/react-auth'
import { config } from '../onchain/config'
import { useEmbeddedSolanaAddress } from '../wallet/embedded'
import { rematchBattle } from '../onchain/packBattleClient'
import { showToast } from '../ui/toast'

function wsUrl(token: string | null | undefined): string {
  const base = config.backendUrl.replace(/^http/, 'ws')
  const path = `${base}/ws/chat`
  return token ? `${path}?token=${encodeURIComponent(token)}` : path
}

/**
 * App-wide listener: when a battle you were in gets a rematch (created by someone else), pop a toast
 * with a Join button — even if you already left the result screen. Filters the WS broadcast to the
 * finished battle's participants (and never re-notifies the creator).
 */
export function useRematchInvites(): void {
  const { identityToken } = useIdentityToken()
  const meWallet = useEmbeddedSolanaAddress()
  const navigate = useNavigate()
  const navRef = useRef(navigate); navRef.current = navigate
  const meRef = useRef(meWallet); meRef.current = meWallet
  const tokenRef = useRef(identityToken); tokenRef.current = identityToken

  useEffect(() => {
    if (!meWallet) return
    let ws: WebSocket | null = null
    let closed = false
    let reconnect: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      if (closed) return
      try { ws = new WebSocket(wsUrl(identityToken)) } catch { return }
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data as string)
          if (m?.type !== 'rematch') return
          const me = meRef.current
          if (!me || m.from === me || !Array.isArray(m.players) || !m.players.includes(me)) return
          showToast('Rematch — a player wants a rematch', 'info', {
            label: 'Join',
            onClick: async () => {
              // Auto-join the rematch (funds handled by the join path), then go to it. If the join
              // fails (e.g. insufficient funds) still take them there so they can see it / deposit.
              try {
                const r = await rematchBattle(tokenRef.current!, m.finished_battle_id)
                navRef.current(`/play/battle/${r.battle_id}`)
              } catch (e) {
                navRef.current(`/play/battle/${m.rematch_battle_id}`)
                showToast(e instanceof Error ? e.message : 'Could not join the rematch')
              }
            },
          })
        } catch { /* ignore non-JSON / unrelated messages */ }
      }
      ws.onclose = () => { if (!closed) reconnect = setTimeout(connect, 2500) }
      ws.onerror = () => { /* onclose handles reconnect */ }
    }
    connect()
    return () => {
      closed = true
      if (reconnect) clearTimeout(reconnect)
      if (ws) { ws.onclose = null; ws.close() }
    }
  }, [meWallet, identityToken])
}
