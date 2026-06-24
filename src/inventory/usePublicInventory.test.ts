import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { usePublicInventory } from './usePublicInventory'

const CC = 'CCryptWBYktukHDQ2vHGtVcmtjXxYzvw8XNVY64YN2Yf' // config.ccCollectionMint default

afterEach(() => vi.restoreAllMocks())

describe('usePublicInventory', () => {
  it('returns no cards when there is no wallet', () => {
    const { result } = renderHook(() => usePublicInventory(null))
    expect(result.current.cards).toEqual([])
    expect(result.current.loading).toBe(false)
  })

  it('fetches the wallet assets and keeps only Collector Crypt cards', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          items: [
            { id: 'mint1', grouping: [{ group_key: 'collection', group_value: CC }], content: { metadata: { name: 'Charizard' } } },
            { id: 'mint2', grouping: [{ group_key: 'collection', group_value: 'Other' }] },
          ],
        },
      }),
    }))
    const { result } = renderHook(() => usePublicInventory('WALLET'))
    await waitFor(() => expect(result.current.cards).toHaveLength(1))
    expect(result.current.cards[0].mint).toBe('mint1')
  })
})
