import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PackReveal } from './PackReveal'
import type { RevealVM } from './battleReveal'

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
}

describe('PackReveal', () => {
  // Stub the alias fetch so useAliases resolves without real network (falls back to wallet/Tú).
  afterEach(() => vi.restoreAllMocks())

  it('reveals both big cards and highlights the winner once settled (reduced-motion)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alias: null }) }))
    // reduced-motion → the staged reveal jumps straight to the card, so both images render
    render(<PackReveal vm={settled} reducedMotion />)
    expect(screen.getAllByRole('img')).toHaveLength(2)
    expect(screen.getByText('Tú')).toBeTruthy()              // self shown as "Tú" (no alias)
    expect(await screen.findByText(/gana/i)).toBeTruthy()    // winner appears after the reveal completes
  })

  it('keeps cards face-down while running (no NFTs before settle)', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alias: null }) }))
    render(<PackReveal vm={{ ...settled, status: 'running', winner: null }} reducedMotion />)
    expect(screen.queryAllByRole('img')).toHaveLength(0)
    expect(screen.getAllByText(/abriendo/i).length).toBeGreaterThan(0)
  })
})
