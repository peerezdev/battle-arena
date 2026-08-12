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

  it('NO pide todas las wallets a la vez: como mucho 4 en vuelo', async () => {
    // Una ráfaga sin límite tumbó producción: el backend corre en un proceso y su endpoint
    // consulta la base de forma síncrona, así que decenas de peticiones simultáneas le bloquean
    // el bucle de eventos y deja de responder hasta a /health.
    let enVuelo = 0
    let maximo = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      enVuelo++
      maximo = Math.max(maximo, enVuelo)
      await new Promise((r) => setTimeout(r, 5))
      enVuelo--
      return { ok: true, json: async () => ({ alias: null }) }
    }))

    const wallets = Array.from({ length: 30 }, (_, i) => `W_LOTE_${i}`)
    const { result } = renderHook(() => useAliases(wallets))
    await waitFor(() => expect(Object.keys(result.current)).toHaveLength(30), { timeout: 3000 })
    expect(maximo).toBeLessThanOrEqual(4)
  })

  it('las wallets ya cacheadas no gastan petición', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alias: 'x' }) })
    vi.stubGlobal('fetch', f)
    const { result } = renderHook(() => useAliases(['W_CACHE_1']))
    await waitFor(() => expect(result.current['W_CACHE_1']).toBe('x'))
    const llamadas = f.mock.calls.length
    renderHook(() => useAliases(['W_CACHE_1']))
    expect(f.mock.calls.length).toBe(llamadas)   // servida desde la caché del módulo
  })
})
