import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BattleResult } from './BattleResult'
import type { RevealVM } from './battleReveal'

const baseVm: RevealVM = {
  mode: 'royale', status: 'settled', winner: 'A', meWallet: 'A',
  players: [], rounds: [], potValue: 160,
}

describe('BattleResult', () => {
  it('celebrates when I am the winner and shows the pot', () => {
    render(<BattleResult vm={baseVm} onExit={() => {}} />)
    expect(screen.getByText(/ganaste/i)).toBeTruthy()
    expect(screen.getByText('$160')).toBeTruthy()
  })

  it('shows the winner wallet when it is not me, and Volver works', () => {
    const onExit = vi.fn()
    render(<BattleResult vm={{ ...baseVm, meWallet: 'B' }} onExit={onExit} />)
    expect(screen.queryByText(/ganaste/i)).toBeNull()
    fireEvent.click(screen.getByText(/volver/i))
    expect(onExit).toHaveBeenCalled()
  })
})
