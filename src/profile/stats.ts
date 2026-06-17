export interface HistoryRow {
  result: string
}

export function countResults(rows: HistoryRow[]): { wins: number; losses: number; draws: number } {
  let wins = 0,
    losses = 0,
    draws = 0
  for (const r of rows) {
    if (r.result === 'win') wins++
    else if (r.result === 'loss') losses++
    else if (r.result === 'draw') draws++
  }
  return { wins, losses, draws }
}
