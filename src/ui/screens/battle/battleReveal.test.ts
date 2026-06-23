import { describe, it, expect } from 'vitest'
import { battleToReveal } from './battleReveal'
import type { Battle } from '../../../onchain/packBattleClient'

const base: Battle = {
  id: 'b1', mode: 'royale', machine_code: 'm', price: 50, max_players: 3,
  status: 'running', winner: null, creator_wallet: 'A',
  players: [
    { wallet: 'A', eliminated_round: null, accumulated_value: 120 },
    { wallet: 'B', eliminated_round: 1, accumulated_value: 40 },
  ],
  rounds: [{ round_number: 1, eliminated_wallet: 'B', tie_break_index: null }],
  server_seed_hash: 'h',
  pulls: [
    { round_number: 1, player_wallet: 'A', nft_address: 'nftA', rarity: 'Epic', insured_value: 120, auto_sold: false, grade: 10, year: '2018', name: 'Charizard' },
    { round_number: 1, player_wallet: 'B', nft_address: 'nftB', rarity: 'common', insured_value: 40, auto_sold: true, grade: 9, year: '1999', name: 'Pikachu' },
    { round_number: 2, player_wallet: 'A', nft_address: null, rarity: null, insured_value: null, auto_sold: false, grade: null, year: null, name: null },
  ],
}

describe('battleToReveal', () => {
  it('groups royale pulls by round and pulls elimination from rounds', () => {
    const vm = battleToReveal(base, 'A')
    expect(vm.rounds.map((r) => r.roundNumber)).toEqual([1, 2])
    expect(vm.rounds[0].eliminatedWallet).toBe('B')
    expect(vm.rounds[1].eliminatedWallet).toBeNull()           // round 2 not decided yet
    expect(vm.rounds[0].cards.map((c) => c.wallet)).toEqual(['A', 'B'])
    expect(vm.rounds[1].cards[0].nftAddress).toBeNull()        // pending
    expect(vm.players.find((p) => p.wallet === 'A')!.isMe).toBe(true)
    expect(vm.potValue).toBe(160)                              // 120 + 40, pending null ignored
    // per-player aggregation across rounds (bundle-aware)
    expect(vm.players.find((p) => p.wallet === 'A')!.cards).toHaveLength(2)  // round 1 + round 2 (pending)
    expect(vm.players.find((p) => p.wallet === 'A')!.total).toBe(120)        // null insured ignored
    expect(vm.players.find((p) => p.wallet === 'A')!.cards[0].year).toBe('2018')   // staged-reveal data
    expect(vm.players.find((p) => p.wallet === 'A')!.cards[0].grade).toBe(10)
  })

  it('groups pack pulls (round_number 1) into a single round', () => {
    const packBattle: Battle = {
      ...base, mode: 'pack', status: 'settled', winner: 'A', rounds: [],
      pulls: [
        { round_number: 1, player_wallet: 'A', nft_address: 'nftA', rarity: 'Rare', insured_value: 300, auto_sold: false, grade: 10, year: '2020', name: 'Blastoise' },
        { round_number: 1, player_wallet: 'B', nft_address: 'nftB', rarity: 'common', insured_value: 10, auto_sold: false, grade: 8, year: '2001', name: 'Rattata' },
      ],
    }
    const vm = battleToReveal(packBattle, 'B')
    expect(vm.rounds).toHaveLength(1)
    expect(vm.rounds[0].roundNumber).toBe(1)
    expect(vm.rounds[0].cards).toHaveLength(2)
    expect(vm.winner).toBe('A')
    expect(vm.players.find((p) => p.wallet === 'B')!.isMe).toBe(true)
    expect(vm.players.find((p) => p.wallet === 'A')!.total).toBe(300)
    expect(vm.players.find((p) => p.wallet === 'B')!.cards).toHaveLength(1)
  })

  it('handles a battle with no pulls yet', () => {
    const vm = battleToReveal({ ...base, pulls: [] }, null)
    expect(vm.rounds).toEqual([])
    expect(vm.potValue).toBe(0)
  })
})
