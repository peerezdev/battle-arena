import { useCallback, useEffect, useRef, useState } from 'react'
import type { RevealVM, RevealCardVM, RevealPlayerVM } from './battleReveal'

export const ELIM_BEAT_MS = 800
export const ROULETTE_MS = 3200
export const COUNTDOWN_FROM = 5

export type RevealPhase = 'revealing' | 'tieBreak' | 'roundBreak' | 'done'

export interface RoyaleRevealState {
  phase: RevealPhase
  projection: RevealVM
  revealRound: number
  countdown: number
  upcomingRound: number
  openingWallet: string | null   // slot currently waiting for its pull to resolve ("abriendo…")
  stagingWallet: string | null   // player whose card is playing its year→grade→rarity→card ceremony now
  stagingCard: RevealCardVM | null  // the card that stagingWallet is revealing
  stagingKey: string | null      // unique per reveal step (round+cursor) — keys the staged card so it
                                 // remounts every step even if two pulls share an nft address
  onCardShown: () => void        // the staged ceremony calls this when it lands → advance to the next card
  justEliminated: string | null  // player eliminated in the just-finished round (beat + break)
  tiedWallets: string[]          // players tied for last this round → spin the roulette (empty if no tie)
  tieEliminated: string | null   // the wallet the roulette must land on (already decided upstream)
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

// Players tied for last after `round` (min accumulated among those alive at the round's start,
// using the full round data). >1 means the elimination was a random pick — worth animating.
export function tiedLosers(vm: RevealVM, round: number): string[] {
  const contenders = revealOrderWallets(vm, round)
  if (contenders.length === 0) return []
  const acc = (w: string) => vm.rounds
    .filter((r) => r.roundNumber <= round)
    .reduce((s, r) => s + (r.cards.find((c) => c.wallet === w)?.insuredValue ?? 0), 0)
  const totals = contenders.map((w) => ({ w, t: acc(w) }))
  const min = Math.min(...totals.map((x) => x.t))
  return totals.filter((x) => x.t === min).map((x) => x.w)
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

  // Derived signals — the current target card and whether its pull has resolved on-chain.
  const order = revealOrderWallets(vm, round)
  const roundData = vm.rounds.find((r) => r.roundNumber === round)
  const targetWallet = phase === 'revealing' && card < order.length ? order[card] : null
  const targetCard = targetWallet ? (roundData?.cards.find((c) => c.wallet === targetWallet) ?? null) : null
  const targetResolved = !!targetCard?.nftAddress
  const roundComplete = phase === 'revealing' && order.length > 0 && card >= order.length
  const isLastRound = vm.players.length - round <= 1
  const settled = vm.status === 'settled'
  const tied = tiedLosers(vm, round)   // >1 → this round's elimination was a random pick
  const isTie = tied.length > 1

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

  // Advance the reveal cursor by one card. Driven by the staged ceremony's onCardShown, so each
  // card plays its full year→grade→rarity→card reveal before the next begins (instead of a fixed
  // dwell timer racing the animation). Stable identity → a poll never disturbs it.
  const onCardShown = useCallback(() => setCard((c) => c + 1), [])

  // Scheduler: only ROUND-level transitions are timed here. Per-card advance is driven by
  // onCardShown (the animation), so a 1.5s poll can never restart an in-flight reveal.
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

    if (phase === 'tieBreak') {
      // Spin the roulette, then reveal who dropped and roll into the round break.
      const t = setTimeout(() => { setPhase('roundBreak'); setCountdown(COUNTDOWN_FROM) }, ROULETTE_MS)
      return () => clearTimeout(t)
    }

    // phase === 'revealing' — waiting on the current card (its pull to resolve, then its
    // ceremony to land via onCardShown). Nothing to schedule until the round completes.
    if (!roundComplete) return

    // round fully revealed
    if (isLastRound) {
      if (settled) setPhase('done')
      return   // else hold on the fully-revealed final round until the battle settles
    }
    // A tie for last → run the random-pick roulette (tieBreak) before revealing the loser.
    const next: RevealPhase = isTie ? 'tieBreak' : 'roundBreak'
    const t = setTimeout(() => {
      setPhase(next)
      if (next === 'roundBreak') setCountdown(COUNTDOWN_FROM)
    }, ELIM_BEAT_MS)
    return () => clearTimeout(t)
  }, [reducedMotion, phase, countdown, round, card, roundComplete, isLastRound, isTie, settled])

  if (reducedMotion) {
    return {
      phase, projection: vm, revealRound: round, countdown,
      upcomingRound: round + 1, openingWallet: null, stagingWallet: null, stagingCard: null,
      stagingKey: null, onCardShown, justEliminated: null, tiedWallets: [], tieEliminated: null,
    }
  }

  const projection = project(vm, round, card)
  const openingWallet = targetWallet && !targetResolved ? targetWallet : null
  const stagingWallet = targetWallet && targetResolved ? targetWallet : null
  const stagingCard = stagingWallet ? targetCard : null
  const stagingKey = stagingWallet ? `${round}:${card}` : null
  // Hold the elimination reveal while the tie-break roulette spins; show it from the round break on
  // (and immediately for the non-tie case, so the eliminated player's beat still plays).
  const justEliminated = (phase === 'roundBreak' || (roundComplete && !isTie))
    ? (roundData?.eliminatedWallet ?? null) : null
  const tiedWallets = phase === 'tieBreak' ? tied : []
  const tieEliminated = phase === 'tieBreak' ? (roundData?.eliminatedWallet ?? null) : null
  return {
    phase, projection, revealRound: round, countdown, upcomingRound: round + 1,
    openingWallet, stagingWallet, stagingCard, stagingKey, onCardShown, justEliminated, tiedWallets, tieEliminated,
  }
}
