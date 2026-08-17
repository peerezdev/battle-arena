import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

const showToast = vi.fn()
vi.mock('../toastBus', () => ({ showToast: (...a: unknown[]) => showToast(...a) }))

// Se captura el callback que registra el anfitrión para poder empujarle marcos a mano.
let emitir: (msg: unknown) => void = () => {}
vi.mock('../../hooks/useServerEvents', () => ({
  useServerEvents: (cb: (msg: unknown) => void) => { emitir = cb },
}))

import { TipAlertsHost } from './TipAlertsHost'

describe('TipAlertsHost', () => {
  beforeEach(() => showToast.mockClear())

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
})
