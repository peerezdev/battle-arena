import type { Player, Mode } from '../engine'

export interface PlaytestRecord {
  ts: number
  winner: Player | null
  rounds: number
  edgeEnabled: boolean
  valueRatio: number
  mode: Mode
  difficulty: string
  funRating: number   // 1-5
  comment: string
}

const KEY = 'battlearena.playtest.v1'

export function getRecords(): PlaytestRecord[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]')
  } catch {
    return []
  }
}

export function recordMatch(record: PlaytestRecord): void {
  const all = getRecords()
  all.push(record)
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // cuota excedida u otro fallo de storage: no romper la partida
  }
}

export function clearRecords(): void {
  localStorage.removeItem(KEY)
}

export function exportJson(): string {
  return JSON.stringify(getRecords(), null, 2)
}
