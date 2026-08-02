import { describe, it, expect } from 'vitest'
import { tieBreakOf } from './packTieBreak'
import type { RevealVM } from './battleReveal'

const jugador = (wallet: string, total: number) => ({
  wallet, isMe: false, accumulatedValue: total, eliminatedRound: null, cards: [], total,
})

function vm(totales: Array<[string, number]>, over: Partial<RevealVM> = {}): RevealVM {
  return {
    mode: 'pack', status: 'settled', winner: totales[0][0], meWallet: null,
    players: totales.map(([w, t]) => jugador(w, t)),
    rounds: [], potValue: 0, machines: ['pokemon_50'], buybackTotal: 0, entry: 50,
    ...over,
  }
}

describe('tieBreakOf', () => {
  it('detecta el empate a dos y devuelve el valor compartido', () => {
    const t = tieBreakOf(vm([['A', 305], ['B', 305]]))
    expect(t).toEqual({ tied: ['A', 'B'], value: 305 })
  })

  it('detecta el empate a tres dejando fuera al que no llega', () => {
    const t = tieBreakOf(vm([['A', 305], ['B', 12], ['C', 305], ['D', 305]], { winner: 'C' }))
    expect(t?.tied).toEqual(['A', 'C', 'D'])   // en orden de mesa, sin el rezagado
    expect(t?.value).toBe(305)
  })

  it('detecta el empate a cuatro', () => {
    expect(tieBreakOf(vm([['A', 0], ['B', 0], ['C', 0], ['D', 0]]))?.tied).toHaveLength(4)
  })

  it('todos a cero SÍ es un empate: el backend lo sorteó igual', () => {
    // Pasa cuando todas las cartas se auto-venden o no traen valor tasado. Es un sorteo real,
    // así que se enseña; esconderlo dejaría un ganador sin explicación.
    expect(tieBreakOf(vm([['A', 0], ['B', 0]]))).not.toBeNull()
  })

  it('un solo líder no es empate, por cerca que quede el segundo', () => {
    expect(tieBreakOf(vm([['A', 305.01], ['B', 305]]))).toBeNull()
  })

  it('sin liquidar no hay nada que sortear', () => {
    expect(tieBreakOf(vm([['A', 305], ['B', 305]], { status: 'running', winner: null }))).toBeNull()
  })

  it('sin ganador tampoco', () => {
    expect(tieBreakOf(vm([['A', 305], ['B', 305]], { winner: null }))).toBeNull()
  })

  it('si el ganador no está entre los empatados no se anima', () => {
    // Datos que no cuadran: el backend sortea ENTRE los candidatos, así que esto no debería
    // pasar. Si pasara, la ruleta aterrizaría en alguien que no ganó. Mejor no animar.
    expect(tieBreakOf(vm([['A', 305], ['B', 305], ['C', 10]], { winner: 'C' }))).toBeNull()
  })

  it('con un solo jugador no hay empate posible', () => {
    expect(tieBreakOf(vm([['A', 305]]))).toBeNull()
  })
})
