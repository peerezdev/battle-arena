import { useCallback, useEffect, useRef, useState } from 'react'
import type { RevealVM, RevealCardVM, RevealPlayerVM } from './battleReveal'
import { spinDurationMs } from './royaleShared'

export const ELIM_BEAT_MS = 800
/** Cuánto se queda en pantalla el cartel del eliminado cuando NO hubo empate. */
export const ELIM_SHOW_MS = 2000
export const COUNTDOWN_FROM = 5

export type RevealPhase = 'revealing' | 'tieBreak' | 'elimination' | 'roundBreak' | 'done'

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
  onCardFaceUp: () => void       // la carta quedó de cara: cuenta ya en la tabla, sin avanzar
  justEliminated: string | null  // player eliminated in the just-finished round (beat + break)
  tiedWallets: string[]          // players tied for last this round → spin the roulette (empty if no tie)
  eliminatedReveal: string | null // wallet que anuncia el cartel (ruleta o eliminación directa)
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

/**
 * Por dónde va la partida AHORA MISMO, en (ronda, carta). Sirve para engancharse al directo en
 * vez de repetir desde el principio: una royale de 10 son ~6 minutos de ceremonia y el servidor
 * la genera en mucho menos, así que entrar en la ronda 6 y arrancar en la 1 no es ver el directo
 * con retraso — es ver una repetición que nunca alcanza el presente.
 *
 * `card` es cuántas cartas de esa ronda YA están registradas, o sea la siguiente que animar.
 */
export function liveEdge(vm: RevealVM): { round: number; card: number } {
  let edge = { round: 1, card: 0 }
  for (const r of vm.rounds) {
    const order = revealOrderWallets(vm, r.roundNumber)
    // El PREFIJO, no el total: las cartas se enseñan en orden de asiento, así que si la del
    // primero aún no ha resuelto el borde sigue en él aunque el de detrás ya tenga la suya.
    let n = 0
    while (n < order.length && r.cards.find((c) => c.wallet === order[n])?.nftAddress) n++
    if (n > 0) edge = { round: r.roundNumber, card: n }
  }
  return edge
}

// Project the full VM down to what has been revealed at cursor (round, card).
/**
 * `completeRound=false` proyecta las cartas de la ronda en curso pero NO aplica su eliminación.
 * Hace falta para que la última carta sume en la tabla al quedar de cara sin destripar quién cae:
 * eso lo anuncia el cartel, unos segundos después.
 */
export function project(vm: RevealVM, round: number, card: number, completeRound = true): RevealVM {
  const revealedByWallet = new Map<string, RevealCardVM[]>()
  let lastFullRound = 0
  for (const r of vm.rounds) {
    const order = revealOrderWallets(vm, r.roundNumber)
    const nRevealed = r.roundNumber < round ? order.length
      : r.roundNumber === round ? Math.min(card, order.length)
      : 0
    if (order.length > 0 && nRevealed >= order.length && (r.roundNumber < round || completeRound)) {
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
  // Al ENTRAR en una partida ya empezada se arranca en su borde en vivo. Solo con 'running':
  // una terminada que te perdiste tiene que reproducirse entera desde el principio, que es para
  // lo que está el modal de "te las perdiste". El inicializador es perezoso a propósito — corre
  // una vez, así que los polls posteriores no vuelven a mover el cursor.
  const [round, setRound] = useState(() => (vm.status === 'running' ? liveEdge(vm).round : 1))
  const [card, setCard] = useState(() => (vm.status === 'running' ? liveEdge(vm).card : 0))
  const [phase, setPhase] = useState<RevealPhase>('revealing')
  const [countdown, setCountdown] = useState(COUNTDOWN_FROM)
  // La carta en el escenario ya está de cara: cuenta en la tabla aunque el cursor siga en ella.
  const [landed, setLanded] = useState(false)
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
  // Un número, no el array: `tied` se reconstruye en cada render y como dependencia del scheduler
  // reiniciaría el temporizador con cada poll. El milisegundo es el mismo mientras los datos lo
  // sean, así que el efecto no se reprograma sin motivo.
  const tieSpinMs = isTie ? spinDurationMs(tied, roundData?.eliminatedWallet ?? null) : 0

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
  const onCardShown = useCallback(() => { setLanded(false); setCard((c) => c + 1) }, [])
  /** La ceremonia avisa de que la carta quedó de cara: su valor entra YA en la tabla. */
  const onCardFaceUp = useCallback(() => setLanded(true), [])

  // Scheduler: only ROUND-level transitions are timed here. Per-card advance is driven by
  // onCardShown (the animation), so a 1.5s poll can never restart an in-flight reveal.
  useEffect(() => {
    if (reducedMotion || phase === 'done') return

    if (phase === 'roundBreak') {
      if (countdown <= 0) {
        setRound((r) => r + 1)
        setCard(0)
        setLanded(false)
        setPhase('revealing')
        return
      }
      const t = setTimeout(() => setCountdown((n) => n - 1), 1000)
      return () => clearTimeout(t)
    }

    // Las dos fases de cierre de ronda se resuelven igual; solo cambia cuánto dura el cartel.
    //
    //  · tieBreak dura el giro MÁS el rato de aterrizaje: con un tiempo fijo, a partir de 5
    //    empatados la ruleta seguía girando cuando la fase ya había acabado y el eliminado no se
    //    llegaba a ver. Así el cartel siempre se sostiene ELIM_SHOW_MS sobre el caído.
    //  · elimination no tiene nada que sortear, pero anuncia al eliminado igual: quién cae es el
    //    resultado de la ronda, y pasar directo al "Round N starts in" lo dejaba enterrado.
    if (phase === 'tieBreak' || phase === 'elimination') {
      const duracion = (phase === 'tieBreak' ? tieSpinMs : 0) + ELIM_SHOW_MS
      // En la ÚLTIMA ronda no hay siguiente: el cartel es lo último antes del resultado, y solo
      // se pasa cuando la batalla está liquidada. Si aún no lo está se sostiene el cartel; el
      // efecto vuelve a correr en cuanto `settled` cambie.
      if (isLastRound && !settled) return
      const t = setTimeout(() => {
        if (isLastRound) setPhase('done')
        else { setPhase('roundBreak'); setCountdown(COUNTDOWN_FROM) }
      }, duracion)
      return () => clearTimeout(t)
    }

    // phase === 'revealing' — waiting on the current card (its pull to resolve, then its
    // ceremony to land via onCardShown). Nothing to schedule until the round completes.
    if (!roundComplete) return

    // Round fully revealed. La última ronda pasa por la MISMA ceremonia que las demás: era el
    // fallo — cortaba aquí y saltaba a 'done', así que justo la ronda que decide la partida se
    // quedaba sin cartel, y un empate ahí dejaba al que perdía sin saber por qué perdió él.
    const next: RevealPhase = isTie ? 'tieBreak' : 'elimination'
    const t = setTimeout(() => setPhase(next), ELIM_BEAT_MS)
    return () => clearTimeout(t)
  }, [reducedMotion, phase, countdown, round, card, roundComplete, isLastRound, isTie, tieSpinMs, settled])

  if (reducedMotion) {
    return {
      phase, projection: vm, revealRound: round, countdown,
      upcomingRound: round + 1, openingWallet: null, stagingWallet: null, stagingCard: null,
      stagingKey: null, onCardShown, onCardFaceUp, justEliminated: null, tiedWallets: [], eliminatedReveal: null,
    }
  }

  // Con la carta ya de cara se proyecta una más —así el jugador ve su total subir en la tabla
  // mientras la carta sigue en el escenario— pero sin cerrar la ronda, que destriparía la
  // eliminación antes de su cartel.
  const projection = project(vm, round, card + (landed ? 1 : 0), !landed)
  const openingWallet = targetWallet && !targetResolved ? targetWallet : null
  const stagingWallet = targetWallet && targetResolved ? targetWallet : null
  const stagingCard = stagingWallet ? targetCard : null
  const stagingKey = stagingWallet ? `${round}:${card}` : null
  // Hold the elimination reveal while the tie-break roulette spins; show it from the round break on
  // (and immediately for the non-tie case, so the eliminated player's beat still plays).
  const justEliminated = (phase === 'roundBreak' || phase === 'elimination' || (roundComplete && !isTie))
    ? (roundData?.eliminatedWallet ?? null) : null
  // Solo la ruleta tiene candidatos que sortear; en la eliminación normal el cartel sale ya
  // resuelto, sin girar, porque no hubo azar que enseñar.
  const tiedWallets = phase === 'tieBreak' ? tied : []
  const eliminatedReveal = (phase === 'tieBreak' || phase === 'elimination')
    ? (roundData?.eliminatedWallet ?? null) : null
  return {
    phase, projection, revealRound: round, countdown, upcomingRound: round + 1,
    openingWallet, stagingWallet, stagingCard, stagingKey, onCardShown, onCardFaceUp, justEliminated, tiedWallets, eliminatedReveal,
  }
}
