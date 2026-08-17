import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

const showToast = vi.fn()
vi.mock('../toastBus', () => ({ showToast: (...a: unknown[]) => showToast(...a) }))

// Se captura el callback y el `enabled` que registra el anfitrión, para poder empujarle marcos a
// mano y comprobar si la suscripción quedó activa.
let emitir: (msg: unknown) => void = () => {}
let habilitado: boolean | undefined
vi.mock('../../hooks/useServerEvents', () => ({
  useServerEvents: (cb: (msg: unknown) => void, enabled?: boolean) => {
    emitir = cb
    habilitado = enabled
  },
}))

let meWallet: string | null = 'W_ME'
vi.mock('../../wallet/embedded', () => ({
  useEmbeddedSolanaAddress: () => meWallet,
}))

import { TipAlertsHost } from './TipAlertsHost'

describe('TipAlertsHost', () => {
  beforeEach(() => {
    showToast.mockClear()
    meWallet = 'W_ME'
  })

  it('un marco de propina saca UN aviso', () => {
    render(<TipAlertsHost />)
    emitir({ type: 'tip', from: 'W1', fromName: 'Ana', amount: 1.5 })
    expect(showToast).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith('Ana sent you 1.50 USDC', 'success')
  })

  it('el resto del socket no saca nada', () => {
    // Por el mismo canal viaja todo el chat: si esto no filtrara, cada mensaje sería un toast.
    render(<TipAlertsHost />)
    emitir({ type: 'message', user: 'Ana', text: 'hola' })
    emitir({ type: 'presence', online: 2 })
    // Con fromName y amount válidos pero type distinto: si no se mirara el type, esto colaría.
    emitir({ type: 'drop', fromName: 'Ana', amount: 1.5 })
    expect(showToast).not.toHaveBeenCalled()
  })

  it('sin wallet embebida, la suscripción no se activa', () => {
    meWallet = null
    render(<TipAlertsHost />)
    expect(habilitado).toBe(false)
  })
})
