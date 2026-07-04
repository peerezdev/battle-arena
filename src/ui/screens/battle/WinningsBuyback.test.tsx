import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { requestBuyback, submitTx, fetchBuybackAvailable } = vi.hoisted(() => ({
  requestBuyback: vi.fn(async () => ({ serialized_transaction: 'tx', refund_amount: null, memo: null })),
  submitTx: vi.fn(async () => ({})),
  fetchBuybackAvailable: vi.fn(async () => ({ available: true, amount: 50_000_000 })),   // $50
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

beforeEach(() => { requestBuyback.mockClear(); submitTx.mockClear(); fetchBuybackAvailable.mockClear() })

describe('WinningsBuyback', () => {
  it('shows keep/sell controls for sellable cards + notes auto-sold ones', async () => {
    render(<WinningsBuyback cards={[card('a'), card('b'), card('c', true)]} winnerWallet="W" lootTotal={180} />)
    expect(screen.getByText('Keep all')).toBeTruthy()
    expect(screen.getByText('Sell all')).toBeTruthy()
    expect(screen.getByText(/2 to keep or sell/)).toBeTruthy()
    expect(screen.getByText(/1 auto-sold/)).toBeTruthy()
    await waitFor(() => expect(fetchBuybackAvailable).toHaveBeenCalledTimes(2))   // only the 2 sellable
  })

  it('sells the selected cards via requestBuyback → sign → submit', async () => {
    render(<WinningsBuyback cards={[card('a'), card('b')]} winnerWallet="W" lootTotal={120} />)
    await waitFor(() => expect(fetchBuybackAvailable).toHaveBeenCalled())
    fireEvent.click(screen.getByText('Sell all'))
    fireEvent.click(await screen.findByText(/Sell 2/))
    await waitFor(() => expect(requestBuyback).toHaveBeenCalledTimes(2))
    expect(submitTx).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.getAllByText(/SOLD/).length).toBe(2))
  })

  it('renders nothing when there are no cards', () => {
    const { container } = render(<WinningsBuyback cards={[]} winnerWallet="W" lootTotal={0} />)
    expect(container.firstChild).toBeNull()
  })
})
