import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// El modal tira de media docena de hooks; se sustituyen para probar SOLO lo que hace con la
// respuesta del servidor, que es donde estaba el problema.
vi.mock('@privy-io/react-auth', () => ({ useIdentityToken: () => ({ identityToken: 'tok' }) }))
vi.mock('../useReducedMotion', () => ({ useReducedMotion: () => true }))
vi.mock('../../wallet/useUsdcBalance', () => ({ useUsdcBalance: () => ({ usdc: 500, loading: false }) }))
vi.mock('../../wallet/useReservedBalance', () => ({
  useReservedBalance: () => ({ reserved: 0, lockedRoyale: 0 }),
  availableUsd: () => 500,
}))
vi.mock('../../hooks/useProfile', () => ({ useProfile: () => ({ profile: null }) }))
// La puerta de delegación ejecuta la acción directamente: aquí no se prueba ese flujo.
vi.mock('./useDelegationGate', () => ({
  useDelegationGate: () => ({ open: false, requireDelegation: (fn: () => void) => fn() }),
}))
vi.mock('./DelegationGate', () => ({ DelegationGate: () => null }))
vi.mock('../toastBus', () => ({ showToast: vi.fn() }))

import { WithdrawModal } from './WithdrawModal'

const DESTINO = '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gKgBc'

/** Rellena el formulario y pulsa, con el servidor devolviendo `status`. */
async function pedirRetiro(status: number) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300, status, json: async () => ({}),
  }))
  render(<WithdrawModal open onClose={() => {}} />)
  fireEvent.change(screen.getByPlaceholderText(/wallet address|address/i), { target: { value: DESTINO } })
  const importe = screen.getAllByRole('textbox').find((e) => e !== screen.getByPlaceholderText(/wallet address|address/i))
  fireEvent.change(importe ?? screen.getByPlaceholderText('0.00'), { target: { value: '10' } })
  fireEvent.click(screen.getByRole('button', { name: /withdraw/i }))
}

describe('WithdrawModal · qué se le dice al usuario cuando falla', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('con una partida en curso se explica el motivo Y cuándo se arregla', async () => {
    // Era el caso peor: 409 caía en "Withdrawal failed. Please try again." — no explicaba nada y
    // encima aconsejaba justo lo que no funciona, porque reintentar no termina la partida.
    await pedirRetiro(409)
    const aviso = await screen.findByText(/in a battle right now/i)
    expect(aviso.textContent).toMatch(/unlock when it ends/i)
    expect(screen.queryByText(/please try again/i)).toBeNull()
  })

  it('por debajo del mínimo no dice "reinténtalo"', async () => {
    await pedirRetiro(422)
    expect(await screen.findByText(/below the minimum/i)).toBeTruthy()
    expect(screen.queryByText(/please try again/i)).toBeNull()
  })

  it('con demasiados retiros seguidos sí dice que espere', async () => {
    await pedirRetiro(429)
    expect(await screen.findByText(/too many withdrawals/i)).toBeTruthy()
  })

  it('sin saldo disponible se dice tal cual', async () => {
    await pedirRetiro(402)
    expect(await screen.findByText(/insufficient available balance/i)).toBeTruthy()
  })

  it('un fallo que no sabemos explicar sigue cayendo en el mensaje genérico', async () => {
    await pedirRetiro(500)
    expect(await screen.findByText(/please try again/i)).toBeTruthy()
  })

  it('un retiro correcto no deja ningún aviso de error', async () => {
    await pedirRetiro(200)
    await waitFor(() => expect(screen.queryByText(/failed|below the minimum|in a battle/i)).toBeNull())
  })
})
