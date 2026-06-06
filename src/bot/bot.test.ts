import { describe, it, expect } from 'vitest'
import { decide } from './bot'
import { createMatch, availableEnergy, DEFAULT_CONFIG, type Card } from '../engine'

const card = (id: string, v: number, g: number): Card => ({ id, name: id, valueUsd: v, gradeCompany: 'PSA', grade: g })

describe('bot.decide', () => {
  const s = createMatch(card('A', 1000, 9), card('B', 1000, 9), { ...DEFAULT_CONFIG })

  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    it(`(${difficulty}) produce asignación válida: enteros >=0 y suma <= disponible`, () => {
      for (let i = 0; i < 50; i++) {
        const a = decide(s, 'b', [], difficulty)
        const total = a.apertura + a.choque + a.remate
        expect(Number.isInteger(a.apertura)).toBe(true)
        expect(Number.isInteger(a.choque)).toBe(true)
        expect(Number.isInteger(a.remate)).toBe(true)
        expect(a.apertura).toBeGreaterThanOrEqual(0)
        expect(a.choque).toBeGreaterThanOrEqual(0)
        expect(a.remate).toBeGreaterThanOrEqual(0)
        expect(total).toBeLessThanOrEqual(availableEnergy(s, 'b'))
      }
    })
  }
})
