import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@privy-io/react-auth', () => ({
  usePrivy: () => ({ ready: true, authenticated: true, user: { wallet: { address: 'ABCDEFGHIJKL' } }, login: vi.fn(), logout: vi.fn() }),
  useIdentityToken: () => ({ identityToken: null }),
  useSigners: () => ({ addSigners: vi.fn() }),
}))
vi.mock('../../hooks/useProfile', () => ({ useProfile: () => ({ username: 'satoshi' }) }))
vi.mock('../useIsWide', () => ({ useIsWide: () => true }))
vi.mock('./WithdrawModal', () => ({ WithdrawModal: () => null }))
vi.mock('../components/useDelegationGate', () => ({ useDelegationGate: () => ({ delegated: false }) }))

import { AuthButtons } from './AuthButtons'

describe('AuthButtons compact', () => {
  it('hides the display name but opens the dropdown', () => {
    render(<MemoryRouter><AuthButtons variant="compact" /></MemoryRouter>)
    // name not shown on the trigger
    expect(screen.queryByText('satoshi')).toBeNull()
    // caret trigger present; open it
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('My Profile')).toBeTruthy()
    expect(screen.getByText('Log out')).toBeTruthy()
  })
})
