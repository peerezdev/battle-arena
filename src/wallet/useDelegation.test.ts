import { describe, it, expect } from 'vitest'
import { isSolanaDelegated } from './useDelegation'

describe('isSolanaDelegated', () => {
  it('true sólo si hay una embedded Solana con delegated', () => {
    expect(isSolanaDelegated([{ type: 'wallet', chainType: 'solana', walletClientType: 'privy', delegated: true, address: 'A' }])).toBe(true)
    expect(isSolanaDelegated([{ type: 'wallet', chainType: 'solana', walletClientType: 'privy', delegated: false, address: 'A' }])).toBe(false)
    expect(isSolanaDelegated([{ type: 'wallet', chainType: 'ethereum', walletClientType: 'privy', delegated: true, address: 'B' }])).toBe(false)
    expect(isSolanaDelegated([])).toBe(false)
  })
})
