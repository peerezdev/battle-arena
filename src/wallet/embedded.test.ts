// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { pickLinkedSolanaWallets } from './embedded'

describe('pickLinkedSolanaWallets', () => {
  it('clasifica embedded (privy) y connected (Phantom), ignora no-solana, dedup', () => {
    const accounts = [
      { type: 'email', address: 'a@b.c' },
      { type: 'wallet', chainType: 'ethereum', walletClientType: 'metamask', address: '0xabc' },
      { type: 'wallet', chainType: 'solana', walletClientType: 'Phantom', address: 'PHAN' },
      { type: 'wallet', chainType: 'solana', walletClientType: 'privy', address: 'EMB' },
      { type: 'wallet', chainType: 'solana', walletClientType: 'privy', address: 'EMB' },
    ]
    expect(pickLinkedSolanaWallets(accounts as any)).toEqual([
      { address: 'PHAN', source: 'connected' },
      { address: 'EMB', source: 'embedded' },
    ])
  })

  it('devuelve [] sin cuentas', () => {
    expect(pickLinkedSolanaWallets([])).toEqual([])
  })
})
