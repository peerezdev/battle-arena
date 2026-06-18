import type { HubNav } from '../screens/Hub/hubMockData'

/** nav id → destination route. lobby/ranks both live under /app (Hub sub-views). */
export const NAV_ROUTES: Record<HubNav, string> = {
  lobby: '/app',
  ranks: '/app',
  pack: '/play/arena',
  royale: '/play/royale',
  gacha: '/play/gacha',
  mana: '/play/mana',
}

/** Which sidebar item is active for a given pathname (null = none highlighted). */
export function activeNavFromPath(pathname: string): HubNav | null {
  if (pathname.startsWith('/play/arena')) return 'pack'
  if (pathname.startsWith('/play/royale')) return 'royale'
  if (pathname.startsWith('/play/gacha')) return 'gacha'
  if (pathname.startsWith('/play/mana')) return 'mana'
  if (pathname === '/app' || pathname.startsWith('/app')) return 'lobby'
  return null
}
