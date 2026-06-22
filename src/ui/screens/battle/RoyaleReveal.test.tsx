import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RoyaleReveal } from './RoyaleReveal'
import type { RevealVM } from './battleReveal'

const vm: RevealVM = {
  mode: 'royale', status: 'running', winner: null, meWallet: 'A',
  players: [
    { wallet: 'A', isMe: true, accumulatedValue: 120, eliminatedRound: null },
    { wallet: 'B', isMe: false, accumulatedValue: 40, eliminatedRound: 1 },
  ],
  rounds: [
    { roundNumber: 1, eliminatedWallet: 'B', cards: [
      { wallet: 'A', isMe: true, nftAddress: 'nftA', rarity: 'Epic', insuredValue: 120, autoSold: false },
      { wallet: 'B', isMe: false, nftAddress: null, rarity: null, insuredValue: null, autoSold: false },
    ] },
  ],
  potValue: 120,
}

describe('RoyaleReveal', () => {
  it('renders the round cards (resolved + pending) and marks the eliminated player', () => {
    render(<RoyaleReveal vm={vm} reducedMotion />)
    expect(screen.getByRole('img')).toBeTruthy()          // A's resolved card
    expect(screen.getByText(/abriendo/i)).toBeTruthy()    // B's pending card
    expect(screen.getByText(/Ronda 1/i)).toBeTruthy()
    expect(screen.getAllByText(/eliminad/i).length).toBeGreaterThan(0)  // B marked out
  })
})
