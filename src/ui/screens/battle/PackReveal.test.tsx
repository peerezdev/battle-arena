import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PackReveal } from './PackReveal'
import type { RevealVM } from './battleReveal'

const cardA = { wallet: 'A', isMe: false, nftAddress: 'nftA', rarity: 'Rare', insuredValue: 300, autoSold: false }
const cardB = { wallet: 'B', isMe: true, nftAddress: 'nftB', rarity: 'common', insuredValue: 10, autoSold: false }

const settled: RevealVM = {
  mode: 'pack', status: 'settled', winner: 'A', meWallet: 'B',
  players: [
    { wallet: 'A', isMe: false, accumulatedValue: 300, eliminatedRound: null, cards: [cardA], total: 300 },
    { wallet: 'B', isMe: true, accumulatedValue: 10, eliminatedRound: null, cards: [cardB], total: 10 },
  ],
  rounds: [],
  potValue: 310,
}

describe('PackReveal', () => {
  // Stub the alias fetch so useAliases resolves without real network (falls back to wallet/Tú).
  afterEach(() => vi.restoreAllMocks())

  it('reveals both big cards and highlights the winner once settled', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alias: null }) }))
    render(<PackReveal vm={settled} reducedMotion />)
    expect(screen.getAllByRole('img')).toHaveLength(2)        // both cards face-up
    expect(screen.getByText(/gana/i)).toBeTruthy()            // winner highlight
    expect(screen.getByText('Tú')).toBeTruthy()               // self shown as "Tú" (no alias)
  })

  it('keeps cards face-down while running (no images yet)', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alias: null }) }))
    render(<PackReveal vm={{ ...settled, status: 'running', winner: null }} reducedMotion />)
    expect(screen.queryAllByRole('img')).toHaveLength(0)      // no NFTs before settle
    expect(screen.getAllByText(/abriendo/i).length).toBeGreaterThan(0)
  })
})
