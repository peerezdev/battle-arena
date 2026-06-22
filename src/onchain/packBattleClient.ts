// Thin client for the backend /pack-battles/* endpoints. Mirrors gachaClient.ts.
import { config } from './config'

export type BattleMode = 'pack' | 'royale'
export type BattleStatus = 'lobby' | 'running' | 'settled' | 'voided' | 'cancelled'

export interface BattlePlayerState { wallet: string; eliminated_round: number | null; accumulated_value: number }
export interface BattleRoundInfo { round_number: number; eliminated_wallet: string; tie_break_index: number | null }
export interface BattlePullInfo {
  round_number: number; player_wallet: string; nft_address: string | null
  rarity: string | null; insured_value: number | null; auto_sold: boolean
}

export interface Battle {
  id: string; mode: BattleMode; machine_code: string; price: number; max_players: number
  status: BattleStatus; winner: string | null; creator_wallet: string | null
  players: BattlePlayerState[]; rounds: BattleRoundInfo[]; server_seed_hash: string | null
  server_seed?: string | null; client_seed?: string | null; tie_break_index?: number | null
  pulls?: BattlePullInfo[]
  buyin?: number; escrow_address?: string
}

export interface OpenBattle { id: string; machine_code: string; price: number; max_players: number; players: number }

export interface VerifyRound { round_number: number; client_seed: string; eliminated_wallet: string; tie_break_index: number | null }
export interface Verification {
  mode: BattleMode; server_seed_hash: string | null; server_seed: string | null; commit_ok: boolean | null
  client_seed?: string | null; tie_break_index?: number | null
  rounds?: VerifyRound[]
}

async function battleFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${config.backendUrl}${path}`, {
    ...options,
    headers: { ...(options?.headers as Record<string, string> | undefined), 'ngrok-skip-browser-warning': 'true' },
  })
  if (!resp.ok) {
    let detail: string | undefined
    try { detail = (await resp.json())?.detail } catch { /* ignore */ }
    throw new Error(detail || `Battle error ${resp.status}`)
  }
  return resp.json() as Promise<T>
}

function authHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

export function createBattle(
  token: string,
  body: { machine_code: string; max_players: number; mode?: BattleMode },
): Promise<Battle> {
  return battleFetch<Battle>('/pack-battles', {
    method: 'POST', headers: authHeaders(token), body: JSON.stringify(body),
  })
}

export function joinBattle(token: string, id: string): Promise<Battle> {
  return battleFetch<Battle>(`/pack-battles/${encodeURIComponent(id)}/join`, {
    method: 'POST', headers: authHeaders(token),
  })
}

export function cancelBattle(token: string, id: string): Promise<Battle> {
  return battleFetch<Battle>(`/pack-battles/${encodeURIComponent(id)}/cancel`, {
    method: 'POST', headers: authHeaders(token),
  })
}

export function listOpenBattles(): Promise<OpenBattle[]> {
  return battleFetch<OpenBattle[]>('/pack-battles/open')
}

export function getBattle(id: string): Promise<Battle> {
  return battleFetch<Battle>(`/pack-battles/${encodeURIComponent(id)}`)
}

export function verifyBattle(id: string): Promise<Verification> {
  return battleFetch<Verification>(`/pack-battles/${encodeURIComponent(id)}/verify`)
}
