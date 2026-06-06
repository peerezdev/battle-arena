import type { Card, MatchConfig, MatchState, Player, Allocation, FrontKey, FrontWinner } from './types'
import { computeEdge } from './edge'
import { hashAllocation } from './hash'
import { solidez } from './solidez'

export function createMatch(cardA: Card, cardB: Card, config: MatchConfig): MatchState {
  const high = cardA.valueUsd >= cardB.valueUsd ? cardA.valueUsd : cardB.valueUsd
  const low = cardA.valueUsd >= cardB.valueUsd ? cardB.valueUsd : cardA.valueUsd
  const ratio = low > 0 ? high / low : Infinity

  if (config.mode === 'ranked' && ratio > config.valueRatioCap) {
    throw new Error(`Matchup rechazado: ratio de valor ${ratio.toFixed(2)} > cap ${config.valueRatioCap}`)
  }

  const edge = computeEdge(high, low, config)
  const aIsHigh = cardA.valueUsd >= cardB.valueUsd
  const edgePerRound = {
    a: aIsHigh ? edge.high : edge.low,
    b: aIsHigh ? edge.low : edge.high,
  }

  return {
    cardA,
    cardB,
    config,
    phase: 'committing',
    round: 0,
    bankedEnergy: { a: 0, b: 0 },
    edgePerRound,
    roundWins: { a: 0, b: 0 },
    rounds: [{}],
    winner: null,
  }
}

export function availableEnergy(state: MatchState, player: Player): number {
  return state.bankedEnergy[player] + state.config.baseEnergyPerRound + state.edgePerRound[player]
}

function allocTotal(a: Allocation): number {
  return a.apertura + a.choque + a.remate
}

export function commit(state: MatchState, player: Player, hash: string): MatchState {
  if (state.phase !== 'committing') throw new Error('No se puede commitear fuera de la fase committing')
  const round = { ...state.rounds[state.round] }
  if (player === 'a') round.commitA = hash
  else round.commitB = hash
  const rounds = [...state.rounds]
  rounds[state.round] = round
  const bothCommitted = !!round.commitA && !!round.commitB
  return { ...state, rounds, phase: bothCommitted ? 'revealing' : 'committing' }
}

export async function reveal(
  state: MatchState,
  player: Player,
  allocation: Allocation,
  salt: string,
): Promise<MatchState> {
  if (state.phase !== 'revealing') throw new Error('No se puede revelar fuera de la fase revealing')
  if (allocation.apertura < 0 || allocation.choque < 0 || allocation.remate < 0)
    throw new Error('Asignación inválida: valores negativos')
  if (allocTotal(allocation) > availableEnergy(state, player))
    throw new Error('Asignación excede el disponible')

  const expected = player === 'a' ? state.rounds[state.round].commitA : state.rounds[state.round].commitB
  const actual = await hashAllocation(allocation, salt)
  if (actual !== expected) throw new Error('El hash del reveal no casa con el commit')

  const round = { ...state.rounds[state.round] }
  if (player === 'a') { round.revealA = allocation; round.saltA = salt }
  else { round.revealB = allocation; round.saltB = salt }
  const rounds = [...state.rounds]
  rounds[state.round] = round
  return { ...state, rounds }
}

const FRONTS: FrontKey[] = ['apertura', 'choque', 'remate']

function resolveFront(
  aVal: number, bVal: number, solA: number, solB: number,
): FrontWinner {
  if (aVal > bVal) return 'a'
  if (bVal > aVal) return 'b'
  // empate -> Aguante por Solidez
  if (solA > solB) return 'a'
  if (solB > solA) return 'b'
  return 'disputed'
}

export function resolveRound(state: MatchState): MatchState {
  if (state.phase !== 'revealing') throw new Error('La ronda no está lista para resolverse')
  const r = state.rounds[state.round]
  if (!r.revealA || !r.revealB) throw new Error('Faltan reveals para resolver')

  const solA = solidez(state.cardA)
  const solB = solidez(state.cardB)

  const frontWinners = {} as Record<FrontKey, FrontWinner>
  let aFronts = 0, bFronts = 0
  for (const f of FRONTS) {
    const w = resolveFront(r.revealA[f], r.revealB[f], solA, solB)
    frontWinners[f] = w
    if (w === 'a') aFronts++
    else if (w === 'b') bFronts++
  }

  const totalA = r.revealA.apertura + r.revealA.choque + r.revealA.remate
  const totalB = r.revealB.apertura + r.revealB.choque + r.revealB.remate

  let roundWinner: FrontWinner
  if (aFronts > bFronts) roundWinner = 'a'
  else if (bFronts > aFronts) roundWinner = 'b'
  else if (totalA > totalB) roundWinner = 'a'      // desempate 1: energía total
  else if (totalB > totalA) roundWinner = 'b'
  else if (solA > solB) roundWinner = 'a'          // desempate 2: Solidez
  else if (solB > solA) roundWinner = 'b'
  else roundWinner = 'disputed'                    // ronda nula

  // banking: el sobrante (disponible - gastado) se banca para la siguiente ronda
  const bankedEnergy = {
    a: availableEnergy(state, 'a') - totalA,
    b: availableEnergy(state, 'b') - totalB,
  }

  const roundWins = { ...state.roundWins }
  if (roundWinner === 'a') roundWins.a++
  else if (roundWinner === 'b') roundWins.b++

  const rounds = [...state.rounds]
  rounds[state.round] = { ...r, frontWinners, roundWinner }

  return { ...state, rounds, roundWins, bankedEnergy, phase: 'roundResolved' }
}
