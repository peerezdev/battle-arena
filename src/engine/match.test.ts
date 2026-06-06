import { describe, it, expect } from 'vitest'
import { createMatch, availableEnergy, commit, reveal } from './match'
import { DEFAULT_CONFIG, type Card, type Allocation } from './types'
import { hashAllocation } from './hash'

const card = (id: string, valueUsd: number, grade: number): Card => ({
  id, name: id, valueUsd, gradeCompany: 'PSA', grade,
})
const cfg = (over = {}) => ({ ...DEFAULT_CONFIG, ...over })

describe('createMatch', () => {
  it('inicializa fase committing, ronda 0, sin wins', () => {
    const s = createMatch(card('A', 1000, 9), card('B', 1000, 8), cfg())
    expect(s.phase).toBe('committing')
    expect(s.round).toBe(0)
    expect(s.roundWins).toEqual({ a: 0, b: 0 })
    expect(s.winner).toBeNull()
  })

  it('asigna edge al de mayor valor', () => {
    const s = createMatch(card('A', 2000, 9), card('B', 1000, 8), cfg())
    expect(s.edgePerRound).toEqual({ a: 1, b: 0 })
  })

  it('rechaza ratio > cap en ranked', () => {
    expect(() => createMatch(card('A', 5000, 9), card('B', 1000, 8), cfg({ mode: 'ranked' })))
      .toThrow(/ratio/i)
  })

  it('permite ratio alto en challenge', () => {
    const s = createMatch(card('A', 5000, 9), card('B', 1000, 8), cfg({ mode: 'challenge' }))
    expect(s.phase).toBe('committing')
  })

  it('availableEnergy ronda 0 = base + edge', () => {
    const s = createMatch(card('A', 2000, 9), card('B', 1000, 8), cfg())
    expect(availableEnergy(s, 'a')).toBe(11) // 10 + 1 edge
    expect(availableEnergy(s, 'b')).toBe(10)
  })
})

describe('commit + reveal', () => {
  it('avanza a revealing cuando ambos commitean', async () => {
    let s = createMatch(card('A', 1000, 9), card('B', 1000, 8), cfg())
    s = commit(s, 'a', 'hashA')
    expect(s.phase).toBe('committing')
    s = commit(s, 'b', 'hashB')
    expect(s.phase).toBe('revealing')
  })

  it('reveal válido guarda la asignación', async () => {
    let s = createMatch(card('A', 1000, 9), card('B', 1000, 8), cfg())
    const allocA = { apertura: 4, choque: 3, remate: 3 }
    const allocB = { apertura: 3, choque: 4, remate: 3 }
    const hA = await hashAllocation(allocA, 'sA')
    const hB = await hashAllocation(allocB, 'sB')
    s = commit(s, 'a', hA)
    s = commit(s, 'b', hB)
    s = await reveal(s, 'a', allocA, 'sA')
    s = await reveal(s, 'b', allocB, 'sB')
    expect(s.rounds[0].revealA).toEqual(allocA)
    expect(s.rounds[0].revealB).toEqual(allocB)
  })

  it('rechaza reveal cuyo hash no casa', async () => {
    let s = createMatch(card('A', 1000, 9), card('B', 1000, 8), cfg())
    const allocA = { apertura: 4, choque: 3, remate: 3 }
    const hA = await hashAllocation(allocA, 'sA')
    s = commit(s, 'a', hA)
    s = commit(s, 'b', 'hB')
    await expect(reveal(s, 'a', { apertura: 5, choque: 3, remate: 2 }, 'sA'))
      .rejects.toThrow(/hash/i)
  })

  it('rechaza asignación que excede el disponible', async () => {
    let s = createMatch(card('A', 1000, 9), card('B', 1000, 8), cfg())
    const allocA = { apertura: 5, choque: 5, remate: 5 } // 15 > 10
    const hA = await hashAllocation(allocA, 'sA')
    s = commit(s, 'a', hA)
    s = commit(s, 'b', 'hB')
    await expect(reveal(s, 'a', allocA, 'sA')).rejects.toThrow(/disponible/i)
  })

  it('rechaza asignación con valores negativos', async () => {
    let s = createMatch(card('A', 1000, 9), card('B', 1000, 8), cfg())
    const allocA = { apertura: -1, choque: 5, remate: 2 }
    const hA = await hashAllocation(allocA, 'sA')
    s = commit(s, 'a', hA)
    s = commit(s, 'b', 'hB')
    await expect(reveal(s, 'a', allocA, 'sA')).rejects.toThrow(/negativ|inválid/i)
  })
})
