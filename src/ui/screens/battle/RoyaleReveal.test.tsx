import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
vi.mock('@privy-io/react-auth', () => ({ useIdentityToken: () => ({ identityToken: null }) }))
import { RoyaleReveal, RoyaleResult } from './RoyaleReveal'
import type { RevealVM, RevealCardVM } from './battleReveal'

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
    expect(screen.getByText(/ALIVE/i)).toBeTruthy()                          // battle bar
    expect(screen.getAllByText('You')).toHaveLength(2)                       // standings row + player chip
    expect(screen.getByText('STANDINGS')).toBeTruthy()                       // 1a standings sidebar rendered
    expect(document.querySelectorAll('[data-player-anchor]')).toHaveLength(2) // one chip per player (emote anchor)
    expect(screen.getByText(/OUT · R1/)).toBeTruthy()                        // B marked out in its chip
  })

  it('champion loot shows uncommon+ cards and packs the commons (loser view)', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alias: null }) }))
    const card = (rarity: string | null, insuredValue: number, nft: string): RevealCardVM =>
      ({ wallet: 'A', isMe: false, nftAddress: nft, rarity, insuredValue, autoSold: false, grade: null, year: null, name: 'C' })
    const settled: RevealVM = {
      mode: 'royale', status: 'settled', winner: 'A', meWallet: 'B',
      players: [
        { wallet: 'A', isMe: false, accumulatedValue: 297, eliminatedRound: null, total: 297, cards: [
          card('Epic', 97, 'e1'), card('Rare', 60, 'r1'), card('Common', 50, 'c1'), card('Common', 54, 'c2'), card(null, 40, 'c3'),
        ] },
        { wallet: 'B', isMe: true, accumulatedValue: 0, eliminatedRound: 1, total: 0, cards: [] },
      ],
      rounds: [], potValue: 297, machines: ['m'], buybackTotal: 0,
    }
    render(<MemoryRouter><RoyaleResult vm={settled} battleId="b1" /></MemoryRouter>)
    expect(screen.getByText(/CHAMPION LOOT · 5 CARDS/)).toBeTruthy()   // 5 total
    expect(screen.getByText(/TOP PULL/)).toBeTruthy()                  // the epic $97 leads
    expect(screen.getByText('×3')).toBeTruthy()                        // 2 commons + 1 null = 3 packed
    expect(screen.getByText('COMMONS')).toBeTruthy()
  })

  it('reduced motion on a settled battle fires onComplete (prop wired into the hook)', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alias: null }) }))
    const onComplete = vi.fn()
    render(<MemoryRouter><RoyaleReveal vm={{ ...vm, status: 'settled' }} reducedMotion onComplete={onComplete} /></MemoryRouter>)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})
