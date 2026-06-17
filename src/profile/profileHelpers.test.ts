// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { validateUsername } from './username'
import { countResults } from './stats'

describe('validateUsername', () => {
  it('acepta 3-20 chars alfanuméricos y _', () => {
    expect(validateUsername('Neo_99')).toBeNull()
  })
  it('rechaza demasiado corto/largo y caracteres inválidos', () => {
    expect(validateUsername('ab')).toMatch(/3/)
    expect(validateUsername('a'.repeat(21))).toMatch(/20/)
    expect(validateUsername('has space')).toMatch(/letters|caracteres|invalid/i)
    expect(validateUsername('dash-no')).toMatch(/letters|caracteres|invalid/i)
  })
})

describe('countResults', () => {
  it('cuenta wins/losses/draws', () => {
    const rows = [{ result: 'win' }, { result: 'win' }, { result: 'loss' }, { result: 'draw' }]
    expect(countResults(rows)).toEqual({ wins: 2, losses: 1, draws: 1 })
  })
  it('vacío → ceros', () => {
    expect(countResults([])).toEqual({ wins: 0, losses: 0, draws: 0 })
  })
})
