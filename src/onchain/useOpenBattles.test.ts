import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('./packBattleClient', () => ({ listOpenBattles: vi.fn() }))
import { listOpenBattles } from './packBattleClient'
import { useOpenBattles } from './useOpenBattles'

const mockList = listOpenBattles as unknown as ReturnType<typeof vi.fn>
const ROW = { id: 'b1', mode: 'pack', machine_code: 'pokemon_50', price: 50, max_players: 2, players: 1, buyin: 50 }

describe('useOpenBattles', () => {
  beforeEach(() => { vi.useFakeTimers(); mockList.mockReset() })
  afterEach(() => { vi.useRealTimers() })

  it('polls on the interval and exposes the battles', async () => {
    mockList.mockResolvedValue([ROW])
    const { result } = renderHook(() => useOpenBattles(1000))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })   // immediate poll
    expect(result.current.battles).toEqual([ROW])
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) }) // second poll
    expect(mockList).toHaveBeenCalledTimes(2)
  })

  it('surfaces errors but keeps polling', async () => {
    mockList.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([ROW])
    const { result } = renderHook(() => useOpenBattles(1000))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.error).toBe('boom')
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(result.current.error).toBeNull()
    expect(result.current.battles).toEqual([ROW])
  })

  it('stops polling after unmount', async () => {
    mockList.mockResolvedValue([ROW])
    const { unmount } = renderHook(() => useOpenBattles(1000))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const before = mockList.mock.calls.length
    unmount()
    await vi.advanceTimersByTimeAsync(5000)
    expect(mockList.mock.calls.length).toBe(before)
  })
})
