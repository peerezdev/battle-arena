import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { LiveLeaderboard } from './LiveLeaderboard'
import type { RevealVM, RevealPlayerVM } from './battleReveal'

const vm: RevealVM = {
  mode: 'royale', status: 'running', winner: null, meWallet: 'A',
  players: [
    { wallet: 'A', isMe: true, accumulatedValue: 90, eliminatedRound: null, cards: [], total: 90 },
    { wallet: 'B', isMe: false, accumulatedValue: 210, eliminatedRound: null, cards: [], total: 210 },
    { wallet: 'C', isMe: false, accumulatedValue: 30, eliminatedRound: 1, cards: [], total: 30 },
  ],
  rounds: [], potValue: 330, machines: ['m'], buybackTotal: 0,
}
const name = (p: RevealPlayerVM) => (p.isMe ? 'You' : p.wallet)

describe('LiveLeaderboard', () => {
  it('orders rows by accumulated value descending', () => {
    render(<LiveLeaderboard vm={vm} name={name} />)
    const rows = screen.getAllByTestId('lb-row')
    expect(rows.map((r) => within(r).getByTestId('lb-name').textContent)).toEqual(['B', 'You', 'C'])
  })

  it('shows the accumulated value for each player', () => {
    render(<LiveLeaderboard vm={vm} name={name} />)
    expect(screen.getByText('$210')).toBeTruthy()
  })
})
