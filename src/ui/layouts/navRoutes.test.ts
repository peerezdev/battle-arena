// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { NAV_ROUTES, activeNavFromPath } from './navRoutes'

describe('NAV_ROUTES', () => {
  it('maps each nav id to its route', () => {
    // `lobby` dejó de apuntar a Home: Home ya no es una parada del jugador que vuelve.
    expect(NAV_ROUTES.lobby).toBe('/play/lobby')
    // pack y royale siguen en el mapa porque el tipo `HubNav` los conserva, pero ya no son
    // entradas de la barra: sus rutas redirigen al Lobby con el filtro puesto.
    expect(NAV_ROUTES.pack).toBe('/play/arena')
    expect(NAV_ROUTES.royale).toBe('/play/royale')
    expect(NAV_ROUTES.gacha).toBe('/play/gacha')
    expect(NAV_ROUTES.mana).toBe('/play/mana')
    expect(NAV_ROUTES.ranks).toBe('/ranking')
  })
})

describe('activeNavFromPath', () => {
  it('derives the active nav id from the pathname', () => {
    // En Home no se enciende nada: no es una pestaña, es la portada de quien no ha entrado.
    expect(activeNavFromPath('/home')).toBeNull()
    // Las tres rutas del Lobby encienden lo mismo, también las viejas mientras redirigen.
    expect(activeNavFromPath('/play/lobby')).toBe('lobby')
    expect(activeNavFromPath('/play/arena')).toBe('lobby')
    expect(activeNavFromPath('/play/royale')).toBe('lobby')
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
