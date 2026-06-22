import { describe, it, expect } from 'vitest'
import { buildCreateBody } from './createBattleBody'

describe('buildCreateBody', () => {
  it('uses the chosen player count for pack (2-10 supported by the backend)', () => {
    expect(buildCreateBody('pack', 'pokemon_50', 5)).toEqual({
      machine_code: 'pokemon_50', max_players: 5, mode: 'pack',
    })
  })

  it('uses the chosen player count for royale', () => {
    expect(buildCreateBody('royale', 'pokemon_50', 6)).toEqual({
      machine_code: 'pokemon_50', max_players: 6, mode: 'royale',
    })
  })
})
