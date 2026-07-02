import { describe, it, expect } from 'vitest'
import { seedDrops, getDrops, type LiveDrop } from './dropsStore'

// NB: the store is a module singleton, so `drops` accumulates across the tests in
// this file. Each test uses distinct ids + strictly-increasing ts so its own drops
// dominate the newest-first sort and the assertions stay independent of leftovers.
function drop(id: string, ts: number, over: Partial<LiveDrop> = {}): LiveDrop {
  return {
    id, name: id, valueUsd: 10, rarity: 'Rare', image: null,
    source: 'gacha', wallet: 'W' + id, username: null, ts, ...over,
  }
}

describe('seedDrops', () => {
  it('dedupes by id, with the incoming drop winning on collision', () => {
    seedDrops([drop('a', 1000, { name: 'old' })])
    seedDrops([drop('a', 1000, { name: 'new' })])
    const a = getDrops().filter((d) => d.id === 'a')
    expect(a).toHaveLength(1)
    expect(a[0].name).toBe('new')
  })

  it('orders the feed newest-first by ts', () => {
    seedDrops([drop('x', 3000), drop('y', 5000), drop('z', 4000)])
    const order = getDrops().filter((d) => 'xyz'.includes(d.id)).map((d) => d.id)
    expect(order).toEqual(['y', 'z', 'x'])
  })

  it('caps the feed at 20, keeping the newest', () => {
    seedDrops(Array.from({ length: 30 }, (_, i) => drop('c' + i, 10000 + i)))
    const ids = getDrops().map((d) => d.id)
    expect(getDrops().length).toBeLessThanOrEqual(20)
    expect(ids).toContain('c29') // newest survives
    expect(ids).not.toContain('c0') // oldest of the batch is capped out
  })

  it('is a no-op for an empty batch', () => {
    const before = getDrops().length
    seedDrops([])
    expect(getDrops().length).toBe(before)
  })
})
