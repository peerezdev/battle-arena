import { config } from './config'

// ── Types ──────────────────────────────────────────────────────────────────

export interface OpenMatch {
  battle_pubkey: string
  player_a: string
  stake: number
  elo_a: number
  elo_diff?: number
  gap_label?: string
  joinable: boolean
  min_elo: number | null
  max_elo: number | null
}

export interface RegisterMatchBody {
  battle_pubkey: string
  min_elo: number | null
  max_elo: number | null
}

export interface RegisterMatchResponse {
  battle_pubkey: string
  status: string
}

export interface SyncMatchResponse {
  status: string
}

export interface EloCompareResponse {
  elo_a: number
  elo_b: number
  diff: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function apiFetch<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const resp = await fetch(url, {
    ...options,
    headers: { ...(options?.headers as Record<string, string> | undefined), 'ngrok-skip-browser-warning': 'true' },
  })
  if (!resp.ok) throw new Error(`Backend error ${resp.status}: ${url}`)
  return resp.json() as Promise<T>
}

function authHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

// ── Open matches ─────────────────────────────────────────────────────────────

/** Lista las partidas abiertas, filtradas por viewer para calcular ELO diff. */
export async function getOpenMatches(viewer: string): Promise<OpenMatch[]> {
  const url = `${config.backendUrl}/matches/open?viewer=${encodeURIComponent(viewer)}`
  return apiFetch<OpenMatch[]>(url)
}

/** Registra una partida recién creada on-chain en el backend. */
export async function registerMatch(token: string, body: RegisterMatchBody): Promise<RegisterMatchResponse> {
  return apiFetch<RegisterMatchResponse>(`${config.backendUrl}/matches`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  })
}

/** Sincroniza el estado on-chain de una batalla con el backend. */
export async function syncMatch(battle: string, token?: string): Promise<SyncMatchResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return apiFetch<SyncMatchResponse>(`${config.backendUrl}/matches/${encodeURIComponent(battle)}/sync`, {
    method: 'POST',
    headers,
  })
}

// ── ELO ──────────────────────────────────────────────────────────────────────

/** Compara los ELO de dos jugadores. */
export async function compareElo(addrA: string, addrB: string): Promise<EloCompareResponse> {
  const url = `${config.backendUrl}/elo/compare?a=${encodeURIComponent(addrA)}&b=${encodeURIComponent(addrB)}`
  return apiFetch<EloCompareResponse>(url)
}

