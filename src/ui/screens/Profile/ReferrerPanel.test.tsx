import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReferrerSummary } from '../../../onchain/referrerClient'

const mocks = vi.hoisted(() => ({ fetchSummary: vi.fn(), claim: vi.fn() }))
vi.mock('../../../onchain/referrerClient', () => ({
  fetchReferrerSummary: mocks.fetchSummary,
  claimReferrerEarnings: mocks.claim,
}))
vi.mock('@privy-io/react-auth', () => ({ useIdentityToken: () => ({ identityToken: 'tok' }) }))
const toast = vi.hoisted(() => vi.fn())
vi.mock('../../toastBus', () => ({ showToast: toast }))

import { ReferrerPanel } from './ReferrerPanel'

const summary = (over: Partial<ReferrerSummary> = {}): ReferrerSummary => ({
  codes: [{ code: 'IBAI', rake_share_pct: 0.25, referred_count: 12 }],
  unclaimed_base_units: 12_400_000,
  lifetime_base_units: 87_000_000,
  claim_min_base_units: 5_000_000,
  ...over,
})

beforeEach(() => { mocks.fetchSummary.mockReset(); mocks.claim.mockReset(); toast.mockReset() })

describe('ReferrerPanel', () => {
  it('no se muestra si el usuario no posee códigos', async () => {
    mocks.fetchSummary.mockResolvedValue(summary({ codes: [], unclaimed_base_units: 0, lifetime_base_units: 0 }))
    const { container } = render(<ReferrerPanel />)
    await waitFor(() => expect(mocks.fetchSummary).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('muestra referidos, pendiente y total histórico', async () => {
    mocks.fetchSummary.mockResolvedValue(summary())
    render(<ReferrerPanel />)
    expect(await screen.findByText('$12.4')).toBeTruthy()      // unclaimed
    expect(screen.getByText('12')).toBeTruthy()                // referidos
    expect(screen.getByText('$87')).toBeTruthy()               // lifetime
  })

  it('el botón Claim se deshabilita por debajo del mínimo', async () => {
    mocks.fetchSummary.mockResolvedValue(summary({ unclaimed_base_units: 2_000_000 }))
    render(<ReferrerPanel />)
    const btn = await screen.findByRole('button', { name: /claim/i })
    expect(btn).toHaveProperty('disabled', true)
    fireEvent.click(btn)
    expect(mocks.claim).not.toHaveBeenCalled()
  })

  it('un claim con éxito avisa y refresca el pendiente a cero', async () => {
    mocks.fetchSummary
      .mockResolvedValueOnce(summary())
      .mockResolvedValueOnce(summary({ unclaimed_base_units: 0 }))
    mocks.claim.mockResolvedValue({ signature: 'SIG', amount_base_units: 12_400_000 })
    render(<ReferrerPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /claim/i }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining('$12.4'), 'success'))
    await waitFor(() => expect(screen.getByText('$0')).toBeTruthy())
  })

  it('un claim fallido lo dice y no rompe el panel', async () => {
    mocks.fetchSummary.mockResolvedValue(summary())
    mocks.claim.mockRejectedValue(new Error('payout_failed'))
    render(<ReferrerPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /claim/i }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('payout_failed', 'error'))
    expect(screen.getByText('$12.4')).toBeTruthy()   // sigue reclamable
  })
})
