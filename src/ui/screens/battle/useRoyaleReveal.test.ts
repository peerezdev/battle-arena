import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRoyaleReveal, project, revealOrderWallets, totalRounds, tiedLosers, liveEdge, ELIM_BEAT_MS, ELIM_SHOW_MS } from './useRoyaleReveal'
import { spinDurationMs } from './royaleShared'
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
    // La última ronda pasa por el cartel del eliminado como cualquier otra; antes saltaba al
    // resultado sin anunciar quién había caído.
    act(() => { vi.advanceTimersByTime(ELIM_BEAT_MS) })
    expect(result.current.phase).toBe('elimination')
    act(() => { vi.advanceTimersByTime(ELIM_SHOW_MS) })
    expect(result.current.phase).toBe('done')
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('enters a round break with a countdown between rounds', () => {
    const onComplete = vi.fn()
    const { result } = renderHook(() => useRoyaleReveal(vm3, { reducedMotion: false, onComplete }))
    act(() => { result.current.onCardShown() })   // reveal A
    act(() => { result.current.onCardShown() })   // reveal B
    act(() => { result.current.onCardShown() })   // reveal C -> round 1 complete
    act(() => { vi.advanceTimersByTime(ELIM_BEAT_MS) })    // beat -> cartel del eliminado
    act(() => { vi.advanceTimersByTime(ELIM_SHOW_MS) })    // cartel -> round break
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
    // Dos `act` y no uno: el temporizador del cartel no existe hasta que corre el efecto de esa
    // fase, así que un único avance de 2800ms no llegaría a programarlo.
    act(() => { vi.advanceTimersByTime(ELIM_BEAT_MS) })   // beat -> cartel del eliminado
    act(() => { vi.advanceTimersByTime(ELIM_SHOW_MS) })   // cartel -> roundBreak
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

  it('sin empate también anuncia al eliminado antes de la cuenta atrás', () => {
    // Antes se pasaba de la última carta directo al "Round N starts in" y quién caía solo se veía
    // en el chip. Ahora la ronda cierra con el mismo cartel que la ruleta, pero sin sorteo.
    const { result } = renderHook(() => useRoyaleReveal(vm3, { reducedMotion: false, onComplete: vi.fn() }))
    act(() => { result.current.onCardShown() })   // A
    act(() => { result.current.onCardShown() })   // B
    act(() => { result.current.onCardShown() })   // C → ronda 1 completa, sin empate (C cae solo)

    act(() => { vi.advanceTimersByTime(ELIM_BEAT_MS) })
    expect(result.current.phase).toBe('elimination')
    expect(result.current.eliminatedReveal).toBe('C')   // el cartel sabe a quién anunciar
    expect(result.current.tiedWallets).toEqual([])      // y no hay nada que sortear

    // El cartel dura lo suyo: la cuenta atrás NO ha arrancado todavía.
    act(() => { vi.advanceTimersByTime(ELIM_SHOW_MS - 1) })
    expect(result.current.phase).toBe('elimination')

    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current.phase).toBe('roundBreak')
    expect(result.current.eliminatedReveal).toBeNull()  // el cartel se va con la fase
  })

  it('con muchos empatados la fase dura lo que el giro: el eliminado SIEMPRE se llega a ver', () => {
    // El fallo: la ruleta tenía una ventana fija de 3200ms, pero el giro crece con los empatados
    // (5 → 3,6s; 8 → 5,9s). A partir de 5 la fase acababa girando todavía y nadie veía quién caía.
    const n = 6
    const wallets = ['A', 'B', 'C', 'D', 'E', 'F', 'G']          // A gana, B..G empatan a 0
    const vmBigTie: RevealVM = {
      mode: 'royale', status: 'settled', winner: 'A', meWallet: 'A',
      players: wallets.map((w, i) => ({
        wallet: w, isMe: w === 'A', accumulatedValue: w === 'A' ? 100 : 0,
        eliminatedRound: w === 'A' ? null : (w === 'G' ? 1 : i), cards: [], total: 0,
      })),
      rounds: [{
        roundNumber: 1, eliminatedWallet: 'G',
        cards: wallets.map((w) => card(w, w === 'A', w === 'A' ? 100 : 0, `n${w}`)),
      }],
      potValue: 100, machines: ['m'], buybackTotal: 0, entry: 0,
    }
    const tied = tiedLosers(vmBigTie, 1)
    expect(tied.length).toBe(n)                                   // los seis empatados a 0
    const spin = spinDurationMs(tied, 'G')
    expect(spin).toBeGreaterThan(3200)                            // el giro NO cabía en la ventana vieja

    const { result } = renderHook(() => useRoyaleReveal(vmBigTie, { reducedMotion: false, onComplete: vi.fn() }))
    wallets.forEach(() => act(() => { result.current.onCardShown() }))
    act(() => { vi.advanceTimersByTime(ELIM_BEAT_MS) })
    expect(result.current.phase).toBe('tieBreak')

    // Con la ventana vieja aquí ya se habría pasado de fase con la ruleta a medio girar.
    act(() => { vi.advanceTimersByTime(3200) })
    expect(result.current.phase).toBe('tieBreak')

    // Aterriza, y todavía se sostiene sobre el eliminado antes de soltar la cuenta atrás.
    act(() => { vi.advanceTimersByTime(spin - 3200 + ELIM_SHOW_MS - 1) })
    expect(result.current.phase).toBe('tieBreak')
    expect(result.current.eliminatedReveal).toBe('G')

    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current.phase).toBe('roundBreak')
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
    expect(result.current.eliminatedReveal).toBe('C')
    expect(result.current.justEliminated).toBeNull()          // still hidden while the roulette spins

    act(() => { vi.advanceTimersByTime(spinDurationMs(['B', 'C'], 'C') + ELIM_SHOW_MS) })   // gira, aterriza y se sostiene → round break
    expect(result.current.phase).toBe('roundBreak')
    expect(result.current.justEliminated).toBe('C')           // now revealed
    expect(result.current.tiedWallets).toEqual([])
  })
})

describe('la tabla se mueve al quedar la carta de cara, no al pasar a la siguiente', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const totals = (r: { current: { projection: RevealVM } }) =>
    Object.fromEntries(r.current.projection.players.map((p) => [p.wallet, p.total]))

  it('onCardFaceUp suma esa carta SIN mover el cursor', () => {
    const { result } = renderHook(() => useRoyaleReveal(vm3, { reducedMotion: false, onComplete: vi.fn() }))
    expect(totals(result)).toEqual({ A: 0, B: 0, C: 0 })
    expect(result.current.stagingWallet).toBe('A')

    act(() => { result.current.onCardFaceUp() })
    expect(totals(result)).toEqual({ A: 100, B: 0, C: 0 })   // A ya cuenta…
    expect(result.current.stagingWallet).toBe('A')           // …y su carta sigue en el escenario

    act(() => { result.current.onCardShown() })
    expect(result.current.stagingWallet).toBe('B')           // ahora sí pasa a la siguiente
    expect(totals(result)).toEqual({ A: 100, B: 0, C: 0 })   // sin contar dos veces
  })

  it('la última carta de la ronda suma pero NO destripa la eliminación', () => {
    const { result } = renderHook(() => useRoyaleReveal(vm3, { reducedMotion: false, onComplete: vi.fn() }))
    act(() => { result.current.onCardShown() })   // A
    act(() => { result.current.onCardShown() })   // B
    act(() => { result.current.onCardFaceUp() })  // C queda de cara: es la última de la ronda

    expect(totals(result)).toEqual({ A: 100, B: 90, C: 40 })   // C ya suma en la tabla
    const c = result.current.projection.players.find((p) => p.wallet === 'C')!
    expect(c.eliminatedRound).toBeNull()   // pero todavía no está marcado como eliminado

    act(() => { result.current.onCardShown() })
    act(() => { vi.advanceTimersByTime(ELIM_BEAT_MS) })
    expect(result.current.phase).toBe('elimination')   // eso lo anuncia el cartel
  })
})

describe('engancharse al directo', () => {
  // vm3 en curso: ronda 1 entera registrada y la 2 a medias (solo A ha tirado).
  const enCurso: RevealVM = {
    ...vm3, status: 'running',
    players: vm3.players.map((p) => ({ ...p, eliminatedRound: p.wallet === 'C' ? 1 : null })),
    rounds: [
      vm3.rounds[0],
      { roundNumber: 2, eliminatedWallet: 'B', cards: [card('A', true, 200, 'nA2'), card('B', false, 60, null)] },
    ],
  }

  it('liveEdge respeta el orden: no salta una tirada que aún no ha resuelto', () => {
    // Ronda 2 con A resuelta y B no: el borde es (2, 1) —la siguiente que animar es la de B—.
    // Si contara resueltas sueltas en vez del prefijo, una tirada lenta del primero haría
    // saltársela y el jugador vería la de detrás antes que la suya.
    // La ronda 2 existe pero solo A tiene carta: el borde es (2, 1), o sea "la siguiente que
    // animar es la de B". Con (2, 2) se saltaría una tirada que aún no ha ocurrido.
    expect(liveEdge(enCurso)).toEqual({ round: 2, card: 1 })
  })

  it('una partida en curso ARRANCA en ese borde en vez de repetir desde el principio', () => {
    const { result } = renderHook(() => useRoyaleReveal(enCurso, { reducedMotion: false, onComplete: vi.fn() }))
    expect(result.current.revealRound).toBe(2)
    // B es la que toca ahora, no la ronda 1. Su tirada aún no ha resuelto → sale como "opening".
    expect(result.current.openingWallet).toBe('B')
  })

  it('una partida TERMINADA sigue reproduciéndose entera: es la que te perdiste', () => {
    const { result } = renderHook(() => useRoyaleReveal(vm3, { reducedMotion: false, onComplete: vi.fn() }))
    expect(result.current.revealRound).toBe(1)
    expect(result.current.stagingWallet).toBe('A')
  })

  it('un poll posterior no vuelve a mover el cursor', () => {
    // El inicializador es perezoso: si se recalculara en cada render, cada poll daría un salto
    // hacia delante y el reveal iría a trompicones.
    const { result, rerender } = renderHook(
      ({ vm }) => useRoyaleReveal(vm, { reducedMotion: false, onComplete: vi.fn() }),
      { initialProps: { vm: enCurso } },
    )
    expect(result.current.revealRound).toBe(2)
    act(() => { result.current.onCardShown() })   // avanza a mano
    const avanzado = { ...enCurso, rounds: [...enCurso.rounds] }
    rerender({ vm: avanzado })
    expect(result.current.revealRound).toBe(2)   // el poll no lo ha reseteado
  })
})


// 2 jugadores que EMPATAN en la última ronda: los dos a 100, y la semilla eligió a B.
// Es el caso que se pidió y el que más falta hace explicar: quien pierde un empate se queda sin
// saber por qué perdió él y no el otro.
const vmEmpateFinal: RevealVM = {
  mode: 'royale', status: 'settled', winner: 'A', meWallet: 'B',
  players: [
    { wallet: 'A', isMe: false, accumulatedValue: 100, eliminatedRound: null, cards: [], total: 100 },
    { wallet: 'B', isMe: true, accumulatedValue: 100, eliminatedRound: 1, cards: [], total: 100 },
  ],
  rounds: [{ roundNumber: 1, eliminatedWallet: 'B',
             cards: [card('A', false, 100, 'nA1'), card('B', true, 100, 'nB1')] }],
  potValue: 200, machines: ['m'], buybackTotal: 0, entry: 0,
}

describe('useRoyaleReveal · la última ronda también tiene ceremonia', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('un empate en la ÚLTIMA ronda enseña la ruleta', () => {
    // Era el fallo: `isLastRound` cortaba antes de decidir la fase y saltaba directo a 'done',
    // así que justo la ronda que decide la partida se quedaba sin explicación.
    const { result } = renderHook(() => useRoyaleReveal(vmEmpateFinal, { reducedMotion: false, onComplete: vi.fn() }))
    act(() => { result.current.onCardShown() })
    act(() => { result.current.onCardShown() })
    act(() => { vi.advanceTimersByTime(ELIM_BEAT_MS) })

    expect(result.current.phase).toBe('tieBreak')
    expect([...result.current.tiedWallets].sort()).toEqual(['A', 'B'])
    expect(result.current.eliminatedReveal).toBe('B')
  })

  it('y cuando la ruleta aterriza, va al resultado (no a una ronda que no existe)', () => {
    const { result } = renderHook(() => useRoyaleReveal(vmEmpateFinal, { reducedMotion: false, onComplete: vi.fn() }))
    act(() => { result.current.onCardShown() })
    act(() => { result.current.onCardShown() })
    act(() => { vi.advanceTimersByTime(ELIM_BEAT_MS) })
    act(() => { vi.advanceTimersByTime(spinDurationMs(['A', 'B'], 'B') + ELIM_SHOW_MS) })

    expect(result.current.phase).toBe('done')   // NO 'roundBreak': no hay ronda siguiente
  })

  it('sin empate, la última ronda anuncia igualmente al eliminado antes del resultado', () => {
    // La misma ceremonia que cualquier otra ronda: quién cae es el resultado de la ronda.
    const { result } = renderHook(() => useRoyaleReveal(vm2, { reducedMotion: false, onComplete: vi.fn() }))
    act(() => { result.current.onCardShown() })
    act(() => { result.current.onCardShown() })
    act(() => { vi.advanceTimersByTime(ELIM_BEAT_MS) })

    expect(result.current.phase).toBe('elimination')
    expect(result.current.eliminatedReveal).toBe('B')

    act(() => { vi.advanceTimersByTime(ELIM_SHOW_MS) })
    expect(result.current.phase).toBe('done')
  })
})
