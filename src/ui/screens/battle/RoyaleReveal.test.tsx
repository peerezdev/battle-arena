import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RoyaleReveal } from './RoyaleReveal'
import type { RevealVM } from './battleReveal'

const vm: RevealVM = {
  mode: 'royale', status: 'running', winner: null, meWallet: 'A',
  players: [
    { wallet: 'A', isMe: true, accumulatedValue: 120, eliminatedRound: null, cards: [], total: 120 },
    { wallet: 'B', isMe: false, accumulatedValue: 40, eliminatedRound: 1, cards: [], total: 40 },
  ],
  rounds: [{ roundNumber: 1, eliminatedWallet: 'B', cards: [
    { wallet: 'A', isMe: true, nftAddress: 'nftA', rarity: 'Epic', insuredValue: 120, autoSold: false, grade: 10, year: '2018', name: 'Charizard' },
    { wallet: 'B', isMe: false, nftAddress: 'nftB', rarity: null, insuredValue: 40, autoSold: false, grade: null, year: null, name: null },
  ] }],
  potValue: 160, machines: ['m'], buybackTotal: 0,
}

afterEach(() => vi.restoreAllMocks())

describe('RoyaleReveal', () => {
  it('reduced motion shows the full board: alive count, me, and the eliminated player', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alias: null }) }))
    render(<MemoryRouter><RoyaleReveal vm={vm} reducedMotion /></MemoryRouter>)
    expect(screen.getByText(/ALIVE/i)).toBeTruthy()                        // battle bar
    expect(screen.getAllByText('You').length).toBeGreaterThan(0)           // A is me (grid + leaderboard)
    expect(screen.getAllByText(/eliminated/i).length).toBeGreaterThan(0)   // B marked out
  })
})
