import { describe, expect, it } from 'vitest'
import { createRoyale, playRound, lowestPlayerId } from './engine'
import { TIERS } from './pulls'
import type { RoyaleCard, RoyaleState } from './types'

function card(id: string, rarity: RoyaleCard['rarity'], valueUsd: number, grade = 8): RoyaleCard {
  return { id, name: id, rarity, valueUsd, grade }
}

describe('createRoyale', () => {
  it('crea N jugadores activos, bote vacío, ronda 1', () => {
    const s = createRoyale({ numPlayers: 4, tier: TIERS[0] }, ['Tú'])
    expect(s.players).toHaveLength(4)
    expect(s.players[0].name).toBe('Tú')
    expect(s.players[0].isBot).toBe(false)
    expect(s.players.slice(1).every((p) => p.isBot)).toBe(true)
    expect(s.players.every((p) => p.status === 'active')).toBe(true)
    expect(s.pot).toEqual([])
    expect(s.round).toBe(1)
    expect(s.phase).toBe('pulling')
  })

  it('rechaza numPlayers fuera de 2..10', () => {
    expect(() => createRoyale({ numPlayers: 1, tier: TIERS[0] })).toThrow()
    expect(() => createRoyale({ numPlayers: 11, tier: TIERS[0] })).toThrow()
  })
})

describe('lowestPlayerId — desempates deterministas', () => {
  it('elige el de menor valor', () => {
    const pulls = [
      { playerId: 0, card: card('a', 'rare', 500) },
      { playerId: 1, card: card('b', 'common', 50) },
      { playerId: 2, card: card('c', 'uncommon', 200) },
    ]
    expect(lowestPlayerId(pulls)).toBe(1)
  })

  it('empate de valor → rareza más baja cae', () => {
    const pulls = [
      { playerId: 0, card: card('a', 'rare', 100) },
      { playerId: 1, card: card('b', 'common', 100) },
    ]
    expect(lowestPlayerId(pulls)).toBe(1)
  })

  it('empate de valor y rareza → grade más bajo cae', () => {
    const pulls = [
      { playerId: 0, card: card('a', 'common', 100, 9) },
      { playerId: 1, card: card('b', 'common', 100, 6) },
    ]
    expect(lowestPlayerId(pulls)).toBe(1)
  })

  it('empate total → cae el índice de asiento más alto', () => {
    const pulls = [
      { playerId: 0, card: card('a', 'common', 100, 8) },
      { playerId: 3, card: card('b', 'common', 100, 8) },
    ]
    expect(lowestPlayerId(pulls)).toBe(3)
  })
})

describe('playRound', () => {
  function rng() { return 0.5 }

  it('cada ronda elimina exactamente uno y acumula TODAS las cartas en el bote', () => {
    let s: RoyaleState = createRoyale({ numPlayers: 4, tier: TIERS[0] })
    s = playRound(s, rng)
    expect(s.players.filter((p) => p.status === 'eliminated')).toHaveLength(1)
    expect(s.pot).toHaveLength(4)
    expect(s.history).toHaveLength(1)
    expect(s.history[0].round).toBe(1)
  })

  it('continúa hasta que queda uno; ese es el ganador y el bote son todas las cartas', () => {
    let s: RoyaleState = createRoyale({ numPlayers: 3, tier: TIERS[0] })
    s = playRound(s, rng) // 3 -> 2
    s = playRound(s, rng) // 2 -> 1
    expect(s.phase).toBe('finished')
    expect(s.winnerId).not.toBeNull()
    expect(s.players.find((p) => p.id === s.winnerId)!.status).toBe('winner')
    expect(s.pot).toHaveLength(5)
  })

  it('no avanza si ya está finished', () => {
    let s: RoyaleState = createRoyale({ numPlayers: 2, tier: TIERS[0] })
    s = playRound(s, rng) // 2 -> 1 finished
    const before = s
    s = playRound(s, rng)
    expect(s).toBe(before)
  })
})
