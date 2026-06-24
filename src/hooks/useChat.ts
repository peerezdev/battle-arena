import { useState, useEffect, useRef, useCallback } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { config } from '../onchain/config'
import { addDrop } from '../ui/drops/dropsStore'

export interface ChatLine { user: string; text: string; ts: number }

function buildWsUrl(identityToken: string | null | undefined): string {
  // Replace leading http(s) with ws(s), then append /ws/chat
  const base = config.backendUrl.replace(/^http/, 'ws')
  const path = `${base}/ws/chat`
  return identityToken ? `${path}?token=${encodeURIComponent(identityToken)}` : path
}

export function useChat(): {
  messages: ChatLine[]
  send: (text: string) => void
  connected: boolean
  canPost: boolean
  online: number
} {
  const { identityToken } = useIdentityToken()
  const [messages, setMessages] = useState<ChatLine[]>([])
  const [connected, setConnected] = useState(false)
  const [online, setOnline] = useState(0)

  const wsRef = useRef<WebSocket | null>(null)
  const mountedRef = useRef(true)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const canPost = !!identityToken

  useEffect(() => {
    mountedRef.current = true

    function connect() {
      if (!mountedRef.current) return

      const url = buildWsUrl(identityToken)
      let ws: WebSocket

      try {
        ws = new WebSocket(url)
      } catch {
        // If WebSocket constructor throws (invalid URL, etc.) stay disconnected
        return
      }

      wsRef.current = ws

      ws.onopen = () => {
        if (mountedRef.current) setConnected(true)
      }

      ws.onmessage = (event: MessageEvent) => {
        if (!mountedRef.current) return
        try {
          const msg = JSON.parse(event.data as string)
          if (msg.type === 'history' && Array.isArray(msg.messages)) {
            setMessages(
              (msg.messages as Array<{ user: string; text: string; ts: number }>).map((m) => ({
                user: m.user,
                text: m.text,
                ts: m.ts,
              })),
            )
          } else if (msg.type === 'message') {
            setMessages((prev) => [
              ...prev,
              { user: msg.user as string, text: msg.text as string, ts: msg.ts as number },
            ])
          } else if (msg.type === 'presence') {
            setOnline(msg.online as number)
          } else if (msg.type === 'drop') {
            // Global Live Drop broadcast by the backend (delayed ~30s so the
            // opener never sees their own drop spoil the reveal).
            addDrop({
              id: (msg.id as string) ?? (msg.wallet as string) + ':' + (msg.ts as number),
              name: (msg.name as string) ?? 'Card',
              valueUsd: (msg.valueUsd as number | null) ?? null,
              rarity: (msg.rarity as string | null) ?? null,
              image: (msg.image as string | null) ?? null,
              source: 'gacha',
              wallet: msg.wallet as string,
              username: (msg.username as string | null) ?? null,
              // Backend emits ts in epoch SECONDS; the drops store + ago() use ms.
              ts: (msg.ts as number) * 1000,
            })
          } else if (msg.type === 'error') {
            console.warn('[useChat] server error:', msg.error)
          }
        } catch {
          // Ignore non-JSON frames
        }
      }

      ws.onclose = () => {
        if (!mountedRef.current) return
        setConnected(false)
        // Schedule reconnect
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current) connect()
        }, 2000)
      }

      ws.onerror = () => {
        // onclose will fire right after onerror; reconnect is handled there
      }
    }

    connect()

    return () => {
      mountedRef.current = false
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.onclose = null // prevent reconnect loop on cleanup
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [identityToken])

  const send = useCallback((text: string) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN && text.trim()) {
      ws.send(JSON.stringify({ text: text.trim() }))
    }
  }, [])

  return { messages, send, connected, canPost, online }
}
