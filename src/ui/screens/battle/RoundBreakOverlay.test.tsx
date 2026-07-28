import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RoundBreakOverlay } from './RoundBreakOverlay'
import type { RevealVM, RevealPlayerVM } from './battleReveal'

const vm: RevealVM = {
  mode: 'royale', status: 'running', winner: null, meWallet: 'A',
  players: [
    { wallet: 'A', isMe: true, accumulatedValue: 90, eliminatedRound: null, cards: [], total: 90 },
    { wallet: 'B', isMe: false, accumulatedValue: 40, eliminatedRound: null, cards: [], total: 40 },
  ],
  rounds: [], potValue: 130, machines: ['m'], buybackTotal: 0, entry: 0,
}
const name = (p: RevealPlayerVM) => (p.isMe ? 'You' : p.wallet)

describe('RoundBreakOverlay', () => {
  it('announces the upcoming round and the countdown, with the leaderboard below', () => {
    render(<RoundBreakOverlay vm={vm} name={name} upcomingRound={3} countdown={4} />)
    expect(screen.getByText(/Round 3 starts in/i)).toBeTruthy()
    expect(screen.getByText('4')).toBeTruthy()
    expect(screen.getByText(/CURRENT STANDINGS/i)).toBeTruthy()
  })
})
