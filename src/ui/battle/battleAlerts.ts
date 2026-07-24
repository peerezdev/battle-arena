export interface BattleAlert {
  kind: 'join' | 'start'
  message: string
  actionLabel: string
  battleId: string
}

/**
 * Decide whether an incoming WS event should raise a toast for me, and what it should say.
 *
 * Returns null when the event isn't a battle alert, isn't mine, I triggered it (my own join), or
 * I'm already on that battle's screen (I'd see it live). The backend broadcasts to everyone and
 * each client self-filters by the `players` list — the same pattern as the rematch toast.
 */
export function battleAlertFor(
  msg: unknown,
  meWallet: string | null,
  currentPath: string,
): BattleAlert | null {
  if (!meWallet) return null
  const m = msg as {
    type?: string; battle_id?: string; players?: string[]; joiner?: string; joiner_name?: string
  }
  if (m?.type !== 'battle_join' && m?.type !== 'battle_start') return null
  if (!m.battle_id || !Array.isArray(m.players) || !m.players.includes(meWallet)) return null
  // Already watching this battle → the waiting room / reveal shows the change live, no toast.
  if (currentPath.includes(`/play/battle/${m.battle_id}`)) return null

  if (m.type === 'battle_join') {
    if (m.joiner === meWallet) return null   // my own join isn't news to me
    const who = m.joiner_name || 'A player'
    return { kind: 'join', message: `${who} joined your lobby`, actionLabel: 'View lobby', battleId: m.battle_id }
  }
  return { kind: 'start', message: 'Your battle is starting', actionLabel: 'View battle', battleId: m.battle_id }
}
