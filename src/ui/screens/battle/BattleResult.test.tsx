import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BattleResult } from './BattleResult'
import type { RevealVM } from './battleReveal'

vi.mock('../../../onchain/packBattleClient', () => ({
  verifyBattle: vi.fn().mockResolvedValue({ mode: 'royale', server_seed_hash: 'h', server_seed: null, commit_ok: null, rounds: [] }),
}))
import { verifyBattle } from '../../../onchain/packBattleClient'

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
  rounds: [], potValue: 200, machines: ['m'], buybackTotal: 0,
}

describe('BattleResult', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alias: null }) })))
  afterEach(() => vi.restoreAllMocks())

  it('celebrates when I am the winner and shows the winner total', () => {
    render(<BattleResult vm={baseVm} battleId="b1" onExit={() => {}} />)
    expect(screen.getByText(/ganaste/i)).toBeTruthy()
    expect(screen.getAllByText('$160').length).toBeGreaterThan(0)   // winner total
  })

  it('says you lost (and Volver works) when the winner is not me', () => {
    const onExit = vi.fn()
    render(<BattleResult vm={{ ...baseVm, meWallet: 'B' }} battleId="b1" onExit={onExit} />)
    expect(screen.queryByText(/ganaste/i)).toBeNull()
    expect(screen.getByText(/perdido/i)).toBeTruthy()
    fireEvent.click(screen.getByText(/volver/i))
    expect(onExit).toHaveBeenCalled()
  })

  it('opens the Provably-Fair verify panel', async () => {
    render(<BattleResult vm={baseVm} battleId="b1" onExit={() => {}} />)
    fireEvent.click(screen.getByText(/verificar/i))
    expect(await screen.findByText(/verificación provably-fair/i)).toBeTruthy()
    expect(verifyBattle).toHaveBeenCalledWith('b1')
  })
})
