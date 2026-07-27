// Client-side battle SIMULATION for the lobby "Play demo" — builds a fake (but real-shaped) Battle
// from a machine's actual CC card pool, so the same Reveal/Result screens render with no backend,
// no signing and NO FUNDS. The output is a `Battle` fed straight into battleToReveal().
import type { Battle, BattlePullInfo, BattlePlayerState, BattleRoundInfo } from '../onchain/packBattleClient'
import type { MachineCard } from '../onchain/gachaClient'
import { royaleEntryUsd } from '../ui/screens/Hub/createBattleBody'

export const DEMO_ME = 'You'

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function fakeWallet(rng: () => number): string {
  let s = ''
  for (let i = 0; i < 44; i++) s += B58[Math.floor(rng() * B58.length)]
  return s
}

function parseGrade(c: MachineCard): number | null {
  // CC exposes grade as "PSA GEM-MT 10" / the_grade "GEM-MT 10" / generic_grade "10". Take the
  // first field that yields a number — a clean numeric if present, else the trailing number out
  // of a human grade like "GEM-MT 10". (A plain `the_grade ?? generic_grade` would pick the
  // non-null text field and Number() it to NaN, dropping the grade.)
  for (const raw of [c.generic_grade, c.the_grade, c.grade]) {
    if (raw == null) continue
    const direct = Number(raw)
    if (Number.isFinite(direct) && direct > 0) return direct
    const m = String(raw).match(/(\d+(?:\.\d+)?)\s*$/)
    if (m) return Number(m[1])
  }
  return null
}

function groupByRarity(pool: MachineCard[]): Map<string, MachineCard[]> {
  const m = new Map<string, MachineCard[]>()
  for (const c of pool) {
    const k = (c.rarity ?? 'common').toLowerCase()
    const arr = m.get(k) ?? []
    arr.push(c)
    m.set(k, arr)
  }
  return m
}

/** Pick a card weighted by the machine's per-rarity odds, but only among rarities present in the
 *  pool (so we never roll a rarity with no sample). Falls back to any card. */
function pickCard(byRarity: Map<string, MachineCard[]>, odds: Record<string, number>, rng: () => number): MachineCard {
  const present = [...byRarity.keys()].filter((r) => (byRarity.get(r)?.length ?? 0) > 0)
  const weights = present.map((r) => Math.max(0, odds[r] ?? 0))
  const total = weights.reduce((a, b) => a + b, 0)
  let rarity = present[present.length - 1]
  if (total > 0) {
    let t = rng() * total
    for (let i = 0; i < present.length; i++) { t -= weights[i]; if (t <= 0) { rarity = present[i]; break } }
  } else {
    rarity = present[Math.floor(rng() * present.length)] // odds missing → uniform across rarities
  }
  const cards = byRarity.get(rarity)!
  return cards[Math.floor(rng() * cards.length)]
}

function toPull(card: MachineCard, round: number, wallet: string): BattlePullInfo {
  return {
    round_number: round, player_wallet: wallet, nft_address: card.nft_address,
    rarity: card.rarity, insured_value: card.insured_value, auto_sold: false,
    grade: parseGrade(card), year: card.year, name: card.name, buyback_amount: null,
  }
}

const val = (c: MachineCard) => c.insured_value ?? 0

/** Pack Battle demo: you vs one bot, one card each; higher insured value wins the pot. */
export function buildPackDemo(pool: MachineCard[], odds: Record<string, number>, machineCode: string, price: number, rng: () => number = Math.random): Battle {
  const byRarity = groupByRarity(pool)
  const TEMP_N = 5
  const wallets = [DEMO_ME, ...Array.from({ length: TEMP_N - 1 }, () => fakeWallet(rng))]
  const cards = wallets.map(() => pickCard(byRarity, odds, rng))
  const pulls: BattlePullInfo[] = wallets.map((w, i) => toPull(cards[i], 1, w))
  // El ⚡ de auto-vendida se sortea por carta. Antes se marcaban las dos últimas de la lista
  // ordenada, o sea siempre los mismos asientos: se leía como un guion, no como suerte.
  pulls.forEach((p) => { p.auto_sold = rng() < 0.4 })
  const totals = cards.map(val)
  const players: BattlePlayerState[] = wallets.map((w, i) => ({ wallet: w, eliminated_round: null, accumulated_value: totals[i] }))
  // Gana el valor más alto, como en el backend real (determine_winner suma por jugador y compara).
  // Antes se ordenaban las cartas para dar la mejor al jugador y el ganador venía fijado: la demo
  // enseñaba una partida que no se podía perder, y de paso el jugador veía siempre el valor más
  // alto de la tirada — que es lo que hacía parecer que los valores estuvieran cableados.
  const best = Math.max(...totals)
  const tied = wallets.filter((_, i) => totals[i] === best)
  // Empate: el backend lo resuelve con la semilla Provably-Fair; aquí no hay, así que se sortea.
  const winner = tied[Math.floor(rng() * tied.length)]
  return {
    id: 'demo', mode: 'pack', machine_code: machineCode, price, max_players: TEMP_N,
    buyin: price * 1e6,
    status: 'settled', winner, creator_wallet: DEMO_ME,
    players, rounds: [], server_seed_hash: null, pulls,
    packs: [{ machine_code: machineCode, sequence: 0, price }],
  }
}

/** Battle Royale demo: you + (n-1) bots. Each round the survivors pull one card and the player
 *  with the lowest ACCUMULATED total is eliminated, until one remains. Mirrors the real backend. */
export function buildRoyaleDemo(pool: MachineCard[], odds: Record<string, number>, machineCode: string, price: number, numPlayers = 10, rng: () => number = Math.random): Battle {
  const byRarity = groupByRarity(pool)
  const wallets = [DEMO_ME, ...Array.from({ length: numPlayers - 1 }, () => fakeWallet(rng))]
  const acc: Record<string, number> = {}; wallets.forEach((w) => (acc[w] = 0))
  const elimRound: Record<string, number | null> = {}; wallets.forEach((w) => (elimRound[w] = null))
  const pulls: BattlePullInfo[] = []
  const rounds: BattleRoundInfo[] = []

  let alive = [...wallets]
  let round = 1
  while (alive.length > 1) {
    for (const w of alive) { const c = pickCard(byRarity, odds, rng); pulls.push(toPull(c, round, w)); acc[w] += val(c) }
    // Eliminate the lowest ACCUMULATED total (matches the real backend), NOT the lowest single
    // pull this round — a strong overall lead must not be knocked out by one bad pull.
    let worst = alive[0]
    for (const w of alive) if (acc[w] <= acc[worst]) worst = w   // tie → later seat falls
    elimRound[worst] = round
    rounds.push({ round_number: round, eliminated_wallet: worst, tie_break_index: null })
    alive = alive.filter((w) => w !== worst)
    round++
  }

  const players: BattlePlayerState[] = wallets.map((w) => ({ wallet: w, eliminated_round: elimRound[w], accumulated_value: acc[w] }))
  return {
    id: 'demo', mode: 'royale', machine_code: machineCode, price, max_players: numPlayers,
    // Sin buyin, vm.entry sale 0 y el rail esconde el bloque ENTRY: la demo no enseñaba lo que
    // costaría jugar, que es justo lo que el jugador necesita saber antes de pagar una plaza.
    buyin: Math.round(royaleEntryUsd(numPlayers, price) * 1e6),
    status: 'settled', winner: alive[0], creator_wallet: DEMO_ME,
    players, rounds, server_seed_hash: null, pulls,
  }
}
