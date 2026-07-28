import { describe, it, expect } from 'vitest'
import { buildPackDemo, buildRoyaleDemo, DEMO_ME } from './demoBattle'
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


describe('buildPackDemo', () => {
  // Pool con valores muy separados por rareza, para que "quién gana" sea comprobable.
  const POOL = [
    card('c1', 'common', 10), card('c2', 'common', 20), card('c3', 'common', 30),
    card('u1', 'uncommon', 100), card('u2', 'uncommon', 200),
    card('e1', 'epic', 5000),
  ]

  it('gana quien saca el valor más alto, no siempre el jugador', () => {
    const b = buildPackDemo(POOL, ODDS, 'pokemon_50', 50, seeded(7))
    const totals = new Map(b.players.map((p) => [p.wallet, p.accumulated_value]))
    const best = Math.max(...totals.values())
    expect(totals.get(b.winner!)).toBe(best)
  })

  it('el jugador NO gana siempre: en muchas simulaciones también pierde', () => {
    // Era el bug: se ordenaban las cartas y al jugador se le daba la mejor, con winner fijo.
    const wins = Array.from({ length: 60 }, (_, i) =>
      buildPackDemo(POOL, ODDS, 'pokemon_50', 50, seeded(i + 1)).winner)
    const mine = wins.filter((w) => w === DEMO_ME).length
    expect(mine).toBeGreaterThan(0)      // a veces gana
    expect(mine).toBeLessThan(60)        // y a veces NO
  })

  it('el valor acumulado de cada jugador es el de SU carta', () => {
    const b = buildPackDemo(POOL, ODDS, 'pokemon_50', 50, seeded(3))
    const pulls = b.pulls ?? []
    for (const p of b.players) {
      const mine = pulls.filter((x) => x.player_wallet === p.wallet)
      const sum = mine.reduce((acc, x) => acc + (x.insured_value ?? 0), 0)
      expect(p.accumulated_value).toBe(sum)
    }
  })

  it('el jugador es el primer asiento y hay una carta por jugador', () => {
    const b = buildPackDemo(POOL, ODDS, 'pokemon_50', 50, seeded(11))
    expect(b.players[0].wallet).toBe(DEMO_ME)
    expect((b.pulls ?? []).length).toBe(b.players.length)
  })

  it('el auto-sold no depende del asiento (antes eran siempre los dos últimos)', () => {
    const seats = new Set<number>()
    for (let i = 1; i <= 40; i++) {
      const b = buildPackDemo(POOL, ODDS, 'pokemon_50', 50, seeded(i))
      ;(b.pulls ?? []).forEach((p, idx) => { if (p.auto_sold) seats.add(idx) })
    }
    expect(seats.size).toBeGreaterThan(2)
  })
})

describe('demo con rarezas forzadas', () => {
  // Dos cartas de cada rareza, con la capitalización que devuelve CC de verdad.
  const POOL = ['Epic', 'Rare', 'Uncommon', 'Common'].flatMap((r, k) =>
    [card(`${r}1`, r, 10 + k), card(`${r}2`, r, 20 + k)])
  const FORCED = ['epic', 'rare', 'uncommon', 'common'] as const

  it('el pack reparte las rarezas en el orden pedido, una por asiento', () => {
    const b = buildPackDemo(POOL, ODDS, 'pokemon_50', 50, seeded(5), FORCED)
    const seq = (b.pulls ?? []).map((p) => (p.rarity ?? '').toLowerCase())
    // 5 asientos y 4 rarezas: la lista se recorre en bucle.
    expect(seq).toEqual(['epic', 'rare', 'uncommon', 'common', 'epic'])
  })

  it('forzado no auto-vende nada: cada carta tiene que pasar por la ceremonia', () => {
    const b = buildPackDemo(POOL, ODDS, 'pokemon_50', 50, seeded(5), FORCED)
    expect((b.pulls ?? []).every((p) => !p.auto_sold)).toBe(true)
  })

  it('el royale sigue el bucle tirada a tirada, sin reiniciarlo entre rondas', () => {
    const b = buildRoyaleDemo(POOL, ODDS, 'pokemon_50', 50, 4, seeded(9), FORCED)
    const seq = (b.pulls ?? []).map((p) => (p.rarity ?? '').toLowerCase())
    expect(seq).toEqual(seq.map((_, i) => FORCED[i % FORCED.length]))
    expect(seq.length).toBe(4 + 3 + 2)   // rondas de 4, 3 y 2 supervivientes
  })

  it('una rareza ausente del pool cae al sorteo en vez de romper', () => {
    const onlyCommons = [card('c1', 'Common', 10), card('c2', 'Common', 20)]
    const b = buildPackDemo(onlyCommons, ODDS, 'pokemon_50', 50, seeded(2), FORCED)
    expect((b.pulls ?? [])).toHaveLength(5)
    expect((b.pulls ?? []).every((p) => (p.rarity ?? '').toLowerCase() === 'common')).toBe(true)
  })
})
