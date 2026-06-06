import type { Card, MatchConfig, MatchState, Player } from './types'
import { computeEdge } from './edge'

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
