import { describe, it, expect } from 'vitest'
import { buildCreateBody } from './createBattleBody'

describe('buildCreateBody', () => {
  it('forces max_players=2 for pack regardless of the royale count', () => {
    expect(buildCreateBody('pack', 'pokemon_50', 8)).toEqual({
      machine_code: 'pokemon_50', max_players: 2, mode: 'pack',
    })
  })

  it('uses the chosen player count for royale', () => {
    expect(buildCreateBody('royale', 'pokemon_50', 6)).toEqual({
      machine_code: 'pokemon_50', max_players: 6, mode: 'royale',
    })
  })
})
