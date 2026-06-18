import { describe, it, expect } from 'vitest'
import { buybackUsd } from './InventoryCardModal'

describe('buybackUsd', () => {
  it('convierte base units (6 dec) a dólares', () => {
    expect(buybackUsd(42500000)).toBe(42.5)
    expect(buybackUsd(90000)).toBe(0.09)
    expect(buybackUsd(0)).toBe(0)
  })
})
