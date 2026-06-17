import { describe, expect, it } from 'vitest'
import { sumUsdc } from './useUsdcBalance'

describe('sumUsdc', () => {
  it('suma amounts de las ATAs y divide por 1e6 (6 decimales)', () => {
    const accts = [
      { account: { data: { parsed: { info: { tokenAmount: { amount: '1500000' } } } } } },
      { account: { data: { parsed: { info: { tokenAmount: { amount: '500000' } } } } } },
    ]
    expect(sumUsdc(accts as any)).toBe(2)
  })
  it('devuelve 0 sin ATAs', () => {
    expect(sumUsdc([] as any)).toBe(0)
  })
  it('ignora ATAs sin amount', () => {
    const accts = [{ account: { data: { parsed: { info: {} } } } }]
    expect(sumUsdc(accts as any)).toBe(0)
  })
})
