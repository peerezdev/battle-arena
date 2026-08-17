import { describe, it, expect } from 'vitest'
import { desdeHace } from './tierGap'

describe('antigüedad de una racha', () => {
  it('en días cuando lleva días', () => {
    expect(desdeHace(30)).toBe('30d')
    expect(desdeHace(9.4)).toBe('9d')
  })

  it('en horas cuando lleva menos de un día, para no verlo todo como "0d"', () => {
    expect(desdeHace(0.25)).toBe('6h')
    expect(desdeHace(0.9)).toBe('22h')
  })

  it('lo recién salido se dice, no se redondea a cero', () => {
    expect(desdeHace(0)).toBe('now')
  })

  it('nunca visto NO es "hace 0": no hay nada que fechar', () => {
    // Es la distinción que sostiene toda la columna. Escribir un 0 ahí diría que acaba de salir.
    expect(desdeHace(null)).toBe('—')
    expect(desdeHace(undefined)).toBe('—')
  })
})
