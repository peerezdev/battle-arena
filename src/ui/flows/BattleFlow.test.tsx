import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../onchain/useBattle', () => ({ useBattle: vi.fn() }))
vi.mock('../../wallet/embedded', () => ({ useEmbeddedSolanaAddress: () => 'A' }))
vi.mock('react-router-dom', () => ({ useParams: () => ({ battleId: 'b1' }), useNavigate: () => vi.fn() }))
vi.mock('@privy-io/react-auth', () => ({ useIdentityToken: () => ({ identityToken: 'tok' }) }))
vi.mock('../../onchain/packBattleClient', async (orig) => ({
  ...(await orig<typeof import('../../onchain/packBattleClient')>()),
  cancelBattle: vi.fn().mockResolvedValue({}),
}))
import { cancelBattle } from '../../onchain/packBattleClient'
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
  beforeEach(() => {
    mockUseBattle.mockReset()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alias: null }) }))
  })

  it('shows the waiting room in lobby', () => {
    mockUseBattle.mockReturnValue({ battle: { ...royaleRunning, status: 'lobby', pulls: [] }, loading: false, error: null })
    render(<BattleFlow />)
    expect(screen.getByText(/waiting/i)).toBeTruthy()
  })

  it('renders the royale reveal while running', () => {
    mockUseBattle.mockReturnValue({ battle: royaleRunning, loading: false, error: null })
    render(<BattleFlow />)
    expect(screen.getByText(/ALIVE/i)).toBeTruthy()
  })

  it('shows the result once settled', () => {
    mockUseBattle.mockReturnValue({ battle: { ...royaleRunning, status: 'settled', winner: 'A' }, loading: false, error: null })
    render(<BattleFlow />)
    expect(screen.getByText(/victory/i)).toBeTruthy()
  })

  it('shows the voided message', () => {
    mockUseBattle.mockReturnValue({ battle: { ...royaleRunning, status: 'voided' }, loading: false, error: null })
    render(<BattleFlow />)
    expect(screen.getByText(/voided/i)).toBeTruthy()
  })

  it('shows error message and Volver button when battle cannot load', () => {
    mockUseBattle.mockReturnValue({ battle: null, error: 'no existe', loading: false })
    render(<BattleFlow />)
    expect(screen.getByText(/could not load/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /back/i })).toBeTruthy()
  })

  it('lets the creator cancel from the lobby waiting room', () => {
    mockUseBattle.mockReturnValue({
      battle: { ...royaleRunning, status: 'lobby', creator_wallet: 'A', pulls: [] },
      loading: false, error: null,
    })
    render(<BattleFlow />)
    const btn = screen.getByText(/cancel lobby/i)
    fireEvent.click(btn)
    expect(cancelBattle).toHaveBeenCalledWith('tok', 'b1')
  })

  it('does not show cancel to a non-creator', () => {
    mockUseBattle.mockReturnValue({
      battle: { ...royaleRunning, status: 'lobby', creator_wallet: 'SOMEONE_ELSE', pulls: [] },
      loading: false, error: null,
    })
    render(<BattleFlow />)
    expect(screen.queryByText(/cancel lobby/i)).toBeNull()
  })
})
