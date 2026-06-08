import { PublicKey } from '@solana/web3.js'
import { config } from './config'

export const PROGRAM_ID = new PublicKey(config.programId)
// Programa nativo Ed25519
export const ED25519_PROGRAM_ID = new PublicKey('Ed25519SigVerify111111111111111111111111111')

export type Phase = 'Created' | 'Committing' | 'Revealing' | 'RoundResolved' | 'Settled' | 'Closed'

export interface Allocation { apertura: number; choque: number; remate: number }
export interface MatchConfig {
  roundsToWin: number; baseEnergy: number; maxEdge: number; valueRatioCap: number
  maxRounds: number; rakeBps: number; edgeEnabled: boolean
}
export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  roundsToWin: 2, baseEnergy: 10, maxEdge: 4, valueRatioCap: 4, maxRounds: 5, rakeBps: 0, edgeEnabled: true,
}
