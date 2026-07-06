// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { NAV_ROUTES, activeNavFromPath } from './navRoutes'

describe('NAV_ROUTES', () => {
  it('maps each nav id to its route', () => {
    expect(NAV_ROUTES.lobby).toBe('/home')
    expect(NAV_ROUTES.pack).toBe('/play/arena')
    expect(NAV_ROUTES.royale).toBe('/play/royale')
    expect(NAV_ROUTES.gacha).toBe('/play/gacha')
    expect(NAV_ROUTES.mana).toBe('/play/mana')
    expect(NAV_ROUTES.ranks).toBe('/ranking')
  })
})

describe('activeNavFromPath', () => {
  it('derives the active nav id from the pathname', () => {
    expect(activeNavFromPath('/home')).toBe('lobby')
    expect(activeNavFromPath('/play/arena')).toBe('pack')
    expect(activeNavFromPath('/play/royale')).toBe('royale')
    expect(activeNavFromPath('/play/gacha')).toBe('gacha')
    expect(activeNavFromPath('/play/mana')).toBe('mana')
    expect(activeNavFromPath('/ranking')).toBe('ranks')
    expect(activeNavFromPath('/profile')).toBeNull()
    expect(activeNavFromPath('/')).toBeNull()
  })
})

it('maps help nav to /help and back', () => {
  expect(NAV_ROUTES.help).toBe('/help')
  expect(activeNavFromPath('/help')).toBe('help')
})
