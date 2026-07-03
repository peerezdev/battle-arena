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

  it('keeps alive players above eliminated ones (most-recent elimination first)', () => {
    // Repro: You tie low with C; C is eliminated; an earlier-eliminated D still holds a higher
    // total. You are alive and must NOT fall below the eliminated players.
    const vm2: RevealVM = {
      ...vm,
      players: [
        { wallet: 'A', isMe: true, accumulatedValue: 60, eliminatedRound: null, cards: [], total: 60 },
        { wallet: 'B', isMe: false, accumulatedValue: 210, eliminatedRound: null, cards: [], total: 210 },
        { wallet: 'C', isMe: false, accumulatedValue: 60, eliminatedRound: 2, cards: [], total: 60 },
        { wallet: 'D', isMe: false, accumulatedValue: 120, eliminatedRound: 1, cards: [], total: 120 },
      ],
    }
    render(<LiveLeaderboard vm={vm2} name={name} />)
    const rows = screen.getAllByTestId('lb-row')
    expect(rows.map((r) => within(r).getByTestId('lb-name').textContent)).toEqual(['B', 'You', 'C', 'D'])
  })
})
