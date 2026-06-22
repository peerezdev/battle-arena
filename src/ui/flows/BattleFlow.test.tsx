import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../onchain/useBattle', () => ({ useBattle: vi.fn() }))
vi.mock('../../wallet/embedded', () => ({ useEmbeddedSolanaAddress: () => 'A' }))
vi.mock('react-router-dom', () => ({ useParams: () => ({ battleId: 'b1' }), useNavigate: () => vi.fn() }))
import { useBattle } from '../../onchain/useBattle'
import { BattleFlow } from './BattleFlow'

const mockUseBattle = useBattle as unknown as ReturnType<typeof vi.fn>
const royaleRunning = {
  id: 'b1', mode: 'royale', machine_code: 'm', price: 50, max_players: 3, status: 'running',
  winner: null, creator_wallet: 'A', server_seed_hash: 'h',
  players: [{ wallet: 'A', eliminated_round: null, accumulated_value: 120 }],
  rounds: [], pulls: [{ round_number: 1, player_wallet: 'A', nft_address: 'nftA', rarity: 'Epic', insured_value: 120, auto_sold: false }],
}

describe('BattleFlow', () => {
  beforeEach(() => mockUseBattle.mockReset())

  it('shows the waiting room in lobby', () => {
    mockUseBattle.mockReturnValue({ battle: { ...royaleRunning, status: 'lobby', pulls: [] }, loading: false, error: null })
    render(<BattleFlow />)
    expect(screen.getByText(/esperando/i)).toBeTruthy()
  })

  it('renders the royale reveal while running', () => {
    mockUseBattle.mockReturnValue({ battle: royaleRunning, loading: false, error: null })
    render(<BattleFlow />)
    expect(screen.getByText(/Ronda 1/i)).toBeTruthy()
  })

  it('shows the result once settled', () => {
    mockUseBattle.mockReturnValue({ battle: { ...royaleRunning, status: 'settled', winner: 'A' }, loading: false, error: null })
    render(<BattleFlow />)
    expect(screen.getByText(/ganaste/i)).toBeTruthy()
  })

  it('shows the voided message', () => {
    mockUseBattle.mockReturnValue({ battle: { ...royaleRunning, status: 'voided' }, loading: false, error: null })
    render(<BattleFlow />)
    expect(screen.getByText(/anulad/i)).toBeTruthy()
  })
})
