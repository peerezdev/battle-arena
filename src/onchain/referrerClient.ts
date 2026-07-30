// Cliente del panel de referidor (rev-share del rake). Mismo patrón que leaderboardClient.
import { config } from './config'

export interface ReferrerCode {
  code: string
  rake_share_pct: number
  referred_count: number
}

export interface ReferrerSummary {
  codes: ReferrerCode[]
  unclaimed_base_units: number
  lifetime_base_units: number
  claim_min_base_units: number
}

async function refFetch<T>(path: string, token: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${config.backendUrl}${path}`, {
    ...options,
    headers: {
      ...(options?.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${token}`,
      'ngrok-skip-browser-warning': 'true',
    },
  })
  if (!resp.ok) {
    let detail: string | undefined
    try { detail = (await resp.json())?.detail } catch { /* ignore */ }
    throw new Error(detail || `Referrer error ${resp.status}`)
  }
  return resp.json() as Promise<T>
}

export function fetchReferrerSummary(token: string): Promise<ReferrerSummary> {
  return refFetch<ReferrerSummary>('/users/me/referrer', token)
}

export function claimReferrerEarnings(
  token: string,
): Promise<{ signature: string; amount_base_units: number }> {
  return refFetch('/users/me/referrer/claim', token, { method: 'POST' })
}
