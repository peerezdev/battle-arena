import type { LiveBattle } from './hubMockData'

/**
 * The most recently FINISHED Battle Royale, for the recap card next to Quick Match.
 *
 * Only settled games qualify: a running one has no final loot yet, and a voided/cancelled one was
 * refunded — showing either as "what was won" would be a lie. Ordering is by settle time, falling
 * back to creation time for rows the backend settled before it recorded `settled_at`.
 */
export function lastSettledRoyale(battles: LiveBattle[]): LiveBattle | null {
  return settledRoyales(battles)[0] ?? null
}

/**
 * Todas las royale terminadas, de más reciente a más antigua — la sección "Recent" de la pantalla
 * de Battle Royale, que acumula las anteriores bajo los lobbies.
 *
 * Mismos criterios que `lastSettledRoyale`, que ahora no es más que el primer elemento de esto: al
 * derivar una de otra no pueden discrepar sobre cuál es la última. La lista viene acotada de origen
 * (el backend devuelve como mucho 25 partidas recientes), así que no hace falta recortarla aquí.
 */
export function settledRoyales(battles: LiveBattle[]): LiveBattle[] {
  const t = (b: LiveBattle) => Date.parse(b.settledAt ?? b.createdAt ?? '') || 0
  return battles
    .filter((b) => b.mode === 'royale' && b.battleStatus === 'settled')
    .sort((a, b) => t(b) - t(a))
}
