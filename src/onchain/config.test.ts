import { describe, it, expect } from 'vitest'
import { isRoyaleCreator } from './config'

describe('isRoyaleCreator', () => {
  it('is open to everyone (incl. null) when the allowlist is empty', () => {
    expect(isRoyaleCreator('AnyWallet', [])).toBe(true)
    expect(isRoyaleCreator(null, [])).toBe(true)
  })

  it('allows a wallet that is on the allowlist', () => {
    expect(isRoyaleCreator('WalletA', ['WalletA', 'WalletB'])).toBe(true)
  })

  it('rejects a wallet not on a non-empty allowlist', () => {
    expect(isRoyaleCreator('WalletC', ['WalletA'])).toBe(false)
  })

  it('rejects null/undefined when the allowlist is non-empty (fail-closed)', () => {
    expect(isRoyaleCreator(null, ['WalletA'])).toBe(false)
    expect(isRoyaleCreator(undefined, ['WalletA'])).toBe(false)
  })
})
