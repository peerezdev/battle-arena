import { useState, useEffect, useCallback } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { fijarToken, suscribir, suscribirEstado, enviar } from './serverSocket'
import { addDrop, seedDrops, type LiveDrop } from '../ui/drops/dropsStore'
import type { Mention, OnlineUser } from '../ui/screens/Hub/mentions'

export interface ChatAction { label: string; battleId: string; mode: string }
export interface ChatLine {
  user: string
  /** Wallet de quien habla, para enlazar a su perfil. Ausente en los mensajes anteriores a
   *  que se guardara y en los avisos de la casa, que no son de nadie. */
  wallet?: string
  text: string
  ts: number
  kind?: 'system'            // system announcements (battle created, big hit, winner)
  action?: ChatAction        // optional button (quick-join / view)
  event?: 'created' | 'hit' | 'winner'  // structured event for custom rendering (icon + name + gold value)
  amountUsd?: number         // stake/value styled in gold (created / hit / winner events)
  machine?: string           // gacha machine a hit came from (display name)
  mult?: number              // hit multiple (value ÷ cost), rendered as "(x10)"
  mode?: string              // 'pack' | 'royale'
  /** A quién menciona el mensaje. Ausente en los anteriores a las menciones y en los que no
   *  mencionan a nadie: el backend no manda la clave vacía. */
  mentions?: Mention[]
}

// La URL y el socket ya no se construyen aquí: los tiene serverSocket.ts, uno por pestaña.
// Este hook (montado a la vez en AppShell y en ChatDock) abría antes su propia conexión.

// Map a backend drop frame → LiveDrop. Backend emits ts in epoch SECONDS; the
// drops store + ago() use ms.
function dropFromMsg(msg: Record<string, unknown>): LiveDrop {
  return {
    id: (msg.id as string) ?? (msg.wallet as string) + ':' + (msg.ts as number),
    name: (msg.name as string) ?? 'Card',
    valueUsd: (msg.valueUsd as number | null) ?? null,
    rarity: (msg.rarity as string | null) ?? null,
    image: (msg.image as string | null) ?? null,
    source: 'gacha',
    wallet: msg.wallet as string,
    username: (msg.username as string | null) ?? null,
    ts: (msg.ts as number) * 1000,
  }
}

export function useChat(enabled = true): {
  messages: ChatLine[]
  send: (text: string, mentions?: Mention[]) => void
  connected: boolean
  canPost: boolean
  online: number
  /** Quién está conectado AHORA: es la fuente del autocompletado de menciones. */
  onlineUsers: OnlineUser[]
} {
  const { identityToken } = useIdentityToken()
  const [messages, setMessages] = useState<ChatLine[]>([])
  const [connected, setConnected] = useState(false)
  const [online, setOnline] = useState(0)
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])

  const canPost = !!identityToken

  useEffect(() => {
    if (!enabled) return
    let vivo = true

    fijarToken(identityToken ?? null)
    const bajaEstado = suscribirEstado((abierto) => { if (vivo) setConnected(abierto) })

    const linea = (m: Record<string, unknown>): ChatLine => ({
      user: m.user as string,
      wallet: m.wallet as string | undefined,
      text: m.text as string,
      ts: m.ts as number,
      kind: m.kind as 'system' | undefined,
      action: m.action as ChatAction | undefined,
      event: m.event as ChatLine['event'],
      amountUsd: m.amountUsd as number | undefined,
      mode: m.mode as string | undefined,
      machine: m.machine as string | undefined,
      mult: m.mult as number | undefined,
      mentions: m.mentions as Mention[] | undefined,
    })

    const baja = suscribir((crudo) => {
      if (!vivo) return
      const msg = crudo as Record<string, unknown> & { type?: string }
      if (msg.type === 'history' && Array.isArray(msg.messages)) {
        setMessages((msg.messages as Record<string, unknown>[]).map(linea))
      } else if (msg.type === 'message') {
        setMessages((prev) => [...prev, linea(msg)])
      } else if (msg.type === 'presence') {
        setOnline(msg.online as number)
        // Puede faltar si el backend es viejo: entonces no hay a quién mencionar y ya está.
        setOnlineUsers((msg.users as OnlineUser[]) ?? [])
      } else if (msg.type === 'drop') {
        // Global Live Drop broadcast by the backend (delayed ~30s so the opener
        // never sees their own drop spoil the reveal).
        addDrop(dropFromMsg(msg))
      } else if (msg.type === 'drops_history' && Array.isArray(msg.drops)) {
        // Recent-drops backlog the server replays on connect, so the feed is
        // consistent across origins/devices instead of depending on localStorage.
        seedDrops((msg.drops as Record<string, unknown>[]).map(dropFromMsg))
      } else if (msg.type === 'error') {
        console.warn('[useChat] server error:', msg.error)
      }
    })

    return () => { vivo = false; baja(); bajaEstado() }
  }, [identityToken, enabled])

  // `enviar` devuelve false si el socket no está abierto; el texto vacío no se manda.
  const send = useCallback((text: string, mentions?: Mention[]) => {
    if (!text.trim()) return
    // Sin menciones no se manda la clave: el servidor no tiene que distinguir "ninguna" de
    // "lista vacía", y los mensajes normales viajan igual que antes.
    enviar(mentions?.length ? { text: text.trim(), mentions } : { text: text.trim() })
  }, [])

  return { messages, send, connected, canPost, online, onlineUsers }
}
