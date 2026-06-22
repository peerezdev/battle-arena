import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('./packBattleClient', () => ({ getBattle: vi.fn() }))
import { getBattle } from './packBattleClient'
import { useBattle } from './useBattle'

const mockGet = getBattle as unknown as ReturnType<typeof vi.fn>

describe('useBattle', () => {
  beforeEach(() => { vi.useFakeTimers(); mockGet.mockReset() })
  afterEach(() => { vi.useRealTimers() })

  it('polls while running and STOPS at a terminal status', async () => {
    mockGet
      .mockResolvedValueOnce({ id: 'b1', status: 'lobby', players: [], rounds: [] })
      .mockResolvedValueOnce({ id: 'b1', status: 'running', players: [], rounds: [] })
      .mockResolvedValueOnce({ id: 'b1', status: 'settled', players: [], rounds: [] })
    renderHook(() => useBattle('b1', 1000))
    await vi.advanceTimersByTimeAsync(0)      // immediate poll → lobby
    await vi.advanceTimersByTimeAsync(1000)   // → running
    await vi.advanceTimersByTimeAsync(1000)   // → settled (clears interval)
    expect(mockGet).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(5000)   // no further polls after terminal
    expect(mockGet).toHaveBeenCalledTimes(3)
  })

  it('does not poll when id is null', async () => {
    renderHook(() => useBattle(null, 1000))
    await vi.advanceTimersByTimeAsync(3000)
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('stops polling after unmount', async () => {
    mockGet.mockResolvedValue({ id: 'b1', status: 'running', players: [], rounds: [] })
    const { unmount } = renderHook(() => useBattle('b1', 1000))
    await vi.advanceTimersByTimeAsync(0)
    const callsBefore = mockGet.mock.calls.length
    unmount()
    await vi.advanceTimersByTimeAsync(5000)
    expect(mockGet.mock.calls.length).toBe(callsBefore)
  })
})
