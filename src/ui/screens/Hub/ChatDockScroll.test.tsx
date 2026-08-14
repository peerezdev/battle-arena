/**
 * El chat se abre por el último mensaje y avisa de los nuevos sin arrastrar a quien lee.
 *
 * Va en un fichero propio, y no junto al resto de tests del ChatDock, porque para simular el
 * scroll hay que definir `scrollHeight`, `clientHeight` y `scrollTo` sobre `HTMLElement.prototype`:
 * jsdom no calcula layout y esas tres valen 0 o no existen. Esas definiciones se filtrarían a los
 * demás tests del fichero, que empezarían a fallar por un motivo que no tiene nada que ver con
 * ellos. Aquí se restauran en `afterEach`, y el aislamiento es del fichero entero.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { chatState } = vi.hoisted(() => ({
  chatState: { messages: [] as { user: string; wallet?: string; text: string; ts: number }[] },
}))

vi.mock('../../../featureFlags', () => ({ TIPS_ENABLED: false }))
vi.mock('../../../hooks/useChat', () => ({
  useChat: () => ({ messages: chatState.messages, send: vi.fn(), canPost: false, online: 0 }),
}))
vi.mock('../../../wallet/embedded', () => ({ useEmbeddedSolanaAddress: () => null }))
vi.mock('../../components/TipModal', () => ({ TipModal: () => null }))

import { ChatDock } from './ChatDock'

const ALTO = 1000
const VISIBLE = 200

let scrollTo: ReturnType<typeof vi.fn>
const originales: Record<string, PropertyDescriptor | undefined> = {}

function medir(scrollTop: number) {
  Object.defineProperty(HTMLElement.prototype, 'scrollTop',
    { value: scrollTop, writable: true, configurable: true })
}

beforeEach(() => {
  chatState.messages = []
  scrollTo = vi.fn()
  for (const prop of ['scrollTo', 'scrollHeight', 'clientHeight', 'scrollTop']) {
    originales[prop] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)
  }
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: scrollTo, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { value: ALTO, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { value: VISIBLE, configurable: true })
  medir(ALTO - VISIBLE)          // por defecto, abajo del todo
})

afterEach(() => {
  for (const [prop, desc] of Object.entries(originales)) {
    if (desc) Object.defineProperty(HTMLElement.prototype, prop, desc)
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop]
  }
})

const pintar = () => render(<MemoryRouter><ChatDock /></MemoryRouter>)

describe('ChatDock · scroll', () => {
  it('al entrar se coloca en el último mensaje, no en el primero', () => {
    // El fallo: el contenedor scrollea pero nadie lo movía, así que se abría por lo más viejo.
    chatState.messages = [
      { user: 'A', wallet: 'W1', text: 'viejo', ts: 1 },
      { user: 'B', wallet: 'W2', text: 'nuevo', ts: 2 },
    ]
    pintar()

    expect(scrollTo).toHaveBeenCalled()
    expect(scrollTo.mock.calls[0][0].top).toBe(ALTO)
  })

  it('si el jugador ha subido a leer, un mensaje nuevo NO le mueve, pero le avisa', () => {
    chatState.messages = [{ user: 'A', wallet: 'W1', text: 'uno', ts: 1 }]
    const { rerender } = pintar()

    medir(0)                                                   // sube del todo
    fireEvent.scroll(screen.getByTestId('chat-messages'))
    scrollTo.mockClear()

    chatState.messages = [...chatState.messages, { user: 'B', wallet: 'W2', text: 'dos', ts: 2 }]
    rerender(<MemoryRouter><ChatDock /></MemoryRouter>)

    expect(scrollTo).not.toHaveBeenCalled()
    expect(screen.getByText(/1 new message/i)).toBeTruthy()
  })

  it('el aviso de nuevos baja del todo al pulsarlo', () => {
    chatState.messages = [{ user: 'A', wallet: 'W1', text: 'uno', ts: 1 }]
    const { rerender } = pintar()
    medir(0)
    fireEvent.scroll(screen.getByTestId('chat-messages'))
    chatState.messages = [...chatState.messages, { user: 'B', wallet: 'W2', text: 'dos', ts: 2 }]
    rerender(<MemoryRouter><ChatDock /></MemoryRouter>)
    scrollTo.mockClear()

    fireEvent.click(screen.getByText(/1 new message/i))

    expect(scrollTo).toHaveBeenCalledWith({ top: ALTO, behavior: 'smooth' })
    expect(screen.queryByText(/new message/i)).toBeNull()      // y el aviso desaparece
  })

  it('estando abajo, un mensaje nuevo baja solo y no anuncia nada', () => {
    chatState.messages = [{ user: 'A', wallet: 'W1', text: 'uno', ts: 1 }]
    const { rerender } = pintar()
    scrollTo.mockClear()

    chatState.messages = [...chatState.messages, { user: 'B', wallet: 'W2', text: 'dos', ts: 2 }]
    rerender(<MemoryRouter><ChatDock /></MemoryRouter>)

    expect(scrollTo).toHaveBeenCalled()
    expect(screen.queryByText(/new message/i)).toBeNull()
  })
})
