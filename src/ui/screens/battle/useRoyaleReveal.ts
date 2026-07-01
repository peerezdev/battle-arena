import { useEffect, useRef, useState } from 'react'
import type { RevealVM, RevealCardVM, RevealPlayerVM } from './battleReveal'

export const DWELL_MS = 900
export const ELIM_BEAT_MS = 800
export const COUNTDOWN_FROM = 5

export type RevealPhase = 'revealing' | 'roundBreak' | 'done'

export interface RoyaleRevealState {
  phase: RevealPhase
  projection: RevealVM
  revealRound: number
  countdown: number
  upcomingRound: number
  openingWallet: string | null   // slot currently waiting for its pull to resolve ("abriendo…")
  justEliminated: string | null  // player eliminated in the just-finished round (beat + break)
}

// Players still alive at the START of `roundNumber`, in seating (vm.players) order.
export function revealOrderWallets(vm: RevealVM, roundNumber: number): string[] {
  return vm.players
    .filter((p) => p.eliminatedRound == null || p.eliminatedRound >= roundNumber)
    .map((p) => p.wallet)
}

// Last-one-standing: one elimination per round.
export function totalRounds(vm: RevealVM): number {
  return Math.max(1, vm.players.length - 1)
}

// Project the full VM down to what has been revealed at cursor (round, card).
export function project(vm: RevealVM, round: number, card: number): RevealVM {
  const revealedByWallet = new Map<string, RevealCardVM[]>()
  let lastFullRound = 0
  for (const r of vm.rounds) {
    const order = revealOrderWallets(vm, r.roundNumber)
    const nRevealed = r.roundNumber < round ? order.length
      : r.roundNumber === round ? Math.min(card, order.length)
      : 0
    if (order.length > 0 && nRevealed >= order.length) {
      lastFullRound = Math.max(lastFullRound, r.roundNumber)
    }
    for (let i = 0; i < nRevealed; i++) {
      const w = order[i]
      const c = r.cards.find((cc) => cc.wallet === w)
      if (c && c.nftAddress) {
        const arr = revealedByWallet.get(w) ?? []
        arr.push(c)
        revealedByWallet.set(w, arr)
      }
    }
  }
  const players: RevealPlayerVM[] = vm.players.map((p) => {
    const cards = revealedByWallet.get(p.wallet) ?? []
    const eliminatedRound = p.eliminatedRound != null && p.eliminatedRound <= lastFullRound ? p.eliminatedRound : null
    return { ...p, cards, total: cards.reduce((s, c) => s + (c.insuredValue ?? 0), 0), eliminatedRound }
  })
  const potValue = players.reduce((s, p) => s + p.total, 0)
  return { ...vm, players, potValue }
}

export function useRoyaleReveal(
  vm: RevealVM,
  { reducedMotion, onComplete }: { reducedMotion: boolean; onComplete?: () => void },
): RoyaleRevealState {
  const [round, setRound] = useState(1)
  const [card, setCard] = useState(0)
  const [phase, setPhase] = useState<RevealPhase>('revealing')
  const [countdown, setCountdown] = useState(COUNTDOWN_FROM)
  const firedRef = useRef(false)

  // Minimal derived signals so the scheduler's timers reset only on meaningful changes
  // (NOT on every 1.5s poll, which would restart an in-flight dwell timer forever).
  const order = revealOrderWallets(vm, round)
  const roundData = vm.rounds.find((r) => r.roundNumber === round)
  const targetWallet = phase === 'revealing' && card < order.length ? order[card] : null
  const targetResolved = !!(targetWallet && roundData?.cards.find((c) => c.wallet === targetWallet)?.nftAddress)
  const roundComplete = phase === 'revealing' && order.length > 0 && card >= order.length
  const isLastRound = vm.players.length - round <= 1
  const settled = vm.status === 'settled'

  // Fire onComplete exactly once when we reach 'done'.
  useEffect(() => {
    if (phase === 'done' && !firedRef.current) {
      firedRef.current = true
      onComplete?.()
    }
  }, [phase, onComplete])

  // Reduced motion: skip the whole animation, complete as soon as the battle settles.
  useEffect(() => {
    if (!reducedMotion) return
    if (settled && phase !== 'done') setPhase('done')
  }, [reducedMotion, settled, phase])

  // Scheduler: exactly one scheduled transition at a time.
  useEffect(() => {
    if (reducedMotion || phase === 'done') return

    if (phase === 'roundBreak') {
      if (countdown <= 0) {
        setRound((r) => r + 1)
        setCard(0)
        setPhase('revealing')
        return
      }
      const t = setTimeout(() => setCountdown((n) => n - 1), 1000)
      return () => clearTimeout(t)
    }

    // phase === 'revealing'
    if (!roundComplete) {
      if (targetResolved) {
        const t = setTimeout(() => setCard((c) => c + 1), DWELL_MS)
        return () => clearTimeout(t)
      }
      return   // waiting for the next pull to resolve; re-runs when targetResolved flips
    }

    // round fully revealed
    if (isLastRound) {
      if (settled) setPhase('done')
      return   // else hold on the fully-revealed final round until the battle settles
    }
    const t = setTimeout(() => { setPhase('roundBreak'); setCountdown(COUNTDOWN_FROM) }, ELIM_BEAT_MS)
    return () => clearTimeout(t)
  }, [reducedMotion, phase, countdown, round, card, roundComplete, targetResolved, isLastRound, settled])

  if (reducedMotion) {
    return {
      phase, projection: vm, revealRound: round, countdown,
      upcomingRound: round + 1, openingWallet: null, justEliminated: null,
    }
  }

  const projection = project(vm, round, card)
  const openingWallet = targetWallet && !targetResolved ? targetWallet : null
  const justEliminated = roundComplete || phase === 'roundBreak' ? (roundData?.eliminatedWallet ?? null) : null
  return { phase, projection, revealRound: round, countdown, upcomingRound: round + 1, openingWallet, justEliminated }
}
