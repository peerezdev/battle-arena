import { describe, it, expect } from 'vitest'
import { createMatch, availableEnergy, commit, reveal, resolveRound, resolveBattle, nextRound } from './match'
import { DEFAULT_CONFIG, type Card, type Allocation } from './types'
import { hashAllocation } from './hash'
import { solidez } from './solidez'

const card = (id: string, valueUsd: number, grade: number): Card => ({
  id, name: id, valueUsd, gradeCompany: 'PSA', grade,
})
const cfg = (over = {}) => ({ ...DEFAULT_CONFIG, ...over })

describe('createMatch', () => {
  it('inicializa fase committing, ronda 0, sin wins', () => {
    const s = createMatch(card('A', 1000, 9), card('B', 1000, 8), cfg())
    expect(s.phase).toBe('committing')
    expect(s.round).toBe(0)
    expect(s.roundWins).toEqual({ a: 0, b: 0 })
    expect(s.winner).toBeNull()
  })

  it('asigna edge al de mayor valor', () => {
    const s = createMatch(card('A', 2000, 9), card('B', 1000, 8), cfg())
    expect(s.edgePerRound).toEqual({ a: 1, b: 0 })
  })

  it('rechaza ratio > cap en ranked', () => {
    expect(() => createMatch(card('A', 5000, 9), card('B', 1000, 8), cfg({ mode: 'ranked' })))
      .toThrow(/ratio/i)
  })

  it('permite ratio alto en challenge', () => {
    const s = createMatch(card('A', 5000, 9), card('B', 1000, 8), cfg({ mode: 'challenge' }))
    expect(s.phase).toBe('committing')
  })

  it('availableEnergy ronda 0 = base + edge', () => {
    const s = createMatch(card('A', 2000, 9), card('B', 1000, 8), cfg())
    expect(availableEnergy(s, 'a')).toBe(11) // 10 + 1 edge
    expect(availableEnergy(s, 'b')).toBe(10)
  })
})

describe('commit + reveal', () => {
  it('avanza a revealing cuando ambos commitean', async () => {
    let s = createMatch(card('A', 1000, 9), card('B', 1000, 8), cfg())
    s = commit(s, 'a', 'hashA')
    expect(s.phase).toBe('committing')
    s = commit(s, 'b', 'hashB')
    expect(s.phase).toBe('revealing')
  })

  it('reveal válido guarda la asignación', async () => {
    let s = createMatch(card('A', 1000, 9), card('B', 1000, 8), cfg())
    const allocA = { apertura: 4, choque: 3, remate: 3 }
    const allocB = { apertura: 3, choque: 4, remate: 3 }
    const hA = await hashAllocation(allocA, 'sA')
    const hB = await hashAllocation(allocB, 'sB')
    s = commit(s, 'a', hA)
    s = commit(s, 'b', hB)
    s = await reveal(s, 'a', allocA, 'sA')
    s = await reveal(s, 'b', allocB, 'sB')
    expect(s.rounds[0].revealA).toEqual(allocA)
    expect(s.rounds[0].revealB).toEqual(allocB)
  })

  it('rechaza reveal cuyo hash no casa', async () => {
    let s = createMatch(card('A', 1000, 9), card('B', 1000, 8), cfg())
    const allocA = { apertura: 4, choque: 3, remate: 3 }
    const hA = await hashAllocation(allocA, 'sA')
    s = commit(s, 'a', hA)
    s = commit(s, 'b', 'hB')
    await expect(reveal(s, 'a', { apertura: 5, choque: 3, remate: 2 }, 'sA'))
      .rejects.toThrow(/hash/i)
  })

  it('rechaza asignación que excede el disponible', async () => {
    let s = createMatch(card('A', 1000, 9), card('B', 1000, 8), cfg())
    const allocA = { apertura: 5, choque: 5, remate: 5 } // 15 > 10
    const hA = await hashAllocation(allocA, 'sA')
    s = commit(s, 'a', hA)
    s = commit(s, 'b', 'hB')
    await expect(reveal(s, 'a', allocA, 'sA')).rejects.toThrow(/disponible/i)
  })

  it('rechaza asignación con valores negativos', async () => {
    let s = createMatch(card('A', 1000, 9), card('B', 1000, 8), cfg())
    const allocA = { apertura: -1, choque: 5, remate: 2 }
    const hA = await hashAllocation(allocA, 'sA')
    s = commit(s, 'a', hA)
    s = commit(s, 'b', 'hB')
    await expect(reveal(s, 'a', allocA, 'sA')).rejects.toThrow(/negativ|inválid/i)
  })
})

// helper: monta un estado en fase revealing con asignaciones ya puestas
async function staged(
  ca: Card, cb: Card, allocA: Allocation, allocB: Allocation, over = {},
) {
  let s = createMatch(ca, cb, cfg(over))
  const hA = await hashAllocation(allocA, 'sA')
  const hB = await hashAllocation(allocB, 'sB')
  s = commit(s, 'a', hA); s = commit(s, 'b', hB)
  s = await reveal(s, 'a', allocA, 'sA')
  s = await reveal(s, 'b', allocB, 'sB')
  return s
}

describe('resolveRound', () => {
  it('gana el frente quien pone estrictamente más', async () => {
    let s = await staged(
      card('A', 1000, 9), card('B', 1000, 9),
      { apertura: 5, choque: 2, remate: 3 },
      { apertura: 3, choque: 4, remate: 3 }, // remate empate
    )
    s = resolveRound(s)
    expect(s.rounds[0].frontWinners!.apertura).toBe('a')
    expect(s.rounds[0].frontWinners!.choque).toBe('b')
  })

  it('empate de frente con Solidez mayor -> Aguante', async () => {
    let s = await staged(
      card('A', 1000, 9), card('B', 1000, 7), // A más Solidez
      { apertura: 3, choque: 3, remate: 4 },
      { apertura: 3, choque: 5, remate: 2 }, // apertura empate (3-3)
    )
    s = resolveRound(s)
    expect(s.rounds[0].frontWinners!.apertura).toBe('a') // Aguante a A
  })

  it('empate de frente con Solidez igual -> disputed', async () => {
    let s = await staged(
      card('A', 1000, 9), card('B', 1000, 9),
      { apertura: 3, choque: 3, remate: 4 },
      { apertura: 3, choque: 5, remate: 2 }, // apertura empate
    )
    s = resolveRound(s)
    expect(s.rounds[0].frontWinners!.apertura).toBe('disputed')
  })

  it('gana ronda quien gana más frentes y suma roundWin', async () => {
    let s = await staged(
      card('A', 1000, 9), card('B', 1000, 9),
      { apertura: 5, choque: 5, remate: 0 }, // gana 2 frentes
      { apertura: 3, choque: 3, remate: 4 },
    )
    s = resolveRound(s)
    expect(s.rounds[0].roundWinner).toBe('a')
    expect(s.roundWins.a).toBe(1)
  })

  it('banca el sobrante para la siguiente ronda', async () => {
    let s = await staged(
      card('A', 1000, 9), card('B', 1000, 9),
      { apertura: 3, choque: 2, remate: 2 }, // gasta 7, banca 3
      { apertura: 4, choque: 4, remate: 2 }, // gasta 10
    )
    s = resolveRound(s)
    expect(s.bankedEnergy.a).toBe(3)
    expect(s.bankedEnergy.b).toBe(0)
  })

  it('desempate de ronda por energía total comprometida', async () => {
    // 1 frente cada uno + 1 disputed -> empate de frentes -> gana quien comprometió más
    let s = await staged(
      card('A', 1000, 9), card('B', 1000, 9),
      { apertura: 6, choque: 1, remate: 1 }, // gana apertura, total 8
      { apertura: 1, choque: 6, remate: 1 }, // gana choque, remate disputed, total 8
    )
    // empata energía 8-8 y frentes 1-1 -> remate 1-1 disputed; desempate energía empata -> Solidez igual -> ronda nula
    s = resolveRound(s)
    expect(s.rounds[0].roundWinner).toBe('disputed')
  })
})

describe('resolveBattle + nextRound', () => {
  it('declara ganador al llegar a roundsToWin', async () => {
    let s = await staged(
      card('A', 1000, 9), card('B', 1000, 9),
      { apertura: 5, choque: 5, remate: 0 },
      { apertura: 3, choque: 3, remate: 4 },
    )
    s = resolveRound(s)        // A gana ronda 1 (1-0)
    s = resolveBattle(s)
    expect(s.winner).toBeNull() // aún 1-0
    s = nextRound(s)
    expect(s.round).toBe(1)
    expect(s.phase).toBe('committing')

    // ronda 2: A gana otra vez (bankedEnergy=0 para ambos, disponible=10)
    const allocA = { apertura: 5, choque: 5, remate: 0 }
    const allocB = { apertura: 3, choque: 3, remate: 4 }
    const hA = await hashAllocation(allocA, 'sA2')
    const hB = await hashAllocation(allocB, 'sB2')
    s = commit(s, 'a', hA); s = commit(s, 'b', hB)
    s = await reveal(s, 'a', allocA, 'sA2')
    s = await reveal(s, 'b', allocB, 'sB2')
    s = resolveRound(s)        // A 2-0
    s = resolveBattle(s)
    expect(s.winner).toBe('a')
    expect(s.phase).toBe('settled')
  })

  it('una ronda nula no avanza el marcador y rejuega', async () => {
    let s = await staged(
      card('A', 1000, 9), card('B', 1000, 9),
      { apertura: 6, choque: 1, remate: 1 },
      { apertura: 1, choque: 6, remate: 1 },
    )
    s = resolveRound(s)        // disputed
    expect(s.roundWins).toEqual({ a: 0, b: 0 })
    s = resolveBattle(s)
    expect(s.winner).toBeNull()
    s = nextRound(s)
    expect(s.phase).toBe('committing')
  })
})
