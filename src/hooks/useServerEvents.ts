import { useEffect, useRef } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { config } from '../onchain/config'

function wsUrl(token: string | null | undefined): string {
  const base = config.backendUrl.replace(/^http/, 'ws')
  const path = `${base}/ws/chat`
  return token ? `${path}?token=${encodeURIComponent(token)}` : path
}

/** Subscribe to the server WS and receive every message (chat, drops, emote, rematch, …). Callers
 *  filter by `type`. Reconnects with a fixed backoff. `enabled=false` skips the connection. */
export function useServerEvents(onEvent: (msg: unknown) => void, enabled = true): void {
  const { identityToken } = useIdentityToken()
  const cb = useRef(onEvent); cb.current = onEvent

  useEffect(() => {
    if (!enabled) return
    let ws: WebSocket | null = null
    let closed = false
    let reconnect: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      if (closed) return
      try { ws = new WebSocket(wsUrl(identityToken)) } catch { return }
      ws.onmessage = (ev) => { try { cb.current(JSON.parse(ev.data as string)) } catch { /* non-JSON */ } }
      ws.onclose = () => { if (!closed) reconnect = setTimeout(connect, 2500) }
      ws.onerror = () => { /* onclose handles reconnect */ }
    }
    connect()
    return () => {
      closed = true
      if (reconnect) clearTimeout(reconnect)
      if (ws) { ws.onclose = null; ws.close() }
    }
  }, [identityToken, enabled])
}
