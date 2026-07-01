// Client-side battle SIMULATION for the lobby "Play demo" — builds a fake (but real-shaped) Battle
// from a machine's actual CC card pool, so the same Reveal/Result screens render with no backend,
// no signing and NO FUNDS. The output is a `Battle` fed straight into battleToReveal().
import type { Battle, BattlePullInfo, BattlePlayerState, BattleRoundInfo } from '../onchain/packBattleClient'
import type { MachineCard } from '../onchain/gachaClient'

export const DEMO_ME = 'You'

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function fakeWallet(rng: () => number): string {
  let s = ''
  for (let i = 0; i < 44; i++) s += B58[Math.floor(rng() * B58.length)]
  return s
}

function parseGrade(c: MachineCard): number | null {
  const g = Number(c.the_grade ?? c.generic_grade ?? c.grade)
  return Number.isFinite(g) ? g : null
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
  const bot = fakeWallet(rng)
  const meCard = pickCard(byRarity, odds, rng)
  const botCard = pickCard(byRarity, odds, rng)
  const pulls: BattlePullInfo[] = [toPull(meCard, 1, DEMO_ME), toPull(botCard, 1, bot)]
  const meTotal = val(meCard), botTotal = val(botCard)
  const players: BattlePlayerState[] = [
    { wallet: DEMO_ME, eliminated_round: null, accumulated_value: meTotal },
    { wallet: bot, eliminated_round: null, accumulated_value: botTotal },
  ]
  return {
    id: 'demo', mode: 'pack', machine_code: machineCode, price, max_players: 2,
    status: 'settled', winner: meTotal >= botTotal ? DEMO_ME : bot, creator_wallet: DEMO_ME,
    players, rounds: [], server_seed_hash: null, pulls,
    packs: [{ machine_code: machineCode, sequence: 0, price }],
  }
}

/** Battle Royale demo: you + (n-1) bots. Each round the survivors pull one card and the lowest
 *  value that round is eliminated, until one remains. Mirrors the real lowest-value rule. */
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
    const rp = alive.map((w) => { const c = pickCard(byRarity, odds, rng); pulls.push(toPull(c, round, w)); acc[w] += val(c); return { w, v: val(c) } })
    let worst = rp[0]
    for (const x of rp) if (x.v <= worst.v) worst = x   // tie → later seat falls (matches engine's "mayor asiento")
    elimRound[worst.w] = round
    rounds.push({ round_number: round, eliminated_wallet: worst.w, tie_break_index: null })
    alive = alive.filter((w) => w !== worst.w)
    round++
  }

  const players: BattlePlayerState[] = wallets.map((w) => ({ wallet: w, eliminated_round: elimRound[w], accumulated_value: acc[w] }))
  return {
    id: 'demo', mode: 'royale', machine_code: machineCode, price, max_players: numPlayers,
    status: 'settled', winner: alive[0], creator_wallet: DEMO_ME,
    players, rounds, server_seed_hash: null, pulls,
  }
}
