import type { Battle, BattleMode, BattleStatus, BattlePullInfo } from '../../../onchain/packBattleClient'

export interface RevealCardVM {
  wallet: string; isMe: boolean; nftAddress: string | null
  rarity: string | null; insuredValue: number | null; autoSold: boolean
  grade: number | null; year: string | null; name: string | null
}
export interface RevealRoundVM {
  roundNumber: number; eliminatedWallet: string | null; cards: RevealCardVM[]
}
export interface RevealPlayerVM {
  wallet: string; isMe: boolean; accumulatedValue: number; eliminatedRound: number | null
  cards: RevealCardVM[]   // all of this player's pulls across rounds (bundle-aware)
  total: number           // sum of insuredValue across this player's cards
}
export interface RevealVM {
  mode: BattleMode; status: BattleStatus; winner: string | null; meWallet: string | null
  players: RevealPlayerVM[]; rounds: RevealRoundVM[]; potValue: number
  machines: string[]   // machine_code per round (ordered); drives the per-round machine thumbnail
  buybackTotal: number // total auto-sell payout across the battle, in dollars
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
        grade: p.grade,
        year: p.year,
        name: p.name,
      })),
    }))

  // Group every pull by player (across all rounds) for the per-player VS view (bundle-aware).
  const cardsByPlayer = new Map<string, RevealCardVM[]>()
  for (const p of pulls) {
    const arr = cardsByPlayer.get(p.player_wallet) ?? []
    arr.push({
      wallet: p.player_wallet,
      isMe: p.player_wallet === meWallet,
      nftAddress: p.nft_address,
      rarity: p.rarity,
      insuredValue: p.insured_value,
      autoSold: p.auto_sold,
      grade: p.grade,
      year: p.year,
      name: p.name,
    })
    cardsByPlayer.set(p.player_wallet, arr)
  }

  const players: RevealPlayerVM[] = battle.players.map((p) => {
    const cards = cardsByPlayer.get(p.wallet) ?? []
    return {
      wallet: p.wallet,
      isMe: p.wallet === meWallet,
      accumulatedValue: p.accumulated_value,
      eliminatedRound: p.eliminated_round,
      cards,
      total: cards.reduce((s, c) => s + (c.insuredValue ?? 0), 0),
    }
  })

  const potValue = pulls.reduce((s, p) => s + (p.insured_value ?? 0), 0)
  // buyback_amount is in USDC base units (×1e6); insured_value is already in dollars.
  const buybackTotal = pulls.reduce((s, p) => s + (p.buyback_amount ?? 0), 0) / 1e6

  // machine_code per round (ordered by sequence); legacy battles → a single-box bundle.
  const machines: string[] = (battle.packs && battle.packs.length)
    ? [...battle.packs].sort((a, b) => a.sequence - b.sequence).map((p) => p.machine_code)
    : [battle.machine_code]

  return { mode: battle.mode, status: battle.status, winner: battle.winner, meWallet, players, rounds, potValue, machines, buybackTotal }
}
