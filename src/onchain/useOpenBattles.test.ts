import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('./packBattleClient', () => ({ listOpenBattles: vi.fn() }))
import { listOpenBattles } from './packBattleClient'
import { useOpenBattles } from './useOpenBattles'

const mockList = listOpenBattles as unknown as ReturnType<typeof vi.fn>
const ROW = { id: 'b1', mode: 'pack', machine_code: 'pokemon_50', price: 50, max_players: 2, players: 1, buyin: 50 }

describe('useOpenBattles', () => {
  beforeEach(() => { mockList.mockReset() })

  it('polls on the interval and exposes the battles', async () => {
    // Use real timers for this test to check state updates
    vi.useRealTimers()
    mockList.mockResolvedValue([ROW])
    const { result } = renderHook(() => useOpenBattles(100))
    await waitFor(() => expect(result.current.battles).toEqual([ROW]))
    expect(mockList).toHaveBeenCalledTimes(1)
    await new Promise(r => setTimeout(r, 120))
    expect(mockList).toHaveBeenCalledTimes(2)
  })

  it('surfaces errors but keeps polling', async () => {
    // Use real timers for this test
    vi.useRealTimers()
    mockList.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([ROW])
    const { result } = renderHook(() => useOpenBattles(100))
    await waitFor(() => expect(result.current.error).toBe('boom'))
    await new Promise(r => setTimeout(r, 150))
    await waitFor(() => expect(result.current.error).toBeNull())
    expect(result.current.battles).toEqual([ROW])
  })

  it('stops polling after unmount', async () => {
    // Use fake timers for this test
    vi.useFakeTimers()
    mockList.mockResolvedValue([ROW])
    const { unmount } = renderHook(() => useOpenBattles(1000))
    await vi.advanceTimersByTimeAsync(0)
    const before = mockList.mock.calls.length
    unmount()
    await vi.advanceTimersByTimeAsync(5000)
    expect(mockList.mock.calls.length).toBe(before)
    vi.useRealTimers()
  })
})
