import type { LiveBattle } from './hubMockData'

/**
 * The most recently FINISHED Battle Royale, for the recap card next to Quick Match.
 *
 * Only settled games qualify: a running one has no final loot yet, and a voided/cancelled one was
 * refunded — showing either as "what was won" would be a lie. Ordering is by settle time, falling
 * back to creation time for rows the backend settled before it recorded `settled_at`.
 */
export function lastSettledRoyale(battles: LiveBattle[]): LiveBattle | null {
  const t = (b: LiveBattle) => Date.parse(b.settledAt ?? b.createdAt ?? '') || 0
  const done = battles.filter((b) => b.mode === 'royale' && b.battleStatus === 'settled')
  if (done.length === 0) return null
  return done.reduce((best, b) => (t(b) > t(best) ? b : best))
}
