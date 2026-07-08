import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useBuybackAvailability } from './useBuybackAvailability'
import type { OwnedCard } from './useCollectorCryptNfts'

afterEach(() => vi.restoreAllMocks())

function card(mint: string, source: 'embedded' | 'connected'): OwnedCard {
  return {
    mint, name: 'X', image: null, insuredValue: null, rarity: null, grade: null,
    gradingCompany: null, gradingId: null, year: null, authenticated: null, source,
  }
}

describe('useBuybackAvailability', () => {
  it('returns an empty set when there is no embedded wallet', () => {
    const { result } = renderHook(() => useBuybackAvailability([card('m1', 'embedded')], null))
    expect(result.current.available.size).toBe(0)
    expect(result.current.loading).toBe(false)
  })

  it('includes only embedded cards that have an active buyback offer, and never probes connected cards', async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (url.includes('nft=mintYES') ? { available: true, amount: 100 } : { available: false, amount: null }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const cards = [card('mintYES', 'embedded'), card('mintNO', 'embedded'), card('mintCONN', 'connected')]
    const { result } = renderHook(() => useBuybackAvailability(cards, 'WALLET'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect([...result.current.available]).toEqual(['mintYES'])
    // Offer amount exposed for the payout preview; unavailable cards carry none.
    expect(result.current.amounts.get('mintYES')).toBe(100)
    expect(result.current.amounts.has('mintNO')).toBe(false)

    // The connected card must never be probed (buyback is embedded-only).
    const probed = fetchMock.mock.calls.map((c) => c[0] as string).join('|')
    expect(probed).toContain('nft=mintYES')
    expect(probed).toContain('nft=mintNO')
    expect(probed).not.toContain('mintCONN')
    vi.unstubAllGlobals()
  })

  it('treats a probe failure as "not available" (excluded from the set)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    const { result } = renderHook(() => useBuybackAvailability([card('m1', 'embedded')], 'WALLET'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.available.size).toBe(0)
    vi.unstubAllGlobals()
  })
})
