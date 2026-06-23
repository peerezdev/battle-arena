import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAliases } from './useAliases'

afterEach(() => vi.restoreAllMocks())

describe('useAliases', () => {
  it('resolves the alias when the user has one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ wallet: 'WAL_ALIAS', alias: 'neo' }) }))
    const { result } = renderHook(() => useAliases(['WAL_ALIAS']))
    await waitFor(() => expect(result.current['WAL_ALIAS']).toBe('neo'))
  })

  it('resolves to null when there is no alias', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ wallet: 'WAL_NOALIAS', alias: null }) }))
    const { result } = renderHook(() => useAliases(['WAL_NOALIAS']))
    await waitFor(() => expect(result.current['WAL_NOALIAS']).toBeNull())
  })

  it('resolves to null on a fetch error (caller falls back to the wallet)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    const { result } = renderHook(() => useAliases(['WAL_ERR']))
    await waitFor(() => expect(result.current['WAL_ERR']).toBeNull())
  })
})
