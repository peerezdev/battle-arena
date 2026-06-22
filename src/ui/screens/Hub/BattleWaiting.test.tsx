import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../onchain/useBattle', () => ({ useBattle: vi.fn() }))
import { useBattle } from '../../../onchain/useBattle'
import { BattleWaiting } from './BattleWaiting'

const mockUseBattle = useBattle as unknown as ReturnType<typeof vi.fn>

describe('BattleWaiting', () => {
  it('shows a waiting room while in lobby', () => {
    mockUseBattle.mockReturnValue({
      battle: { id: 'b1', status: 'lobby', max_players: 4, players: [{}, {}] },
      loading: false, error: null,
    })
    render(<BattleWaiting battleId="b1" onClose={() => {}} />)
    expect(screen.getByText(/2\/4/)).toBeTruthy()
    expect(screen.getByText(/[Ee]sperando/)).toBeTruthy()
  })

  it('shows the started placeholder once running', () => {
    mockUseBattle.mockReturnValue({
      battle: { id: 'b1', status: 'running', max_players: 4, players: [{}, {}, {}, {}] },
      loading: false, error: null,
    })
    render(<BattleWaiting battleId="b1" onClose={() => {}} />)
    expect(screen.getByText(/empez/i)).toBeTruthy()
  })
})
