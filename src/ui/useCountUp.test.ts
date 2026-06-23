import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCountUp } from './useCountUp'

describe('useCountUp', () => {
  it('returns the target immediately when disabled (reduced-motion / pre-reveal)', () => {
    const { result } = renderHook(() => useCountUp(500, false))
    expect(result.current).toBe(500)
  })

  it('starts from 0 when enabled', () => {
    const { result } = renderHook(() => useCountUp(500, true))
    expect(result.current).toBe(0)
  })
})
