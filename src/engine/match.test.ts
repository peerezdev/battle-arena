import { describe, it, expect } from 'vitest'
import { createMatch, availableEnergy } from './match'
import { DEFAULT_CONFIG, type Card } from './types'

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
