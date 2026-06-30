import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRadio } from './useRadio'
import { radio } from './radioStore'

describe('useRadio', () => {
  it('exposes the current track and tracks list', () => {
    const { result } = renderHook(() => useRadio())
    expect(result.current.tracks.length).toBeGreaterThan(0)
    expect(result.current.track).toBe(result.current.tracks[result.current.index])
  })

  it('re-renders when the store changes', () => {
    const { result } = renderHook(() => useRadio())
    const before = result.current.shuffle
    act(() => { radio.toggleShuffle() })
    expect(result.current.shuffle).toBe(!before)
    // restore
    act(() => { radio.toggleShuffle() })
  })
})
