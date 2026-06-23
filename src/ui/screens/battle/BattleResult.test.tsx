import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BattleResult } from './BattleResult'
import type { RevealVM } from './battleReveal'

vi.mock('../../../onchain/packBattleClient', () => ({
  verifyBattle: vi.fn().mockResolvedValue({ mode: 'royale', server_seed_hash: 'h', server_seed: null, commit_ok: null, rounds: [] }),
}))
import { verifyBattle } from '../../../onchain/packBattleClient'

const baseVm: RevealVM = {
  mode: 'royale', status: 'settled', winner: 'A', meWallet: 'A',
  players: [], rounds: [], potValue: 160, machines: [],
}

describe('BattleResult', () => {
  it('celebrates when I am the winner and shows the pot', () => {
    render(<BattleResult vm={baseVm} battleId="b1" onExit={() => {}} />)
    expect(screen.getByText(/ganaste/i)).toBeTruthy()
    expect(screen.getByText('$160')).toBeTruthy()
  })

  it('shows the winner wallet when it is not me, and Volver works', () => {
    const onExit = vi.fn()
    render(<BattleResult vm={{ ...baseVm, meWallet: 'B' }} battleId="b1" onExit={onExit} />)
    expect(screen.queryByText(/ganaste/i)).toBeNull()
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
