import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BattleResult } from './BattleResult'
import type { RevealVM } from './battleReveal'

// jsdom has no matchMedia (useIsWide → false = the mobile layout); pin it per test.
// The desktop result also mounts NextBattlePanel, so stub its lobby/machine sources.
const mocks = vi.hoisted(() => ({ wide: false, open: [] as Record<string, unknown>[] }))
vi.mock('../../useIsWide', () => ({ useIsWide: () => mocks.wide }))
vi.mock('../../../onchain/useOpenBattles', () => ({ useOpenBattles: () => ({ battles: mocks.open, loading: false, error: null }) }))
vi.mock('../../useMachines', () => ({ useMachines: () => ({}), useMachineList: () => ({ machines: [], loading: false }) }))

const mkCard = (nft: string, val: number) => ({
  wallet: '', isMe: false, nftAddress: nft, rarity: 'Rare', insuredValue: val, autoSold: false,
  grade: 10, year: '2019', name: 'Card',
})

const baseVm: RevealVM = {
  mode: 'pack', status: 'settled', winner: 'A', meWallet: 'A',
  players: [
    { wallet: 'A', isMe: true, accumulatedValue: 160, eliminatedRound: null, cards: [mkCard('nA', 160)], total: 160 },
    { wallet: 'B', isMe: false, accumulatedValue: 40, eliminatedRound: null, cards: [mkCard('nB', 40)], total: 40 },
  ],
  rounds: [], potValue: 200, machines: ['m'], buybackTotal: 0, entry: 0,
}

describe('BattleResult', () => {
  beforeEach(() => {
    mocks.wide = false
    mocks.open = []
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alias: null }) }))
  })
  afterEach(() => vi.restoreAllMocks())

  it('celebrates when I am the winner and shows the winner total', () => {
    render(<MemoryRouter><BattleResult vm={baseVm} battleId="b1" onExit={() => {}} /></MemoryRouter>)
    expect(screen.getByText(/you won/i)).toBeTruthy()
    expect(screen.getAllByText('$160').length).toBeGreaterThan(0)   // winner total
  })

  it('says you lost (and Volver works) when the winner is not me', () => {
    const onExit = vi.fn()
    render(<MemoryRouter><BattleResult vm={{ ...baseVm, meWallet: 'B' }} battleId="b1" onExit={onExit} /></MemoryRouter>)
    expect(screen.queryByText(/you won/i)).toBeNull()
    expect(screen.getByText(/you lost/i)).toBeTruthy()
    fireEvent.click(screen.getByText('Lobby'))   // mobile hero: the exit button is "Lobby"
    expect(onExit).toHaveBeenCalled()
  })

  it('desktop: shows the ×N return, the standings margin, and suggests the fullest open lobby', () => {
    mocks.wide = true
    mocks.open = [
      // roomier lobby — should lose to the one closest to starting
      { id: 'x1', mode: 'pack', machine_code: 'm', price: 5e7, max_players: 4, players: 1, buyin: 5e7, creator_wallet: 'C', player_wallets: ['C'] },
      { id: 'x2', mode: 'pack', machine_code: 'm', price: 5e7, max_players: 4, players: 3, buyin: 5e7, creator_wallet: 'D', player_wallets: ['D', 'E', 'F'] },
    ]
    render(<MemoryRouter><BattleResult vm={{ ...baseVm, entry: 50 }} battleId="b1" onExit={() => {}} /></MemoryRouter>)
    expect(screen.getByText('FINAL STANDINGS')).toBeTruthy()
    expect(screen.getByText(/×4\.0 return/)).toBeTruthy()        // loot 200 / entry 50
    expect(screen.getByText(/\+\$120 over #2/)).toBeTruthy()     // 160 − 40
    expect(screen.getByText('3/4')).toBeTruthy()                 // fewest free seats wins
    expect(screen.getByText('ENTRY')).toBeTruthy()               // money pills
    expect(screen.getByText('EST. POT')).toBeTruthy()
  })

  it('desktop: excludes lobbies I am already sitting in', () => {
    mocks.wide = true
    mocks.open = [{ id: 'x1', mode: 'pack', machine_code: 'm', price: 5e7, max_players: 4, players: 2, buyin: 5e7, creator_wallet: 'A', player_wallets: ['A', 'Z'] }]
    render(<MemoryRouter><BattleResult vm={{ ...baseVm, entry: 50 }} battleId="b1" onExit={() => {}} /></MemoryRouter>)
    expect(screen.getByText(/No lobbies are filling right now/i)).toBeTruthy()
  })
})
