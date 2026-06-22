import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { availableUsd } from './useReservedBalance'

let token: string | null = 'tok'
vi.mock('@privy-io/react-auth', () => ({ useIdentityToken: () => ({ identityToken: token }) }))
vi.mock('../onchain/packBattleClient', () => ({ fetchReservedBalance: vi.fn() }))
import { fetchReservedBalance } from '../onchain/packBattleClient'
import { useReservedBalance } from './useReservedBalance'

const mockFetch = fetchReservedBalance as unknown as ReturnType<typeof vi.fn>

describe('availableUsd', () => {
  it('subtracts reserved, clamps at 0, falls back when unknown', () => {
    expect(availableUsd(100, 30)).toBe(70)
    expect(availableUsd(10, 30)).toBe(0)       // clamp
    expect(availableUsd(100, null)).toBe(100)  // reserved unknown → on-chain
    expect(availableUsd(null, 30)).toBeNull()  // balance unknown
  })
})

describe('useReservedBalance', () => {
  beforeEach(() => { vi.useFakeTimers(); token = 'tok'; mockFetch.mockReset() })
  afterEach(() => { vi.useRealTimers() })

  it('fetches reserved and converts base units to dollars', async () => {
    mockFetch.mockResolvedValue({ reserved: 50_000_000 })
    const { result } = renderHook(() => useReservedBalance())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.reserved).toBe(50)
  })

  it('is null when not authenticated', async () => {
    token = null
    const { result } = renderHook(() => useReservedBalance())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.reserved).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('is null on fetch error', async () => {
    mockFetch.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useReservedBalance())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.reserved).toBeNull()
  })
})
