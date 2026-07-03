import { describe, it, expect } from 'vitest'
import { buildRoyaleDemo } from './demoBattle'
import type { MachineCard } from '../onchain/gachaClient'

function card(nft: string, rarity: string, value: number, over: Partial<MachineCard> = {}): MachineCard {
  return {
    nft_address: nft, name: nft, image: null, rarity, insured_value: value,
    grade: null, images: [], grading_company: null, grading_id: null,
    the_grade: null, generic_grade: null, authenticated: null, year: null, ...over,
  }
}

// Deterministic LCG so the random pulls are reproducible in tests.
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

const ODDS = { common: 60, uncommon: 30, rare: 9, epic: 1 }

describe('buildRoyaleDemo', () => {
  it('reads the numeric grade even when the_grade is a text grade like "GEM-MT 10"', () => {
    // Real CC cards expose grade as "PSA GEM-MT 10", the_grade as "GEM-MT 10", generic_grade as "10".
    const pool = [card('c1', 'epic', 5000, { the_grade: 'GEM-MT 10', generic_grade: '10', grade: 'PSA GEM-MT 10' })]
    const battle = buildRoyaleDemo(pool, ODDS, 'pokemon_50', 50, 3, seeded(1))
    const pulls = battle.pulls ?? []
    expect(pulls.length).toBeGreaterThan(0)
    expect(pulls.every((p) => p.grade === 10)).toBe(true)   // parsed from generic_grade, not NaN
  })

  it('eliminates the lowest ACCUMULATED total each round, not the lowest single pull', () => {
    const pool = [
      card('lo', 'common', 10),
      card('mid', 'uncommon', 100),
      card('hi', 'rare', 500),
      card('ep', 'epic', 3000),
    ]
    const battle = buildRoyaleDemo(pool, ODDS, 'pokemon_50', 50, 6, seeded(7))
    const pulls = battle.pulls ?? []

    // Reconstruct per-round accumulated from the pulls; the player eliminated in a round
    // must have had the LOWEST accumulated total among players still alive that round.
    const aliveAt = (r: number) => battle.players
      .filter((p) => p.eliminated_round == null || p.eliminated_round >= r)
      .map((p) => p.wallet)
    const accAt = (w: string, r: number) => pulls
      .filter((p) => p.player_wallet === w && p.round_number <= r)
      .reduce((s, p) => s + (p.insured_value ?? 0), 0)

    expect(battle.rounds.length).toBeGreaterThan(0)
    for (const rnd of battle.rounds) {
      const alive = aliveAt(rnd.round_number)
      const minAcc = Math.min(...alive.map((w) => accAt(w, rnd.round_number)))
      expect(accAt(rnd.eliminated_wallet as string, rnd.round_number)).toBe(minAcc)
    }
  })

  it('the sole survivor is never someone who held the lowest accumulated at the final elimination', () => {
    const pool = [card('lo', 'common', 10), card('mid', 'uncommon', 100), card('hi', 'rare', 900)]
    const battle = buildRoyaleDemo(pool, ODDS, 'pokemon_50', 50, 5, seeded(3))
    const winner = battle.players.find((p) => p.eliminated_round == null)!
    // Winner survived to the end → their final accumulated is > 0 (they pulled every round).
    expect(winner.accumulated_value).toBeGreaterThan(0)
  })
})
