import { describe, it, expect } from 'vitest'
import {
  createMatch, commit, reveal, resolveRound, resolveBattle, nextRound,
  hashAllocation, DEFAULT_CONFIG, type Card, type Allocation, type MatchState,
} from './index'

const cara: Card = { id: 'cara', name: 'Cara', valueUsd: 1200, gradeCompany: 'PSA', grade: 8 }
const barata: Card = { id: 'barata', name: 'Barata', valueUsd: 950, gradeCompany: 'PSA', grade: 7 }

async function playRound(s: MatchState, aA: Allocation, aB: Allocation): Promise<MatchState> {
  const hA = await hashAllocation(aA, 'sA' + s.round)
  const hB = await hashAllocation(aB, 'sB' + s.round)
  s = commit(s, 'a', hA); s = commit(s, 'b', hB)
  s = await reveal(s, 'a', aA, 'sA' + s.round)
  s = await reveal(s, 'b', aB, 'sB' + s.round)
  s = resolveRound(s)
  s = resolveBattle(s)
  return s
}

describe('integración: batalla ejemplo del SPEC §2.6', () => {
  it('ratio 1200/950 < cap, edge ~0', () => {
    const s = createMatch(cara, barata, { ...DEFAULT_CONFIG })
    expect(s.edgePerRound).toEqual({ a: 0, b: 0 }) // log2(1.26)*0.5 -> round 0
  })

  it('la barata gana la batalla por economía a lo largo de 3 rondas', async () => {
    let s = createMatch(cara, barata, { ...DEFAULT_CONFIG })
    // R1: cara 3/4/3 (gasta 10); barata 4/0/3 (gasta 7, banca 3).
    // Apertura: B(4) > A(3) → barata. Choque: A(4) > B(0) → cara.
    // Remate: tie(3-3), Solidez PSA8(80) > PSA7(70) → cara (Aguante).
    // Ronda: cara gana 2 frentes → cara wins R1 (1-0).
    // Banking: cara 0, barata 3.
    s = await playRound(s, { apertura: 3, choque: 4, remate: 3 }, { apertura: 4, choque: 0, remate: 3 })
    expect(s.roundWins).toEqual({ a: 1, b: 0 })
    expect(s.bankedEnergy.b).toBe(3)
    s = nextRound(s)
    // R2: cara disponible 10, barata disponible 13 (10+3).
    // cara 4/3/3 (gasta 10); barata 5/0/5 (gasta 10, banca 3).
    // Apertura: B(5) > A(4) → barata. Choque: A(3) > B(0) → cara.
    // Remate: B(5) > A(3) → barata. Ronda: barata wins R2 (1-1).
    s = await playRound(s, { apertura: 4, choque: 3, remate: 3 }, { apertura: 5, choque: 0, remate: 5 })
    expect(s.roundWins).toEqual({ a: 1, b: 1 })
    s = nextRound(s)
    // R3: cara disponible 10, barata disponible 13 (10+3).
    // cara 1/4/5 (gasta 10); barata 5/5/3 (gasta 13).
    // Apertura: B(5) > A(1) → barata. Choque: B(5) > A(4) → barata.
    // Remate: A(5) > B(3) → cara. Ronda: barata wins 2-1 → barata wins battle.
    s = await playRound(s, { apertura: 1, choque: 4, remate: 5 }, { apertura: 5, choque: 5, remate: 3 })
    expect(s.winner).toBe('b')
  })
})
