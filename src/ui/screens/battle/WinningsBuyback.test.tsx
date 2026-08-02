import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { requestBuyback, submitTx, fetchBuybackAvailable } = vi.hoisted(() => ({
  requestBuyback: vi.fn(async () => ({ serialized_transaction: 'tx', refund_amount: null, memo: null })),
  submitTx: vi.fn(async () => ({})),
  // Tipada con los dos argumentos reales: un test cambia la respuesta según el nft.
  fetchBuybackAvailable: vi.fn(async (_wallet: string, _nft: string) =>
    ({ available: true, amount: 50_000_000 as number | null })),   // $50
}))
vi.mock('../../../onchain/gachaClient', () => ({ requestBuyback, submitTx, fetchBuybackAvailable }))
vi.mock('../../../wallet/useWallet', () => ({ useWallet: () => ({ signTransactionBase64: vi.fn(async () => 'signed') }) }))
vi.mock('@privy-io/react-auth', () => ({ useIdentityToken: () => ({ identityToken: 'tok' }) }))
vi.mock('./RevealCard', () => ({ RevealCard: ({ card }: { card: { name: string | null } }) => <div data-testid="card">{card.name ?? 'card'}</div> }))

import { WinningsBuyback } from './WinningsBuyback'

const card = (nft: string, autoSold = false) => ({
  wallet: 'W', isMe: true, nftAddress: nft, rarity: 'rare', insuredValue: 60, autoSold,
  grade: null, year: null, name: nft,
})

beforeEach(() => {
  requestBuyback.mockClear(); submitTx.mockClear()
  // mockReset y no mockClear: un test cambia la implementación (carta sin recompra) y sin esto
  // se la dejaría puesta a los siguientes.
  fetchBuybackAvailable.mockReset()
  fetchBuybackAvailable.mockImplementation(async () => ({ available: true, amount: 50_000_000 }))   // $50
})

describe('WinningsBuyback', () => {
  it('shows keep/sell controls for sellable cards + notes auto-sold ones', async () => {
    render(<WinningsBuyback cards={[card('a'), card('b'), card('c', true)]} winnerWallet="W" lootTotal={180} />)
    expect(screen.getByText('Keep all')).toBeTruthy()
    expect(screen.getByText('Sell all')).toBeTruthy()
    // mobile layout (jsdom has no matchMedia → not wide): "2 KEEP · 1 AUTO-SOLD"
    expect(screen.getByText(/2 KEEP/)).toBeTruthy()
    expect(screen.getByText(/1 AUTO-SOLD/)).toBeTruthy()
    await waitFor(() => expect(fetchBuybackAvailable).toHaveBeenCalledTimes(2))   // only the 2 sellable
  })

  it('sells the selected cards via requestBuyback → sign → submit', async () => {
    render(<WinningsBuyback cards={[card('a'), card('b')]} winnerWallet="W" lootTotal={120} />)
    await waitFor(() => expect(fetchBuybackAvailable).toHaveBeenCalled())
    fireEvent.click(screen.getByText('Sell all'))
    fireEvent.click(await screen.findByText(/Sell · ~\$100/))   // dos cartas a $50
    await waitFor(() => expect(requestBuyback).toHaveBeenCalledTimes(2))
    expect(submitTx).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.getAllByText(/SOLD/).length).toBe(2))
  })

  it('cada carta enseña su buyback y el par Keep|Sell marca solo esa', async () => {
    render(<WinningsBuyback cards={[card('a'), card('b')]} winnerWallet="W" lootTotal={120} />)
    // Lo que daría el buyback, por carta, en cuanto responde el backend: es la mitad de la
    // decisión (vale $60 · te dan $50) y sin ella el Sell se pulsa a ciegas.
    await waitFor(() => expect(screen.getAllByText(/↩ \$50/)).toHaveLength(2))
    // Keep y Sell conviven como en el resumen de gacha, no es un botón que alterna.
    expect(screen.getAllByText('Keep')).toHaveLength(2)
    expect(screen.getAllByText('Sell')).toHaveLength(2)
    fireEvent.click(screen.getAllByText('Sell')[0]!)
    // El botón dice el DINERO, no el número: una sola carta marcada → sus $50.
    expect(await screen.findByText(/Sell · ~\$50/)).toBeTruthy()
  })

  it('una carta que CC no compra lo dice y no se puede meter en el lote', async () => {
    // CC devuelve available:false para cartas fuera de su ventana de recompra; pedir el buyback
    // igualmente responde 400. Antes el hueco quedaba vacío —indistinguible de "no ha cargado"—
    // y el Sell seguía pulsable, así que la venta fallaba al final.
    fetchBuybackAvailable.mockImplementation(async (_w: string, nft: string) =>
      nft === 'a' ? { available: false, amount: null } : { available: true, amount: 50_000_000 })
    render(<WinningsBuyback cards={[card('a'), card('b')]} winnerWallet="W" lootTotal={120} />)

    expect(await screen.findByText('no buyback')).toBeTruthy()
    expect(screen.getAllByText(/↩ \$50/)).toHaveLength(1)          // solo la vendible
    expect(screen.getAllByText('Sell')[0]).toHaveProperty('disabled', true)

    // "Sell all" tampoco la arrastra: el lote queda en 1, no en 2.
    fireEvent.click(screen.getByText('Sell all'))
    expect(await screen.findByText(/Sell · ~\$50/)).toBeTruthy()
  })

  it('el resultado ancho lleva el mismo par Keep|Sell y el buyback por carta', async () => {
    // La rama `wide` (resultado de Pack Battle en escritorio) tenía un botón que alternaba, así que
    // el estado sólo se veía después de pulsar y el buyback no salía mientras la carta estaba en
    // Keep. Es la misma decisión que en royale, así que es el mismo control.
    render(<WinningsBuyback cards={[card('a'), card('b')]} winnerWallet="W" lootTotal={120} wide />)
    await waitFor(() => expect(screen.getAllByText(/↩ \$50/)).toHaveLength(2))
    expect(screen.getAllByText('Keep')).toHaveLength(2)
    expect(screen.getAllByText('Sell')).toHaveLength(2)
    fireEvent.click(screen.getAllByText('Sell')[0]!)
    expect(await screen.findByText(/Sell 1 · ~\$50/)).toBeTruthy()
  })

  it('renders nothing when there are no cards', () => {
    const { container } = render(<WinningsBuyback cards={[]} winnerWallet="W" lootTotal={0} />)
    expect(container.firstChild).toBeNull()
  })
})
