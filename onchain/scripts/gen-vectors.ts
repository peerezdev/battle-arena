/**
 * Generador de vectores de equivalencia.
 *
 * Conduce el motor Fase 0 (TypeScript) REAL desde `src/engine` simulando
 * batallas COMPLETAS con asignaciones guionizadas y emite
 * `onchain/programs/battle_arena/tests/fixtures/vectors.json`.
 *
 * Cada vector contiene las cartas, la config (en formato on-chain `MatchConfig`),
 * las asignaciones por ronda y el resultado esperado (ganador + victorias). El
 * test Rust `equivalence.rs` reproduce las MISMAS asignaciones contra las
 * instrucciones reales del programa on-chain y comprueba que el ganador coincide.
 *
 * Ejecutar desde la raíz del repo:
 *   npx tsx onchain/scripts/gen-vectors.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createMatch,
  commit,
  reveal,
  resolveRound,
  resolveBattle,
  nextRound,
  hashAllocation,
  type Card,
  type Allocation,
  type MatchConfig,
  type MatchState,
} from '../../src/engine/index'

// ---- Esquema del vector (formato on-chain) ----------------------------------

interface OnChainCfg {
  roundsToWin: number
  baseEnergy: number
  maxEdge: number
  valueRatioCap: number
  maxRounds: number
  rakeBps: number
  edgeEnabled: boolean
}

interface VectorCard {
  valueUsd: number
  grade: number
}

interface RoundAlloc {
  allocA: Allocation
  allocB: Allocation
}

interface Vector {
  name: string
  cardA: VectorCard
  cardB: VectorCard
  cfg: OnChainCfg
  rounds: RoundAlloc[]
  expected: { winner: 'a' | 'b' | 'draw'; winsA: number; winsB: number }
}

interface ScriptedBattle {
  name: string
  cardA: VectorCard
  cardB: VectorCard
  cfg: OnChainCfg
  rounds: RoundAlloc[]
}

// ---- Mapeo cfg on-chain -> config del motor TS ------------------------------
//
// El motor TS usa `baseEnergyPerRound`, `K` (fijo 0.5), `mode` y trata
// `valueRatioCap` solo en modo 'ranked'. El programa on-chain no aplica cap si
// `value_ratio_cap == 0`. Para que ambos coincidan: cap>0 => ranked con ese cap;
// cap==0 => challenge (sin cap). El edge on-chain (umbrales enteros) equivale a
// round(0.5*log2(ratio)) del motor, así que K=0.5 siempre.
function toEngineConfig(cfg: OnChainCfg): MatchConfig {
  return {
    roundsToWin: cfg.roundsToWin,
    baseEnergyPerRound: cfg.baseEnergy,
    K: 0.5,
    maxEdge: cfg.maxEdge,
    valueRatioCap: cfg.valueRatioCap > 0 ? cfg.valueRatioCap : Number.POSITIVE_INFINITY,
    edgeEnabled: cfg.edgeEnabled,
    mode: cfg.valueRatioCap > 0 ? 'ranked' : 'challenge',
  }
}

function toCard(id: string, c: VectorCard): Card {
  return { id, name: id, valueUsd: c.valueUsd, gradeCompany: 'PSA', grade: c.grade }
}

// ---- Conducción del motor ---------------------------------------------------

async function runBattle(b: ScriptedBattle): Promise<Vector> {
  const cfg = toEngineConfig(b.cfg)
  let s: MatchState = createMatch(toCard('a', b.cardA), toCard('b', b.cardB), cfg)

  const playedRounds: RoundAlloc[] = []

  for (const r of b.rounds) {
    // Si la batalla ya está decidida, no jugamos rondas extra (igual que el
    // programa on-chain, que pasa a Settled al alcanzar rounds_to_win).
    if (s.winner !== null) break

    const salt = `s${s.round}`
    const hA = await hashAllocation(r.allocA, salt + 'A')
    const hB = await hashAllocation(r.allocB, salt + 'B')
    s = commit(s, 'a', hA)
    s = commit(s, 'b', hB)
    s = await reveal(s, 'a', r.allocA, salt + 'A')
    s = await reveal(s, 'b', r.allocB, salt + 'B')
    s = resolveRound(s)
    s = resolveBattle(s)

    playedRounds.push({ allocA: r.allocA, allocB: r.allocB })

    if (s.phase !== 'settled' && s.winner === null) {
      s = nextRound(s)
    }
  }

  const winner: 'a' | 'b' | 'draw' = s.winner ?? 'draw'

  return {
    name: b.name,
    cardA: b.cardA,
    cardB: b.cardB,
    cfg: b.cfg,
    rounds: playedRounds,
    expected: { winner, winsA: s.roundWins.a, winsB: s.roundWins.b },
  }
}

// ---- Batallas guionizadas ---------------------------------------------------

const BASE_CFG: OnChainCfg = {
  roundsToWin: 2,
  baseEnergy: 10,
  maxEdge: 4,
  valueRatioCap: 4,
  maxRounds: 5,
  rakeBps: 0,
  edgeEnabled: true,
}

const A = (apertura: number, choque: number, remate: number): Allocation => ({ apertura, choque, remate })

const battles: ScriptedBattle[] = [
  // (1) Batalla del SPEC §2.6: cara $1200/PSA8 vs barata $950/PSA7. La barata
  // gana por economía a lo largo de 3 rondas. (Misma secuencia que
  // src/engine/integration.test.ts.)
  {
    name: 'spec-2.6-barata-gana',
    cardA: { valueUsd: 1200, grade: 8 },
    cardB: { valueUsd: 950, grade: 7 },
    cfg: { ...BASE_CFG },
    rounds: [
      // R1: A 3/4/3 (10); B 4/0/3 (7, banca 3). A gana apertura? no: B 4>3.
      // Choque A 4>0. Remate empate 3-3 -> solidez PSA8>PSA7 -> A. A gana 2 frentes.
      { allocA: A(3, 4, 3), allocB: A(4, 0, 3) },
      // R2: A 4/3/3 (10); B 5/0/5 (10, banca 3 del disponible 13). B gana apertura
      // y remate -> B gana ronda. 1-1.
      { allocA: A(4, 3, 3), allocB: A(5, 0, 5) },
      // R3: A 1/4/5 (10); B 5/5/3 (13). B gana apertura y choque -> B gana 2-1.
      { allocA: A(1, 4, 5), allocB: A(5, 5, 3) },
    ],
  },

  // (2) Barrida 2-0: A domina las dos primeras rondas con más energía en dos
  // frentes cada vez (mismos valores -> edge 0).
  {
    name: 'sweep-a-2-0',
    cardA: { valueUsd: 1000, grade: 9 },
    cardB: { valueUsd: 1000, grade: 5 },
    cfg: { ...BASE_CFG },
    rounds: [
      // R1: A 6/4/0; B 0/0/10. A gana apertura y choque -> A.
      { allocA: A(6, 4, 0), allocB: A(0, 0, 10) },
      // R2: A 5/5/0; B 0/0/10. A gana apertura y choque -> A. 2-0.
      { allocA: A(5, 5, 0), allocB: A(0, 0, 10) },
      // Esta ronda NO debería jugarse (batalla decidida en R2).
      { allocA: A(10, 0, 0), allocB: A(0, 10, 0) },
    ],
  },

  // (3) Edge no nulo: A $4000 vs B $1000 -> ratio 4 -> edge round(0.5*log2(4))=1
  // (on-chain: >=2x => 1). valueRatioCap:0 => sin cap (modo challenge) para que
  // el motor no rechace el matchup. A dispone de 11 energía/ronda, B de 10.
  {
    name: 'edge-a-bonus-1',
    cardA: { valueUsd: 4000, grade: 6 },
    cardB: { valueUsd: 1000, grade: 6 },
    cfg: { ...BASE_CFG, valueRatioCap: 0 },
    rounds: [
      // R1: A 6/5/0 (11); B 5/5/0 (10). A gana apertura (6>5), choque empata
      // (5-5, solidez igual -> disputed), remate empata 0-0 disputed. A gana 1-0
      // frentes -> A gana ronda.
      { allocA: A(6, 5, 0), allocB: A(5, 5, 0) },
      // R2: A 0/6/5 (11); B 0/5/5 (10). A gana choque (6>5), remate empata
      // disputed, apertura disputed. A gana ronda. 2-0 -> A gana batalla.
      { allocA: A(0, 6, 5), allocB: A(0, 5, 5) },
      // No debería jugarse.
      { allocA: A(11, 0, 0), allocB: A(0, 10, 0) },
    ],
  },

  // (4) B remonta usando banking: A gasta todo cada ronda, B banca y golpea
  // fuerte. Mismo valor -> edge 0. roundsToWin 2.
  {
    name: 'b-banking-comeback',
    cardA: { valueUsd: 2000, grade: 5 },
    cardB: { valueUsd: 2000, grade: 5 },
    cfg: { ...BASE_CFG },
    rounds: [
      // R1: A 5/5/0 (10); B 0/0/4 (4, banca 6). A gana apertura y choque -> A. 1-0.
      { allocA: A(5, 5, 0), allocB: A(0, 0, 4) },
      // R2: A 5/5/0 (10); B 6/6/0 (12, disponible 16). B gana apertura y choque -> B. 1-1.
      { allocA: A(5, 5, 0), allocB: A(6, 6, 0) },
      // R3: A 5/5/0 (10); B 6/6/2 (disponible 10+4=14). B gana apertura, choque y
      // remate -> B 3-0 frentes. 1-2 -> B gana batalla.
      { allocA: A(5, 5, 0), allocB: A(6, 6, 2) },
    ],
  },
]

// ---- Salida -----------------------------------------------------------------

async function main() {
  const vectors: Vector[] = []
  for (const b of battles) {
    vectors.push(await runBattle(b))
  }

  const here = dirname(fileURLToPath(import.meta.url))
  const outPath = resolve(here, '../programs/battle_arena/tests/fixtures/vectors.json')
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(vectors, null, 2) + '\n', 'utf8')

  for (const v of vectors) {
    console.log(
      `vector "${v.name}": winner=${v.expected.winner} winsA=${v.expected.winsA} winsB=${v.expected.winsB} rounds=${v.rounds.length}`,
    )
  }
  console.log(`\nEscrito ${vectors.length} vectores en ${outPath}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
