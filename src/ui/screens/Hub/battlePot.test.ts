import { describe, it, expect } from 'vitest'
import { potShown, multLabel } from './battlePot'
import type { LiveBattle } from './hubMockData'

const partida = (over: Partial<LiveBattle> = {}): LiveBattle => ({
  id: 'b', mode: 'pack', live: false, title: 't', sub: '', players: [], cards: [],
  costLabel: 'BUY-IN', costValue: 50, action: 'watch',
  entry: 50, pot: 100, slots: '2/2', statusText: 'Settled', statusColor: '#fff',
  ...over,
} as LiveBattle)

describe('potShown', () => {
  it('una partida terminada enseña lo que cayó DE VERDAD', () => {
    // Con la estimación puesta, una partida terminada seguía anunciando un número que ya no
    // significaba nada: el precio de los sobres, no el valor de las cartas.
    const p = potShown(partida({ battleStatus: 'settled', pot: 100, lootUsd: 412 }))
    expect(p).toEqual({ value: 412, label: 'TOTAL POT', real: true })
  })

  it('una partida en juego solo puede estimar, y lo dice', () => {
    const p = potShown(partida({ battleStatus: 'running', pot: 100, lootUsd: 999 }))
    expect(p).toEqual({ value: 100, label: 'ESTIMATED POT', real: false })
  })

  it('un lobby sin estado también estima', () => {
    expect(potShown(partida({ pot: 100 })).label).toBe('ESTIMATED POT')
  })

  it('terminada pero sin lootUsd cae a la estimación SIN llamarla total', () => {
    // Pasa con filas de un backend anterior al campo. Llamar "total" a un número estimado sería
    // peor que no tenerlo.
    const p = potShown(partida({ battleStatus: 'settled', pot: 100, lootUsd: undefined }))
    expect(p).toEqual({ value: 100, label: 'ESTIMATED POT', real: false })
  })

  it('un botín de 0 es un dato, no un hueco', () => {
    expect(potShown(partida({ battleStatus: 'settled', pot: 100, lootUsd: 0 }))).toEqual(
      { value: 0, label: 'TOTAL POT', real: true })
  })
})

describe('multLabel', () => {
  it('redondea a entero cuando está cerca', () => {
    expect(multLabel(50, 200)).toBe('×4')
    expect(multLabel(50, 201)).toBe('×4')
  })

  it('con decimal deja un decimal', () => {
    expect(multLabel(50, 235)).toBe('×4.7')
  })

  it('sin entrada o sin bote no hay multiplicador', () => {
    expect(multLabel(0, 200)).toBeNull()
    expect(multLabel(50, 0)).toBeNull()
  })
})
