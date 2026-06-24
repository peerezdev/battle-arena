// Thin client for the backend /leaderboard + referral endpoints. Mirrors packBattleClient.ts.
import { config } from './config'

export interface LeaderboardRow {
  wallet: string
  alias: string | null
  gimmighouls: number
  elo: number
}

export interface UserView {
  wallet: string
  alias: string | null
  elo: number
  games_played: number
  gimmighouls: number
  referred_by: string | null
}

async function lbFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${config.backendUrl}${path}`, {
    ...options,
    headers: { ...(options?.headers as Record<string, string> | undefined), 'ngrok-skip-browser-warning': 'true' },
  })
  if (!resp.ok) {
    let detail: string | undefined
    try { detail = (await resp.json())?.detail } catch { /* ignore */ }
    throw new Error(detail || `Leaderboard error ${resp.status}`)
  }
  return resp.json() as Promise<T>
}

export function fetchLeaderboard(): Promise<LeaderboardRow[]> {
  return lbFetch<LeaderboardRow[]>('/leaderboard')
}

export function fetchUser(wallet: string): Promise<UserView> {
  return lbFetch<UserView>(`/users/${encodeURIComponent(wallet)}`)
}

/** Apply a referral code for the authed user. `token` is the Privy identity token. */
export function applyReferralCode(
  token: string,
  wallet: string,
  code: string,
): Promise<{ code: string; boost_pct: number }> {
  return lbFetch<{ code: string; boost_pct: number }>(
    `/users/${encodeURIComponent(wallet)}/referral`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code }),
    },
  )
}
