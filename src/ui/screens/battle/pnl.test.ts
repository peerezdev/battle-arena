import { describe, it, expect } from 'vitest'
import { pnlOf } from './pnl'
import type { RevealVM } from './battleReveal'

const carta = (valor: number, nftAddress: string | null = null) => ({
  wallet: 'A', isMe: false, nftAddress, rarity: 'Rare', insuredValue: valor,
  autoSold: false, grade: 10, year: '2020', name: 'Carta',
})

function vm(over: Partial<RevealVM> = {}): RevealVM {
  return {
    mode: 'pack', status: 'settled', winner: 'A', meWallet: 'A',
    players: [
      { wallet: 'A', isMe: true, accumulatedValue: 300, eliminatedRound: null, cards: [carta(300)], total: 300 },
      { wallet: 'B', isMe: false, accumulatedValue: 100, eliminatedRound: null, cards: [carta(100)], total: 100 },
    ],
    rounds: [], potValue: 400, machines: ['pokemon_50'], buybackTotal: 0, entry: 50,
    ...over,
  }
}

describe('pnlOf', () => {
  it('el payout es TODO el botín, no solo las cartas del ganador', () => {
    // El ganador se lleva las cartas de todos: contar solo las suyas dejaría la cifra corta.
    expect(pnlOf(vm())?.payout).toBe(400)
  })

  it('la ganancia descuenta lo que pagó por entrar', () => {
    const p = pnlOf(vm())
    expect(p?.entry).toBe(50)
    expect(p?.profit).toBe(350)
    expect(p?.multiple).toBe(8)
  })

  it('una victoria puede dar pérdida, y se devuelve tal cual', () => {
    // Pasa cuando el botín entero vale menos que la entrada. Enseñar siempre un "+" sería
    // mentir en la única cifra que la tarjeta existe para contar.
    const p = pnlOf(vm({ entry: 500 }))
    expect(p?.profit).toBe(-100)
    expect(p?.multiple).toBeCloseTo(0.8)
  })

  it('sin entrada no hay múltiplo que enseñar', () => {
    // Los lobbies de la casa se abren sin cobrar: dividir entre cero daría Infinity.
    expect(pnlOf(vm({ entry: 0 }))?.multiple).toBeNull()
  })

  it('la etiqueta del modo sale legible', () => {
    expect(pnlOf(vm())?.mode).toBe('PACK BATTLE')
    expect(pnlOf(vm({ mode: 'royale' }))?.mode).toBe('BATTLE ROYALE')
  })

  it('de fondo va la carta MÁS CARA del botín', () => {
    const v = vm({
      players: [
        { wallet: 'A', isMe: true, accumulatedValue: 10, eliminatedRound: null, cards: [carta(10, 'barata')], total: 10 },
        { wallet: 'B', isMe: false, accumulatedValue: 900, eliminatedRound: null, cards: [carta(900, 'cara')], total: 900 },
      ],
    })
    expect(pnlOf(v)?.background).toContain('cara')
  })

  it('si ninguna carta trae imagen, no hay fondo', () => {
    expect(pnlOf(vm())?.background).toBeNull()
  })

  it('sin ganador no hay tarjeta: es solo para quien gana', () => {
    expect(pnlOf(vm({ status: 'running', winner: null }))).toBeNull()
    expect(pnlOf(vm({ winner: null }))).toBeNull()
  })
})
