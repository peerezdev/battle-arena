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
