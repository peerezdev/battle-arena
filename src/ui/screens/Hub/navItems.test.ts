import { describe, it, expect } from 'vitest'
import { NAV_ITEMS } from './hubMockData'
import { NAV_ROUTES } from '../../layouts/navRoutes'

describe('NAV_ITEMS · la barra inferior del móvil', () => {
  it('no lleva Winners', () => {
    // Se quitó a petición. En escritorio nunca estuvo: LeftRail tiene su propia lista y tampoco
    // la incluye, así que /winners queda sin enlace desde ninguna navegación.
    expect(NAV_ITEMS.map((i) => i.id)).not.toContain('winners')
    expect(NAV_ITEMS.map((i) => i.label)).not.toContain('Winners')
  })

  it('mantiene el resto, en su orden', () => {
    expect(NAV_ITEMS.map((i) => i.id)).toEqual(['lobby', 'pack', 'royale', 'gacha', 'ranks', 'help'])
  })

  it('cada pestaña tiene a dónde ir', () => {
    // Una entrada sin ruta sería un botón que no lleva a ningún sitio.
    for (const i of NAV_ITEMS) expect(NAV_ROUTES[i.id]).toBeTruthy()
  })
})
