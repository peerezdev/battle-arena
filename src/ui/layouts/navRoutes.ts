import type { HubNav } from '../screens/Hub/hubMockData'

/** nav id → destination route. lobby lives under /app; ranks → the Leaderboard screen. */
export const NAV_ROUTES: Record<HubNav, string> = {
  lobby: '/play/lobby',
  ranks: '/ranking',
  pack: '/play/arena',
  royale: '/play/royale',
  gacha: '/play/gacha',
  tracker: '/machine-tracker',
  winners: '/winners',
  mana: '/play/mana',
  help: '/help',
}

/** Which sidebar item is active for a given pathname (null = none highlighted). */
export function activeNavFromPath(pathname: string): HubNav | null {
  if (pathname.startsWith('/play/battle')) return 'lobby'
  // Pack y Royale ya no son destinos: redirigen al Lobby con el filtro puesto.
  if (pathname.startsWith('/play/lobby')) return 'lobby'
  if (pathname.startsWith('/play/arena')) return 'lobby'
  if (pathname.startsWith('/play/royale')) return 'lobby'
  if (pathname.startsWith('/play/gacha')) return 'gacha'
  if (pathname.startsWith('/play/mana')) return 'mana'
  if (pathname.startsWith('/machine-tracker')) return 'tracker'
  // Winners ya no está en la barra, así que su ruta no enciende nada.
  if (pathname.startsWith('/winners')) return null
  if (pathname.startsWith('/ranking')) return 'ranks'
  // Home ya no está en la barra: es la portada de quien no ha entrado, así que no se marca nada.
  if (pathname === '/home' || pathname.startsWith('/home')) return null
  if (pathname.startsWith('/help')) return 'help'
  return null
}
