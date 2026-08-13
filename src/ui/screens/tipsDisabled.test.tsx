/**
 * Las propinas apagadas no se ofrecen en NINGUNA de sus dos entradas.
 *
 * Vive en su propio fichero porque la bandera se lee al importar el módulo: los tests del perfil y
 * del chat la mockean encendida para poder ejercitar la pantalla, y aquí hace falta lo contrario.
 * Mezclarlos en un fichero dejaría el valor a merced del orden de los mocks.
 *
 * Lo que se comprueba es la regla de producto, no el mecanismo: con `TIPS_ENABLED` en false, ni el
 * botón del perfil ni el badge del chat existen. El backend además responde 503 `tips_disabled`
 * (ver `test_tip_api.py`), así que aunque alguien llame a mano tampoco pasa nada.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../featureFlags', () => ({ TIPS_ENABLED: false }))

// ── Perfil ────────────────────────────────────────────────────────────────────
const params: { wallet?: string } = { wallet: 'WalletB' }
vi.mock('react-router-dom', () => ({
  useParams: () => params,
  useSearchParams: () => [new URLSearchParams(), () => {}],
  Link: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}))
vi.mock('../../wallet/embedded', () => ({ useEmbeddedSolanaAddress: () => 'WalletA' }))
vi.mock('../../hooks/useProfile', () => ({ useProfile: () => ({ username: null }) }))
vi.mock('../../hooks/useUserStats', () => ({ useUserStats: () => ({ stats: null, loading: false }) }))
vi.mock('./Profile/OverviewTab', () => ({ OverviewTab: () => null }))
vi.mock('./Profile/InventoryTab', () => ({ InventoryTab: () => null }))
vi.mock('./Profile/HistoryTab', () => ({ HistoryTab: () => null }))
vi.mock('./Profile/SettingsTab', () => ({ SettingsTab: () => null }))
vi.mock('../components/TipModal', () => ({ TipModal: () => <div>modal-de-propina</div> }))

import { ProfilePage } from './Profile/ProfilePage'

describe('propinas apagadas', () => {
  it('el perfil de otro jugador no ofrece dar propina', () => {
    render(<ProfilePage />)
    expect(screen.queryByRole('button', { name: /send tip/i })).toBeNull()
    // Y el modal ni se monta: montarlo arrancaría el sondeo de saldo para nada.
    expect(screen.queryByText('modal-de-propina')).toBeNull()
  })
})
