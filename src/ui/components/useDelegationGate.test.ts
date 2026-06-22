import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const enable = vi.fn()
let delegated = false
vi.mock('../../wallet/useDelegation', () => ({
  useDelegation: () => ({ delegated, enable }),
}))
import { useDelegationGate } from './useDelegationGate'

describe('useDelegationGate', () => {
  beforeEach(() => { delegated = false; enable.mockReset() })

  it('runs the action immediately when already delegated', () => {
    delegated = true
    const action = vi.fn()
    const { result } = renderHook(() => useDelegationGate())
    act(() => result.current.requireDelegation(action))
    expect(action).toHaveBeenCalledTimes(1)
    expect(result.current.open).toBe(false)
  })

  it('opens the gate when not delegated, runs action after a successful enable', async () => {
    enable.mockResolvedValue(undefined)
    const action = vi.fn()
    const { result } = renderHook(() => useDelegationGate())
    act(() => result.current.requireDelegation(action))
    expect(action).not.toHaveBeenCalled()
    expect(result.current.open).toBe(true)
    await act(async () => { await result.current.confirm() })
    expect(enable).toHaveBeenCalledTimes(1)
    expect(action).toHaveBeenCalledTimes(1)
    expect(result.current.open).toBe(false)
  })

  it('keeps the gate open and surfaces the error when enable fails', async () => {
    enable.mockRejectedValue(new Error('no signer'))
    const action = vi.fn()
    const { result } = renderHook(() => useDelegationGate())
    act(() => result.current.requireDelegation(action))
    await act(async () => { await result.current.confirm() })
    expect(action).not.toHaveBeenCalled()
    expect(result.current.open).toBe(true)
    expect(result.current.error).toBe('no signer')
  })
})
