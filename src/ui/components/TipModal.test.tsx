import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TipModal } from './TipModal'
import { TipError } from '../../onchain/tipClient'

vi.mock('../../onchain/tipClient', async () => {
  const actual = await vi.importActual<typeof import('../../onchain/tipClient')>('../../onchain/tipClient')
  return { ...actual, sendTip: vi.fn() }
})
vi.mock('@privy-io/react-auth', () => ({ useIdentityToken: () => ({ identityToken: 'tok' }) }))
// OJO con las formas reales: useUsdcBalance devuelve { usdc, loading } (NO { balance }),
// useReservedBalance devuelve { reserved, locked }, y availableUsd(usdc, reserved) toma DOS
// argumentos y puede devolver null. Ver src/wallet/useUsdcBalance.ts:16 y useReservedBalance.ts:6,18.
vi.mock('../../wallet/useUsdcBalance', () => ({ useUsdcBalance: () => ({ usdc: 10, loading: false }) }))
vi.mock('../../wallet/useReservedBalance', () => ({
  useReservedBalance: () => ({ reserved: 0, locked: 0 }),
  availableUsd: (usdc: number | null) => usdc,
}))
vi.mock('./useDelegationGate', () => ({
  useDelegationGate: () => ({ requireDelegation: (fn: () => void) => fn(), state: null }),
}))
vi.mock('./DelegationGate', () => ({ DelegationGate: () => null }))

import { sendTip } from '../../onchain/tipClient'

const TO = { wallet: 'WalletB', alias: 'Rival' }

beforeEach(() => { vi.mocked(sendTip).mockReset() })

describe('TipModal', () => {
  it('envía el importe al destinatario', async () => {
    vi.mocked(sendTip).mockResolvedValue({ signature: 'sig', amount: 2, to: 'WalletB' })
    render(<TipModal open to={TO} source="profile" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /send tip/i }))
    await waitFor(() => expect(sendTip).toHaveBeenCalledWith('tok', 'WalletB', 2, 'profile'))
  })

  it('no deja enviar más de lo disponible y no llama al backend', async () => {
    render(<TipModal open to={TO} source="profile" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '99' } })
    fireEvent.click(screen.getByRole('button', { name: /send tip/i }))
    expect(await screen.findByText(/exceeds your available balance/i)).toBeTruthy()
    expect(sendTip).not.toHaveBeenCalled()
  })

  it('explica que el jugador no tiene cuenta', async () => {
    vi.mocked(sendTip).mockRejectedValue(new TipError('no_account'))
    render(<TipModal open to={TO} source="profile" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /send tip/i }))
    expect(await screen.findByText(/does not have an account yet/i)).toBeTruthy()
  })

  it('un segundo clic no manda un segundo tip', async () => {
    vi.mocked(sendTip).mockImplementation(() => new Promise(() => {}))   // nunca resuelve
    render(<TipModal open to={TO} source="profile" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '2' } })
    const btn = screen.getByRole('button', { name: /send tip/i })
    fireEvent.click(btn)
    fireEvent.click(btn)
    await waitFor(() => expect(sendTip).toHaveBeenCalledTimes(1))
  })
})
