export type Player = 'a' | 'b'
export type GradeCompany = 'PSA' | 'CGC' | 'BGS'
export type FrontKey = 'apertura' | 'choque' | 'remate'
export type FrontWinner = Player | 'disputed'
export type MatchPhase = 'committing' | 'revealing' | 'roundResolved' | 'settled'
export type Mode = 'ranked' | 'challenge'

export interface Card {
  id: string
  name: string
  valueUsd: number
  gradeCompany: GradeCompany
  grade: number // ej. 9 para PSA9
}

export interface MatchConfig {
  roundsToWin: number      // 2
  baseEnergyPerRound: number // 10
  K: number                // 0.5
  maxEdge: number          // 4
  valueRatioCap: number    // 4
  edgeEnabled: boolean
  mode: Mode
}

export interface Allocation {
  apertura: number
  choque: number
  remate: number
}

export interface RoundRecord {
  commitA?: string
  commitB?: string
  revealA?: Allocation
  revealB?: Allocation
  saltA?: string
  saltB?: string
  frontWinners?: Record<FrontKey, FrontWinner>
  roundWinner?: FrontWinner // 'a' | 'b' | 'disputed' (disputed = ronda nula a rejugar)
}

export interface MatchState {
  cardA: Card
  cardB: Card
  config: MatchConfig
  phase: MatchPhase
  round: number            // índice de ronda actual (0-based)
  bankedEnergy: Record<Player, number> // oculto al rival en UI
  edgePerRound: Record<Player, number> // bonus fijo calculado al crear
  roundWins: Record<Player, number>
  rounds: RoundRecord[]
  winner: Player | null
}

export const DEFAULT_CONFIG: MatchConfig = {
  roundsToWin: 2,
  baseEnergyPerRound: 10,
  K: 0.5,
  maxEdge: 4,
  valueRatioCap: 4,
  edgeEnabled: true,
  mode: 'ranked',
}
