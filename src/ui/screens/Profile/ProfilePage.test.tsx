import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const params: { wallet?: string } = {}
vi.mock('react-router-dom', () => ({
  useParams: () => params,
  useSearchParams: () => [new URLSearchParams(), () => {}],
}))
vi.mock('../../../wallet/embedded', () => ({ useEmbeddedSolanaAddress: () => 'WalletA' }))
// useProfile devuelve { username, elo, gamesPlayed, gimmighouls, withdrawAddress, loading, refresh },
// no { alias } como decía el brief: el campo se llama `username`.
vi.mock('../../../hooks/useProfile', () => ({
  useProfile: () => ({ username: null, elo: null, gamesPlayed: null, gimmighouls: null, withdrawAddress: null, loading: false, refresh: () => {} }),
}))
// useUserStats devuelve { stats, loading }; `stats` no trae alias.
vi.mock('../../../hooks/useUserStats', () => ({ useUserStats: () => ({ stats: null, loading: false }) }))
vi.mock('./OverviewTab', () => ({ OverviewTab: () => null }))
vi.mock('./InventoryTab', () => ({ InventoryTab: () => null }))
vi.mock('./HistoryTab', () => ({ HistoryTab: () => null }))
vi.mock('./SettingsTab', () => ({ SettingsTab: () => null }))
vi.mock('../../components/TipModal', () => ({ TipModal: () => null }))

import { ProfilePage } from './ProfilePage'

describe('ProfilePage', () => {
  it('ofrece dar propina en el perfil de otro', () => {
    params.wallet = 'WalletB'
    render(<ProfilePage />)
    expect(screen.getByRole('button', { name: /send tip/i })).toBeTruthy()
  })

  it('no ofrece dar propina en el perfil propio', () => {
    params.wallet = undefined
    render(<ProfilePage />)
    expect(screen.queryByRole('button', { name: /send tip/i })).toBeNull()
  })
})
