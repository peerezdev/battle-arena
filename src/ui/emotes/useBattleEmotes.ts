import { useRef } from 'react'
import { useServerEvents } from '../../hooks/useServerEvents'
import { useEmotes } from './useEmotes'
import { throwEmote } from './throwEmote'

/** Receive emotes thrown by other players in this battle (over the WS) and pop the bubble over the
 *  sender's panel. No-op for the demo (no real battle to subscribe to). */
export function useBattleEmotes(battleId: string | undefined): void {
  const { byCode } = useEmotes()   // catalog: code → { video_url }
  const byCodeRef = useRef(byCode); byCodeRef.current = byCode
  const bidRef = useRef(battleId); bidRef.current = battleId

  useServerEvents((msg) => {
    const m = msg as { type?: string; battle_id?: string; from?: string; code?: string }
    if (m?.type !== 'emote' || m.battle_id !== bidRef.current) return
    const e = m.code ? byCodeRef.current[m.code] : undefined
    if (e && m.from) throwEmote(m.from, e.video_url)
  }, !!battleId && battleId !== 'demo')
}
