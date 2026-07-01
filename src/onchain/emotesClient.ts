import { config } from './config'

export interface Emote {
  code: string
  name: string
  video_url: string
}

export interface MyEmotes {
  owned: string[]   // emote codes the user owns
  slots: string[]   // up to 3 quick-access codes (ordered)
}

async function emoteFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${config.backendUrl}${path}`, {
    ...options,
    headers: { ...(options?.headers as Record<string, string> | undefined), 'ngrok-skip-browser-warning': 'true' },
  })
  if (!resp.ok) throw new Error(`emotes ${resp.status}`)
  return resp.json() as Promise<T>
}

function authHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

export function fetchEmoteCatalog(): Promise<Emote[]> {
  return emoteFetch<Emote[]>('/emotes/catalog')
}

export function fetchMyEmotes(token: string): Promise<MyEmotes> {
  return emoteFetch<MyEmotes>('/users/me/emotes', { headers: authHeaders(token) })
}

/** Set the up-to-3 quick-access slots. Returns the updated {owned, slots}. */
export function setEmoteSlots(token: string, slots: string[]): Promise<MyEmotes> {
  return emoteFetch<MyEmotes>('/users/me/emotes/slots', {
    method: 'PUT', headers: authHeaders(token), body: JSON.stringify({ slots }),
  })
}

/** Broadcast an emote to everyone in a battle (server validates ownership + participation). */
export function throwEmoteToBattle(token: string, battleId: string, code: string): Promise<{ ok: boolean }> {
  return emoteFetch(`/pack-battles/${encodeURIComponent(battleId)}/emote`, {
    method: 'POST', headers: authHeaders(token), body: JSON.stringify({ code }),
  })
}
