import { describe, it, expect } from 'vitest'
import { openBattleToLive } from './openBattleToLive'
import type { OpenBattle } from '../../../onchain/packBattleClient'

const base: OpenBattle = {
  id: 'b1', mode: 'pack', machine_code: 'pokemon_50',
  price: 50, max_players: 2, players: 1, buyin: 50,
}

describe('openBattleToLive', () => {
  it('maps a pack lobby with an open seat to a joinable row', () => {
    const r = openBattleToLive(base)
    expect(r.id).toBe('b1')
    expect(r.mode).toBe('pack')
    expect(r.title).toBe('pokemon_50')
    expect(r.sub).toBe('1/2 joined')
    expect(r.costLabel).toBe('BUY-IN')
    expect(r.costValue).toBe(50)
    expect(r.action).toBe('join')
    expect(r.players).toHaveLength(1)
    expect(r.live).toBe(false)
  })

  it('marks a full lobby as watch and uses royale ENTRY label + buyin', () => {
    const r = openBattleToLive({ ...base, mode: 'royale', max_players: 4, players: 4, buyin: 113 })
    expect(r.action).toBe('watch')
    expect(r.costLabel).toBe('ENTRY')
    expect(r.costValue).toBe(113)
    expect(r.sub).toBe('4/4 joined')
  })

  it('caps avatars and shows +N for large player count', () => {
    const r = openBattleToLive({ ...base, mode: 'royale', max_players: 10, players: 7, buyin: 200 })
    expect(r.players).toHaveLength(4)
    expect(r.extra).toBe('+3')
  })
})
