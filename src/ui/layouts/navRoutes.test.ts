// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { NAV_ROUTES, activeNavFromPath } from './navRoutes'

describe('NAV_ROUTES', () => {
  it('maps each nav id to its route', () => {
    expect(NAV_ROUTES.lobby).toBe('/app')
    expect(NAV_ROUTES.pack).toBe('/play/arena')
    expect(NAV_ROUTES.royale).toBe('/play/royale')
    expect(NAV_ROUTES.gacha).toBe('/play/gacha')
    expect(NAV_ROUTES.mana).toBe('/play/mana')
    expect(NAV_ROUTES.ranks).toBe('/leaderboard')
  })
})

describe('activeNavFromPath', () => {
  it('derives the active nav id from the pathname', () => {
    expect(activeNavFromPath('/app')).toBe('lobby')
    expect(activeNavFromPath('/play/arena')).toBe('pack')
    expect(activeNavFromPath('/play/royale')).toBe('royale')
    expect(activeNavFromPath('/play/gacha')).toBe('gacha')
    expect(activeNavFromPath('/play/mana')).toBe('mana')
    expect(activeNavFromPath('/leaderboard')).toBe('ranks')
    expect(activeNavFromPath('/profile')).toBeNull()
    expect(activeNavFromPath('/')).toBeNull()
  })
})
