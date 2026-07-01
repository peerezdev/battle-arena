import { describe, it, expect } from 'vitest'
import { shortWallet, tintFor, medalColor } from './royaleShared'

describe('royaleShared', () => {
  it('shortWallet truncates long wallets and leaves short ones', () => {
    expect(shortWallet('ABCDEFGHIJKL')).toBe('ABCD…IJKL')
    expect(shortWallet('short')).toBe('short')
  })

  it('tintFor is deterministic per wallet', () => {
    expect(tintFor('wallet-x')).toBe(tintFor('wallet-x'))
    expect(tintFor('wallet-x')).toMatch(/linear-gradient/)
  })

  it('medalColor returns gold/silver/bronze for the podium', () => {
    expect(medalColor(1)).toBe('#f5c542')
    expect(medalColor(2)).toBe('#c8d0da')
    expect(medalColor(3)).toBe('#e8964e')
  })
})
