import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRoyaleReveal, project, revealOrderWallets, totalRounds, tiedLosers, ELIM_BEAT_MS, ROULETTE_MS } from './useRoyaleReveal'
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
  potValue: 160, machines: ['m'], buybackTotal: 0, entry: 0,
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
  potValue: 490, machines: ['m'], buybackTotal: 0, entry: 0,
}

// 3 players, round 1 ends in a tie for last: B and C both at 40 → C is the (pre-decided) loser.
const vmTie: RevealVM = {
  mode: 'royale', status: 'settled', winner: 'A', meWallet: 'A',
  players: [
    { wallet: 'A', isMe: true, accumulatedValue: 100, eliminatedRound: null, cards: [], total: 100 },
    { wallet: 'B', isMe: false, accumulatedValue: 40, eliminatedRound: 2, cards: [], total: 40 },
    { wallet: 'C', isMe: false, accumulatedValue: 40, eliminatedRound: 1, cards: [], total: 40 },
  ],
  rounds: [
    { roundNumber: 1, eliminatedWallet: 'C', cards: [card('A', true, 100, 'nA1'), card('B', false, 40, 'nB1'), card('C', false, 40, 'nC1')] },
    { roundNumber: 2, eliminatedWallet: 'B', cards: [card('A', true, 0, 'nA2'), card('B', false, 0, 'nB2')] },
  ],
  potValue: 280, machines: ['m'], buybackTotal: 0, entry: 0,
}

describe('pure helpers', () => {
  it('tiedLosers returns everyone tied for last (min accumulated), else the single lowest', () => {
    expect([...tiedLosers(vmTie, 1)].sort()).toEqual(['B', 'C'])   // 40 == 40 tie
    expect(tiedLosers(vm3, 1)).toEqual(['C'])                      // C alone at 40
  })

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

  it('reveals cards one by one (advancing on each staged card) and reaches done on the settled final round', () => {
    const onComplete = vi.fn()
    const { result } = renderHook(() => useRoyaleReveal(vm2, { reducedMotion: false, onComplete }))
    expect(result.current.phase).toBe('revealing')
    expect(result.current.stagingWallet).toBe('A')                 // A's card is staging first
    act(() => { result.current.onCardShown() })                    // A's ceremony lands → reveal A
    expect(result.current.stagingWallet).toBe('B')                 // then B
    act(() => { result.current.onCardShown() })                    // B lands → round complete, last, settled
    act(() => { vi.advanceTimersByTime(0) })                       // effect runs → done
    expect(result.current.phase).toBe('done')
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('enters a round break with a countdown between rounds', () => {
    const onComplete = vi.fn()
    const { result } = renderHook(() => useRoyaleReveal(vm3, { reducedMotion: false, onComplete }))
    act(() => { result.current.onCardShown() })   // reveal A
    act(() => { result.current.onCardShown() })   // reveal B
    act(() => { result.current.onCardShown() })   // reveal C -> round 1 complete
    act(() => { vi.advanceTimersByTime(800) })    // elimination beat -> round break
    expect(result.current.phase).toBe('roundBreak')
    expect(result.current.countdown).toBe(5)
    expect(result.current.upcomingRound).toBe(2)
    expect(result.current.justEliminated).toBe('C')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current.countdown).toBe(4)
  })

  it('a poll (new vm object, same data) does not reset the in-flight round-break countdown timer', () => {
    const onComplete = vi.fn()
    const { result, rerender } = renderHook(
      ({ vm }) => useRoyaleReveal(vm, { reducedMotion: false, onComplete }),
      { initialProps: { vm: vm3 } },
    )
    // Reveal round 1 fully, then the beat drops us into the round break (countdown 5, 1s ticks).
    act(() => { result.current.onCardShown() })   // A
    act(() => { result.current.onCardShown() })   // B
    act(() => { result.current.onCardShown() })   // C -> round complete
    act(() => { vi.advanceTimersByTime(800) })    // beat -> roundBreak
    expect(result.current.phase).toBe('roundBreak')
    // Part of the way through the 1000ms tick, a poll arrives (fresh vm object, same data).
    act(() => { vi.advanceTimersByTime(600) })
    rerender({ vm: { ...vm3, players: [...vm3.players], rounds: [...vm3.rounds] } })
    // Advance only the REMAINDER of the tick. If the poll reset the timer it would need a fresh
    // 1000ms and the countdown would still read 5.
    act(() => { vi.advanceTimersByTime(400) })
    expect(result.current.countdown).toBe(4)   // the original tick survived the poll
  })

  it('exposes the current card as staging once its pull resolves, and opening while it is pending', () => {
    // Fully resolved → A (cursor 0) is staging.
    const resolved = renderHook(() => useRoyaleReveal(vm2, { reducedMotion: false, onComplete: vi.fn() }))
    expect(resolved.result.current.stagingWallet).toBe('A')
    expect(resolved.result.current.stagingCard?.nftAddress).toBe('nA1')
    expect(resolved.result.current.openingWallet).toBeNull()

    // A's pull not resolved yet (no nftAddress) → A is "opening", nothing staging.
    const pendingVm: RevealVM = {
      ...vm2, status: 'running',
      rounds: [{ ...vm2.rounds[0], cards: [card('A', true, null, null), card('B', false, 40, 'nB1')] }],
    }
    const pending = renderHook(() => useRoyaleReveal(pendingVm, { reducedMotion: false, onComplete: vi.fn() }))
    expect(pending.result.current.openingWallet).toBe('A')
    expect(pending.result.current.stagingWallet).toBeNull()
  })

  it('gives each staged card a distinct key even when two pulls share an nft address (no stall)', () => {
    // The demo picks pool cards with replacement, so two players in a round can hold the SAME
    // nft_address. Keying the staged reveal by nft_address would not remount → onCardShown never
    // fires again → the reveal freezes. The key must be unique per reveal step instead.
    const vmDup: RevealVM = {
      ...vm3,
      rounds: [
        { roundNumber: 1, eliminatedWallet: 'C', cards: [card('A', true, 100, 'dup'), card('B', false, 90, 'dup'), card('C', false, 40, 'nC1')] },
        { roundNumber: 2, eliminatedWallet: 'B', cards: [card('A', true, 200, 'nA2'), card('B', false, 60, 'nB2')] },
      ],
    }
    const { result } = renderHook(() => useRoyaleReveal(vmDup, { reducedMotion: false, onComplete: vi.fn() }))
    const seen = new Set<string>()
    for (let i = 0; i < 3; i++) {
      const key = result.current.stagingKey
      expect(typeof key).toBe('string')                 // a real key exists at each staging step
      expect(seen.has(key as string)).toBe(false)       // and never repeats (A and B share 'dup')
      seen.add(key as string)
      act(() => { result.current.onCardShown() })
    }
  })

  it('runs the tie-break roulette before the round break, holding the elimination until it lands', () => {
    const { result } = renderHook(() => useRoyaleReveal(vmTie, { reducedMotion: false, onComplete: vi.fn() }))
    act(() => { result.current.onCardShown() })   // reveal A
    act(() => { result.current.onCardShown() })   // reveal B
    act(() => { result.current.onCardShown() })   // reveal C → round 1 complete, B & C tie at 40
    expect(result.current.justEliminated).toBeNull()          // not revealed yet — roulette first

    act(() => { vi.advanceTimersByTime(ELIM_BEAT_MS) })        // → tieBreak
    expect(result.current.phase).toBe('tieBreak')
    expect([...result.current.tiedWallets].sort()).toEqual(['B', 'C'])
    expect(result.current.tieEliminated).toBe('C')
    expect(result.current.justEliminated).toBeNull()          // still hidden while the roulette spins

    act(() => { vi.advanceTimersByTime(ROULETTE_MS) })         // roulette lands → round break
    expect(result.current.phase).toBe('roundBreak')
    expect(result.current.justEliminated).toBe('C')           // now revealed
    expect(result.current.tiedWallets).toEqual([])
  })
})
