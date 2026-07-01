import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRoyaleReveal, project, revealOrderWallets, totalRounds } from './useRoyaleReveal'
import type { RevealVM, RevealCardVM } from './battleReveal'

const card = (wallet: string, isMe: boolean, val: number | null, addr: string | null): RevealCardVM => ({
  wallet, isMe, nftAddress: addr, rarity: null, insuredValue: val, autoSold: false, grade: null, year: null, name: null,
})

// 2 players, 1 round, settled, fully resolved. A beats B; B out round 1.
const vm2: RevealVM = {
  mode: 'royale', status: 'settled', winner: 'A', meWallet: 'A',
  players: [
    { wallet: 'A', isMe: true, accumulatedValue: 120, eliminatedRound: null, cards: [], total: 120 },
    { wallet: 'B', isMe: false, accumulatedValue: 40, eliminatedRound: 1, cards: [], total: 40 },
  ],
  rounds: [{ roundNumber: 1, eliminatedWallet: 'B', cards: [card('A', true, 120, 'nA1'), card('B', false, 40, 'nB1')] }],
  potValue: 160, machines: ['m'], buybackTotal: 0,
}

// 3 players, 2 rounds. C out round 1, B out round 2, A wins.
const vm3: RevealVM = {
  mode: 'royale', status: 'settled', winner: 'A', meWallet: 'A',
  players: [
    { wallet: 'A', isMe: true, accumulatedValue: 300, eliminatedRound: null, cards: [], total: 300 },
    { wallet: 'B', isMe: false, accumulatedValue: 150, eliminatedRound: 2, cards: [], total: 150 },
    { wallet: 'C', isMe: false, accumulatedValue: 40, eliminatedRound: 1, cards: [], total: 40 },
  ],
  rounds: [
    { roundNumber: 1, eliminatedWallet: 'C', cards: [card('A', true, 100, 'nA1'), card('B', false, 90, 'nB1'), card('C', false, 40, 'nC1')] },
    { roundNumber: 2, eliminatedWallet: 'B', cards: [card('A', true, 200, 'nA2'), card('B', false, 60, 'nB2')] },
  ],
  potValue: 490, machines: ['m'], buybackTotal: 0,
}

describe('pure helpers', () => {
  it('revealOrderWallets keeps players alive at the start of the round, in seating order', () => {
    expect(revealOrderWallets(vm3, 1)).toEqual(['A', 'B', 'C'])
    expect(revealOrderWallets(vm3, 2)).toEqual(['A', 'B'])   // C already out
  })

  it('totalRounds is players - 1', () => {
    expect(totalRounds(vm3)).toBe(2)
    expect(totalRounds(vm2)).toBe(1)
  })

  it('project reveals only cards up to the cursor and only completes eliminations for finished rounds', () => {
    const p = project(vm3, 1, 2)   // round 1, A and B revealed, C not
    const byWallet = Object.fromEntries(p.players.map((x) => [x.wallet, x]))
    expect(byWallet.A.total).toBe(100)
    expect(byWallet.B.total).toBe(90)
    expect(byWallet.C.total).toBe(0)
    expect(byWallet.C.eliminatedRound).toBeNull()             // round 1 not fully revealed yet
  })

  it('project applies an elimination once its round is fully revealed', () => {
    const p = project(vm3, 2, 0)   // round 1 fully revealed, round 2 not started
    const byWallet = Object.fromEntries(p.players.map((x) => [x.wallet, x]))
    expect(byWallet.C.eliminatedRound).toBe(1)
    expect(byWallet.B.eliminatedRound).toBeNull()             // round 2 not revealed
    expect(byWallet.A.total).toBe(100)
  })
})

describe('useRoyaleReveal', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('reduced motion returns the full vm and completes when settled', () => {
    const onComplete = vi.fn()
    const { result } = renderHook(() => useRoyaleReveal(vm2, { reducedMotion: true, onComplete }))
    expect(result.current.projection).toBe(vm2)
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('done')
  })

  it('reveals cards one by one and reaches done on the settled final round', () => {
    const onComplete = vi.fn()
    const { result } = renderHook(() => useRoyaleReveal(vm2, { reducedMotion: false, onComplete }))
    expect(result.current.phase).toBe('revealing')
    act(() => { vi.advanceTimersByTime(900) })   // reveal A
    act(() => { vi.advanceTimersByTime(900) })   // reveal B -> round complete, last, settled -> done
    act(() => { vi.advanceTimersByTime(0) })
    expect(result.current.phase).toBe('done')
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('enters a round break with a countdown between rounds', () => {
    const onComplete = vi.fn()
    const { result } = renderHook(() => useRoyaleReveal(vm3, { reducedMotion: false, onComplete }))
    act(() => { vi.advanceTimersByTime(900) })   // reveal A
    act(() => { vi.advanceTimersByTime(900) })   // reveal B
    act(() => { vi.advanceTimersByTime(900) })   // reveal C -> round 1 complete
    act(() => { vi.advanceTimersByTime(800) })       // elimination beat -> round break
    expect(result.current.phase).toBe('roundBreak')
    expect(result.current.countdown).toBe(5)
    expect(result.current.upcomingRound).toBe(2)
    expect(result.current.justEliminated).toBe('C')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current.countdown).toBe(4)
  })

  it('a poll (new vm object, same data) does not reset the in-flight dwell timer', () => {
    const onComplete = vi.fn()
    const { result, rerender } = renderHook(
      ({ vm }) => useRoyaleReveal(vm, { reducedMotion: false, onComplete }),
      { initialProps: { vm: vm3 } },
    )
    // A dwell timer for card 0 (A) is scheduled on mount (DWELL_MS = 900). Advance part of it.
    act(() => { vi.advanceTimersByTime(500) })
    // A poll arrives mid-dwell: a fresh vm object with the same relevant fields.
    rerender({ vm: { ...vm3, players: [...vm3.players], rounds: [...vm3.rounds] } })
    // Advance only the REMAINDER of the original 900ms. If the rerender had reset the timer,
    // it would need a fresh 900ms and would NOT have fired by now.
    act(() => { vi.advanceTimersByTime(400) })
    const a = result.current.projection.players.find((p) => p.wallet === 'A')
    expect(a?.cards.length).toBe(1)   // A's card revealed → the original timer survived the poll
  })
})
