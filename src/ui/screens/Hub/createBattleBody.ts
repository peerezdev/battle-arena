import type { BattleMode } from '../../../onchain/packBattleClient'
import type { GachaMachine } from '../../../onchain/gachaClient'

export function buildCreateBody(
  mode: BattleMode, machineCode: string, players: number,
): { machine_code: string; max_players: number; mode: BattleMode } {
  return { machine_code: machineCode, mode, max_players: players }
}

export function bundleToPacks(counts: Record<string, number>): { machine_code: string; count: number }[] {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([machine_code, count]) => ({ machine_code, count }))
}

export function totalBoxes(counts: Record<string, number>): number {
  return Object.values(counts).reduce((s, n) => s + n, 0)
}

export function bundleCostUsd(counts: Record<string, number>, machines: GachaMachine[]): number {
  const price = new Map(machines.map((m) => [m.code, m.price]))
  return Object.entries(counts).reduce((s, [code, n]) => s + (price.get(code) ?? 0) * n, 0)
}

/**
 * Total packs opened across a whole royale: every surviving player opens one pack per round and one
 * player is eliminated each round → n + (n-1) + … + 2 = n(n+1)/2 − 1. Mirrors the backend total_pulls.
 */
export function royaleTotalPulls(n: number): number {
  if (n < 2) return 0
  return (n * (n + 1)) / 2 - 1
}

/**
 * Royale entry per player (USD): the pool must cover every pack opened, split evenly across players.
 * Mirrors the backend royale_buyin = ceil(total_pulls(n) * price / n).
 */
export function royaleEntryUsd(players: number, machinePriceUsd: number): number {
  if (players <= 0) return 0
  return (royaleTotalPulls(players) * machinePriceUsd) / players
}
