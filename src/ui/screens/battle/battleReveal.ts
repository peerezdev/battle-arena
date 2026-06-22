import type { Battle, BattleMode, BattleStatus, BattlePullInfo } from '../../../onchain/packBattleClient'

export interface RevealCardVM {
  wallet: string; isMe: boolean; nftAddress: string | null
  rarity: string | null; insuredValue: number | null; autoSold: boolean
}
export interface RevealRoundVM {
  roundNumber: number; eliminatedWallet: string | null; cards: RevealCardVM[]
}
export interface RevealPlayerVM {
  wallet: string; isMe: boolean; accumulatedValue: number; eliminatedRound: number | null
}
export interface RevealVM {
  mode: BattleMode; status: BattleStatus; winner: string | null; meWallet: string | null
  players: RevealPlayerVM[]; rounds: RevealRoundVM[]; potValue: number
}

export function battleToReveal(battle: Battle, meWallet: string | null): RevealVM {
  const pulls: BattlePullInfo[] = battle.pulls ?? []

  // group pulls by round_number (ascending)
  const byRound = new Map<number, BattlePullInfo[]>()
  for (const p of pulls) {
    const arr = byRound.get(p.round_number) ?? []
    arr.push(p)
    byRound.set(p.round_number, arr)
  }
  const elimByRound = new Map<number, string>()
  for (const r of battle.rounds) elimByRound.set(r.round_number, r.eliminated_wallet)

  const rounds: RevealRoundVM[] = [...byRound.keys()]
    .sort((a, b) => a - b)
    .map((rn) => ({
      roundNumber: rn,
      eliminatedWallet: elimByRound.get(rn) ?? null,
      cards: byRound.get(rn)!.map((p) => ({
        wallet: p.player_wallet,
        isMe: p.player_wallet === meWallet,
        nftAddress: p.nft_address,
        rarity: p.rarity,
        insuredValue: p.insured_value,
        autoSold: p.auto_sold,
      })),
    }))

  const players: RevealPlayerVM[] = battle.players.map((p) => ({
    wallet: p.wallet,
    isMe: p.wallet === meWallet,
    accumulatedValue: p.accumulated_value,
    eliminatedRound: p.eliminated_round,
  }))

  const potValue = pulls.reduce((s, p) => s + (p.insured_value ?? 0), 0)

  return { mode: battle.mode, status: battle.status, winner: battle.winner, meWallet, players, rounds, potValue }
}
