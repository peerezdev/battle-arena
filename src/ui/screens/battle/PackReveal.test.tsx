import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PackReveal } from './PackReveal'
import type { RevealVM } from './battleReveal'

const renderR = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

const cardA = { wallet: 'A', isMe: false, nftAddress: 'nftA', rarity: 'Rare', insuredValue: 300, autoSold: false, grade: 10, year: '2020', name: 'Blastoise' }
const cardB = { wallet: 'B', isMe: true, nftAddress: 'nftB', rarity: 'common', insuredValue: 10, autoSold: false, grade: 8, year: '2001', name: 'Rattata' }

const settled: RevealVM = {
  mode: 'pack', status: 'settled', winner: 'A', meWallet: 'B',
  players: [
    { wallet: 'A', isMe: false, accumulatedValue: 300, eliminatedRound: null, cards: [cardA], total: 300 },
    { wallet: 'B', isMe: true, accumulatedValue: 10, eliminatedRound: null, cards: [cardB], total: 10 },
  ],
  rounds: [],
  potValue: 310,
  machines: ['pokemon_50'],
  buybackTotal: 0,
}

describe('PackReveal', () => {
  // Stub the alias/machine fetches so the hooks resolve without real network.
  afterEach(() => vi.restoreAllMocks())

  it('reveals both big cards and highlights the winner once the round is shown + settled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alias: null }) }))
    // reduced-motion → the staged reveal jumps straight to the card, so both images render
    renderR(<PackReveal vm={settled} reducedMotion />)
    expect(screen.getAllByRole('img')).toHaveLength(2)
    expect(screen.getByText('Tú')).toBeTruthy()              // self shown as "Tú" (no alias)
    expect(await screen.findByText(/gana/i)).toBeTruthy()    // winner appears after the reveal completes
  })

  it('shows the card back (abriendo…) while a round’s pulls are unresolved', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alias: null }) }))
    const pending: RevealVM = {
      ...settled, status: 'running', winner: null,
      players: [
        { ...settled.players[0], cards: [{ ...cardA, nftAddress: null }], total: 0 },
        { ...settled.players[1], cards: [{ ...cardB, nftAddress: null }], total: 0 },
      ],
    }
    renderR(<PackReveal vm={pending} reducedMotion />)
    expect(screen.queryAllByRole('img')).toHaveLength(0)     // no card fronts until the pulls resolve
    expect(screen.getAllByText(/abriendo/i).length).toBeGreaterThan(0)
  })
})
