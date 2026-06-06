import type { Allocation, MatchState, Player } from '../engine'
import { availableEnergy } from '../engine'

export type Difficulty = 'easy' | 'medium' | 'hard'

function randInt(maxInclusive: number): number {
  return Math.floor(Math.random() * (maxInclusive + 1))
}

// Reparte `budget` en 3 cubos enteros >=0 sumando <= budget.
function splitRandom(budget: number): Allocation {
  const a = randInt(budget)
  const b = randInt(budget - a)
  const c = randInt(budget - a - b)
  return { apertura: a, choque: b, remate: c }
}

// Heurística: concentra para ganar 2 de 3 frentes, deja algo sin gastar (banca).
function splitHeuristic(budget: number, spendRatio: number): Allocation {
  const spend = Math.floor(budget * spendRatio)
  // elige 2 frentes fuertes
  const fronts: (keyof Allocation)[] = ['apertura', 'choque', 'remate']
  const strong = fronts.filter(() => Math.random() < 0.66).slice(0, 2)
  const picks = strong.length >= 2 ? strong : ['apertura', 'remate']
  const half = Math.floor(spend / 2)
  const alloc: Allocation = { apertura: 0, choque: 0, remate: 0 }
  alloc[picks[0]] = half
  alloc[picks[1]] = spend - half
  return alloc
}

export function decide(
  state: MatchState,
  botPlayer: Player,
  _history: Allocation[],
  difficulty: Difficulty = 'medium',
): Allocation {
  const budget = availableEnergy(state, botPlayer)
  if (difficulty === 'easy') return splitRandom(budget)
  if (difficulty === 'medium') return splitHeuristic(budget, 0.85 + Math.random() * 0.15)
  // hard: gasta casi todo y a veces banca fuerte para spike posterior
  const spendRatio = state.round === state.config.roundsToWin - 1 ? 1 : 0.7 + Math.random() * 0.3
  return splitHeuristic(budget, spendRatio)
}
