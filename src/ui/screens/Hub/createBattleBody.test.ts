import { describe, it, expect } from 'vitest'
import { buildCreateBody, bundleToPacks, totalBoxes, bundleCostUsd, royaleTotalPulls, royaleEntryUsd } from './createBattleBody'
import type { GachaMachine } from '../../../onchain/gachaClient'

const M = (code: string, price: number): GachaMachine => ({
  code, name: code, price, odds: {}, stock: {}, ev: null, image: null,
})

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

describe('bundle helpers', () => {
  it('bundleToPacks keeps only count>0, in key order', () => {
    expect(bundleToPacks({ a: 2, b: 0, c: 1 })).toEqual([
      { machine_code: 'a', count: 2 }, { machine_code: 'c', count: 1 }])
    expect(bundleToPacks({})).toEqual([])
  })

  it('totalBoxes sums the counts', () => {
    expect(totalBoxes({ a: 2, b: 0, c: 1 })).toBe(3)
    expect(totalBoxes({})).toBe(0)
  })

  it('bundleCostUsd sums price*count; unknown machine contributes 0', () => {
    const machines = [M('m25', 25), M('m50', 50)]
    expect(bundleCostUsd({ m25: 1, m50: 2 }, machines)).toBe(125)
    expect(bundleCostUsd({ ghost: 3 }, machines)).toBe(0)
  })
})

describe('royale economics (mirrors backend total_pulls / royale_buyin)', () => {
  it('royaleTotalPulls = n(n+1)/2 − 1 (one elimination per round)', () => {
    expect(royaleTotalPulls(2)).toBe(2)   // 2
    expect(royaleTotalPulls(3)).toBe(5)   // 3+2
    expect(royaleTotalPulls(4)).toBe(9)   // 4+3+2
    expect(royaleTotalPulls(10)).toBe(54) // 10·11/2 − 1
    expect(royaleTotalPulls(1)).toBe(0)
  })

  it('royaleEntryUsd splits the total pack cost across players', () => {
    expect(royaleEntryUsd(4, 50)).toBe(112.5)   // 9·50/4
    expect(royaleEntryUsd(2, 50)).toBe(50)      // 2·50/2
    expect(royaleEntryUsd(0, 50)).toBe(0)
  })
})
