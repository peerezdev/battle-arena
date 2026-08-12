import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TipModal } from './TipModal'
import { TipError } from '../../onchain/tipClient'

vi.mock('../../onchain/tipClient', async () => {
  const actual = await vi.importActual<typeof import('../../onchain/tipClient')>('../../onchain/tipClient')
  return { ...actual, sendTip: vi.fn() }
})
vi.mock('@privy-io/react-auth', () => ({ useIdentityToken: () => ({ identityToken: 'tok' }) }))
vi.mock('../../wallet/useUsdcBalance', () => ({ useUsdcBalance: () => ({ usdc: 10, loading: false }) }))
vi.mock('../../wallet/useReservedBalance', () => ({
  useReservedBalance: () => ({ reserved: 0, locked: 0 }),
  availableUsd: (usdc: number | null) => usdc,
}))
// useDelegationGate y DelegationGate se dejan REALES: son justo la pieza que este archivo tiene
// que demostrar que funciona (un passthrough `(fn) => fn()` no tiene forma de detectar si la
// llamada de verdad pasa por el gate, y fue lo que ocultó el bug de Critical 1). Solo se
// sustituye la única dependencia externa de useDelegationGate, useDelegation, para no arrastrar
// todo el stack de Privy (usePrivy/useSigners) que no aporta nada a este test.
vi.mock('../../wallet/useDelegation', () => ({ useDelegation: vi.fn() }))

import { sendTip } from '../../onchain/tipClient'
import { useDelegation } from '../../wallet/useDelegation'
import { clearTipInFlight } from '../../onchain/tipInFlight'

const TO = { wallet: 'WalletB', alias: 'Rival' }
const ALICE = { wallet: 'WalletAlice', alias: 'Alice' }
const BOB = { wallet: 'WalletBob', alias: 'Bob' }

function delegationState(delegated: boolean) {
  return { delegated, enable: vi.fn().mockResolvedValue(undefined) }
}

beforeEach(() => {
  vi.mocked(sendTip).mockReset()
  // El registro de envíos vivos es de módulo, así que sobrevive entre tests: un test que deja
  // una propina colgada (sendTip que nunca resuelve) dejaría el botón del siguiente apagado.
  for (const w of [TO.wallet, ALICE.wallet, BOB.wallet]) clearTipInFlight(w)
  // Por defecto, ya delegado: requireDelegation(fn) llama a fn() en el acto, igual que hacía el
  // passthrough del brief, pero ahora es el hook real el que lo decide, no un doble.
  vi.mocked(useDelegation).mockReturnValue(delegationState(true))
})

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

  // ── Critical 1 ────────────────────────────────────────────────────────────────
  it('cerrar con una delegación pendiente y reabrir sobre otro destinatario no le paga al anterior', async () => {
    vi.mocked(useDelegation).mockReturnValue(delegationState(false))
    vi.mocked(sendTip).mockResolvedValue({ signature: 'sig', amount: 5, to: BOB.wallet })

    const { rerender } = render(<TipModal open to={ALICE} source="profile" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: /send tip/i }))
    // Sin delegar, la propina a Alice queda pendiente de confirmación.
    expect(await screen.findByRole('dialog')).toBeTruthy()

    // Cierra el modal SIN confirmar ni cancelar el diálogo de delegación...
    rerender(<TipModal open={false} to={ALICE} source="profile" onClose={() => {}} />)
    // ...y lo reabre sobre Bob.
    rerender(<TipModal open to={BOB} source="profile" onClose={() => {}} />)

    // El diálogo de delegación de Alice no debe reaparecer solo.
    expect(screen.queryByRole('dialog')).toBeNull()

    // Un envío nuevo, esta vez a Bob, sigue funcionando con normalidad...
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: /send tip/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^enable$/i }))
    await waitFor(() => expect(sendTip).toHaveBeenCalledWith('tok', BOB.wallet, 5, 'profile'))

    // ...y en ningún momento se llamó al backend con la wallet de Alice.
    expect(sendTip).not.toHaveBeenCalledWith('tok', ALICE.wallet, 3, 'profile')
  })

  it('explica que no se puede dar propina con una royale en juego, no el mensaje genérico', async () => {
    vi.mocked(sendTip).mockRejectedValue(new TipError('in_royale'))
    render(<TipModal open to={TO} source="profile" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /send tip/i }))
    expect(await screen.findByText('You cannot tip while a royale is in progress. It unlocks once the match ends.')).toBeTruthy()
    expect(screen.queryByText(/it may still have gone through/i)).toBeNull()
  })

  // ── Important 2 ───────────────────────────────────────────────────────────────
  it('un envío exitoso no deja el importe listo para reenviarse al reabrir sobre otro jugador', async () => {
    vi.mocked(sendTip).mockResolvedValue({ signature: 'sig', amount: 3, to: ALICE.wallet })
    const { rerender } = render(<TipModal open to={ALICE} source="profile" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: /send tip/i }))
    await waitFor(() => expect(sendTip).toHaveBeenCalledTimes(1))

    // El padre cierra el modal (onClose) y lo reabre sobre otro jugador.
    rerender(<TipModal open={false} to={ALICE} source="profile" onClose={() => {}} />)
    rerender(<TipModal open to={BOB} source="profile" onClose={() => {}} />)

    expect((screen.getByLabelText(/amount/i) as HTMLInputElement).value).toBe('')
    // El campo vacío deja el botón sin efecto: no hay un segundo tip agazapado.
    fireEvent.click(screen.getByRole('button', { name: /send tip/i }))
    expect(sendTip).toHaveBeenCalledTimes(1)
  })

  it('el error de un intento anterior no sobrevive a reabrir el modal sobre otro jugador', async () => {
    vi.mocked(sendTip).mockRejectedValue(new TipError('no_account'))
    const { rerender } = render(<TipModal open to={ALICE} source="profile" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /send tip/i }))
    expect(await screen.findByText(/does not have an account yet/i)).toBeTruthy()

    rerender(<TipModal open={false} to={ALICE} source="profile" onClose={() => {}} />)
    rerender(<TipModal open to={BOB} source="profile" onClose={() => {}} />)

    expect(screen.queryByText(/does not have an account yet/i)).toBeNull()
  })

  it('en el chat, cerrar con una propina en vuelo y reabrir no deja mandar una segunda', async () => {
    // El chat monta el modal con `{tipTarget && <TipModal open .../>}`: cerrarlo lo DESMONTA,
    // así que el `busy` del componente muere con él y el botón volvía a estar activo con la
    // primera propina todavía viva.
    vi.mocked(sendTip).mockImplementation(() => new Promise(() => {}))   // nunca resuelve
    const primera = render(<TipModal open to={BOB} source="chat" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: /send tip/i }))
    await waitFor(() => expect(sendTip).toHaveBeenCalledTimes(1))

    primera.unmount()                                    // el jugador cierra el modal
    render(<TipModal open to={BOB} source="chat" onClose={() => {}} />)   // y lo reabre sobre Bob

    // El botón sigue apagado porque la primera propina no ha terminado...
    const btn = screen.getByRole('button', { name: /sending/i })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
    // ...y aunque se teclee un importe y se insista, no sale una segunda.
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '4' } })
    fireEvent.click(btn)
    expect(sendTip).toHaveBeenCalledTimes(1)
  })

  // ── Important 3 ───────────────────────────────────────────────────────────────
  it('no llama al backend si no hay wallet de destino', async () => {
    render(<TipModal open to={{ wallet: '', alias: null }} source="profile" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /send tip/i }))
    expect(sendTip).not.toHaveBeenCalled()
  })

  // ── Important 4 ───────────────────────────────────────────────────────────────
  it('sin delegar, la llamada al backend espera a que se confirme el gate', async () => {
    vi.mocked(useDelegation).mockReturnValue(delegationState(false))
    vi.mocked(sendTip).mockResolvedValue({ signature: 'sig', amount: 2, to: BOB.wallet })
    render(<TipModal open to={BOB} source="profile" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /send tip/i }))

    // Sin delegar, el backend todavía no debe verlo: la acción se quedó pendiente en el gate.
    expect(sendTip).not.toHaveBeenCalled()
    expect(await screen.findByRole('dialog')).toBeTruthy()

    // Solo tras confirmar la delegación se dispara la llamada real.
    fireEvent.click(screen.getByRole('button', { name: /^enable$/i }))
    await waitFor(() => expect(sendTip).toHaveBeenCalledWith('tok', BOB.wallet, 2, 'profile'))
  })
})
