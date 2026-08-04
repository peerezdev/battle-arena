import { useEffect, useRef } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { fijarToken, suscribir } from './serverSocket'

/** Subscribe to the server WS and receive every message (chat, drops, emote, rematch, …). Callers
 *  filter by `type`. `enabled=false` skips the subscription.
 *
 *  La conexión ya NO es de este hook: la comparte toda la pestaña (ver serverSocket.ts). Antes
 *  cada consumidor abría la suya —useBattleEmotes, BattleAlertsHost y RematchToast usan este
 *  hook— y una sola pestaña mantenía cuatro sockets, que el backend contaba como cuatro
 *  jugadores en línea. */
export function useServerEvents(onEvent: (msg: unknown) => void, enabled = true): void {
  const { identityToken } = useIdentityToken()
  const cb = useRef(onEvent); cb.current = onEvent

  useEffect(() => {
    if (!enabled) return
    fijarToken(identityToken ?? null)
    return suscribir((msg) => cb.current(msg))
  }, [identityToken, enabled])
}
