import type { BattleMode } from '../../../onchain/packBattleClient'

export function buildCreateBody(
  mode: BattleMode, machineCode: string, royalePlayers: number,
): { machine_code: string; max_players: number; mode: BattleMode } {
  return { machine_code: machineCode, mode, max_players: mode === 'pack' ? 2 : royalePlayers }
}
