import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

let token: string | null = 'tok'
vi.mock('@privy-io/react-auth', () => ({ useIdentityToken: () => ({ identityToken: token }) }))

import { useUsdcBalance, useCardsBalance } from './useUsdcBalance'

describe('useUsdcBalance / useCardsBalance', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    token = 'tok'
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('useUsdcBalance lee /users/me/usdc y el campo "usdc"', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ usdc: 12.5 }) })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useUsdcBalance())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(result.current.usdc).toBe(12.5)
    expect(fetchMock.mock.calls[0][0]).toContain('/users/me/usdc')
  })

  it('useCardsBalance lee /users/me/cards y el campo "cards", no /usdc', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ cards: 7 }) })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useCardsBalance())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(result.current.cards).toBe(7)
    expect(fetchMock.mock.calls[0][0]).toContain('/users/me/cards')
    expect(fetchMock.mock.calls[0][0]).not.toContain('/users/me/usdc')
  })

  it('useCardsBalance es null sin sesión, y no llama a fetch', async () => {
    token = null
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useCardsBalance())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(result.current.cards).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('useCardsBalance es null cuando el backend responde 503 (mint sin configurar)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useCardsBalance())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(result.current.cards).toBeNull()
  })
})
