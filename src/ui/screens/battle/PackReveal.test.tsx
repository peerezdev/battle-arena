import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PackReveal } from './PackReveal'
import type { RevealVM } from './battleReveal'

const vm: RevealVM = {
  mode: 'pack', status: 'settled', winner: 'A', meWallet: 'B',
  players: [
    { wallet: 'A', isMe: false, accumulatedValue: 0, eliminatedRound: null },
    { wallet: 'B', isMe: true, accumulatedValue: 0, eliminatedRound: null },
  ],
  rounds: [
    { roundNumber: 1, eliminatedWallet: null, cards: [
      { wallet: 'A', isMe: false, nftAddress: 'nftA', rarity: 'Rare', insuredValue: 300, autoSold: false },
      { wallet: 'B', isMe: true, nftAddress: 'nftB', rarity: 'common', insuredValue: 10, autoSold: false },
    ] },
  ],
  potValue: 310,
}

describe('PackReveal', () => {
  it('renders both cards and highlights the winner once settled', () => {
    render(<PackReveal vm={vm} reducedMotion />)
    expect(screen.getAllByRole('img')).toHaveLength(2)
    expect(screen.getByText(/ganador/i)).toBeTruthy()
  })
})
