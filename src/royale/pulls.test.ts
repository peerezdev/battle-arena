import { describe, expect, it } from 'vitest'
import { TIERS, simulatePull } from './pulls'
import { RARITY_ORDER } from './types'

function seqRng(values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]
}

describe('TIERS', () => {
  it('cada tier tiene odds que suman ~100 y bandas de valor válidas', () => {
    for (const t of TIERS) {
      const sum = Object.values(t.odds).reduce((a, b) => a + b, 0)
      expect(sum).toBeGreaterThanOrEqual(99)
      expect(sum).toBeLessThanOrEqual(101)
      for (const band of Object.values(t.valueBands)) {
        expect(band[0]).toBeLessThanOrEqual(band[1])
      }
    }
  })
})

describe('simulatePull', () => {
  it('rng bajo (0.0) cae en la rareza más común y respeta su banda de valor', () => {
    const tier = TIERS[0]
    const card = simulatePull(tier, seqRng([0.0, 0.0]), () => 'id1')
    expect(card.rarity).toBe('common')
    const [min, max] = tier.valueBands.common
    expect(card.valueUsd).toBeGreaterThanOrEqual(min)
    expect(card.valueUsd).toBeLessThanOrEqual(max)
    expect(card.grade).toBeGreaterThanOrEqual(1)
    expect(card.grade).toBeLessThanOrEqual(10)
  })

  it('rng alto (0.999) cae en la rareza menos probable (epic)', () => {
    const tier = TIERS[0]
    const card = simulatePull(tier, seqRng([0.999, 0.5]), () => 'id2')
    expect(card.rarity).toBe('epic')
    expect(RARITY_ORDER[card.rarity]).toBe(3)
  })
})
