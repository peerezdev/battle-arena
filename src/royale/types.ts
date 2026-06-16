// Tipos del prototipo de Battle Royale (tiradas simuladas, sin blockchain).
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic'

/** Orden de rareza (asc): para desempates, la rareza más baja "pierde". */
export const RARITY_ORDER: Record<Rarity, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
}

export interface RoyaleCard {
  id: string
  name: string
  rarity: Rarity
  valueUsd: number
  grade: number // 1..10
}

export interface PackTier {
  code: string
  name: string
  price: number // USDC
  odds: Record<Rarity, number> // porcentajes, suman ~100
  valueBands: Record<Rarity, [number, number]> // [min, max] USD por rareza
}

export type RoyalePlayerStatus = 'active' | 'eliminated' | 'winner'

export interface RoyalePlayer {
  id: number // índice de asiento 0..N-1
  name: string
  isBot: boolean
  status: RoyalePlayerStatus
  eliminatedRound: number | null // ronda (1-based) en que cayó; null si sigue/gana
  pulls: RoyaleCard[] // sus propias tiradas (para mostrar)
}

export interface RoyaleRound {
  round: number // 1-based
  pulls: { playerId: number; card: RoyaleCard }[]
  eliminatedId: number
}

export interface RoyaleConfig {
  numPlayers: number // 2..10
  tier: PackTier
}

export interface RoyaleState {
  config: RoyaleConfig
  players: RoyalePlayer[]
  pot: RoyaleCard[] // TODAS las cartas tiradas (el ganador se lleva el bote entero)
  round: number // ronda actual, 1-based
  history: RoyaleRound[]
  phase: 'pulling' | 'finished'
  winnerId: number | null
}
