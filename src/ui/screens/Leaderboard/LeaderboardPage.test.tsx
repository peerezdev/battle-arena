import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@privy-io/react-auth', () => ({ useIdentityToken: () => ({ identityToken: 'tok' }) }))
vi.mock('../../../wallet/embedded', () => ({ useEmbeddedSolanaAddress: () => 'me-wallet-1234' }))
vi.mock('../../../onchain/leaderboardClient', () => ({
  fetchLeaderboard: vi.fn(),
  fetchUser: vi.fn(),
  applyReferralCode: vi.fn(),
}))

import { fetchLeaderboard, fetchUser, applyReferralCode } from '../../../onchain/leaderboardClient'
import { LeaderboardPage } from './LeaderboardPage'

const mockFn = (f: unknown) => f as unknown as ReturnType<typeof vi.fn>

describe('LeaderboardPage', () => {
  beforeEach(() => {
    mockFn(fetchLeaderboard).mockReset()
    mockFn(fetchUser).mockReset()
    mockFn(applyReferralCode).mockReset()
    mockFn(fetchLeaderboard).mockResolvedValue([
      { wallet: 'alice-wallet', alias: 'Alice', gimmighouls: 500, elo: 1300 },
      { wallet: 'me-wallet-1234', alias: null, gimmighouls: 100, elo: 1200 },
    ])
    mockFn(fetchUser).mockResolvedValue({
      wallet: 'me-wallet-1234', alias: null, elo: 1200, games_played: 0, gimmighouls: 100, referred_by: null,
    })
  })

  it('renders ranked rows in order with gimmighouls', async () => {
    render(<MemoryRouter><LeaderboardPage /></MemoryRouter>)
    await screen.findByText('Alice')
    expect(screen.getByText('500')).toBeTruthy()
    // top row is rank #1
    expect(screen.getByText('#1')).toBeTruthy()
    expect(screen.getByText('#2')).toBeTruthy()
    // my row falls back to short wallet
    expect(screen.getByText('me-w…1234')).toBeTruthy()
  })

  it('applies a referral code on success', async () => {
    mockFn(applyReferralCode).mockResolvedValue({ code: 'PROMO', boost_pct: 0.1 })
    render(<MemoryRouter><LeaderboardPage /></MemoryRouter>)
    await screen.findByText('Alice')
    const input = screen.getByLabelText('Referral code') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'PROMO' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(applyReferralCode).toHaveBeenCalledWith('tok', 'me-wallet-1234', 'PROMO'))
    await screen.findByText(/Applied PROMO/)
  })

  it('shows the error message on a failed apply', async () => {
    mockFn(applyReferralCode).mockRejectedValue(new Error('invalid_code'))
    render(<MemoryRouter><LeaderboardPage /></MemoryRouter>)
    await screen.findByText('Alice')
    fireEvent.change(screen.getByLabelText('Referral code'), { target: { value: 'NOPE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await screen.findByText('invalid_code')
  })
})
