// Motor puro del Battle Royale (determinista con RNG inyectable).
import { RARITY_ORDER, type RoyaleCard, type RoyaleConfig, type RoyalePlayer, type RoyaleState } from './types'
import { simulatePull } from './pulls'

const BOT_NAMES = ['Bot Ruby', 'Bot Onyx', 'Bot Jade', 'Bot Azur', 'Bot Vega',
  'Bot Iris', 'Bot Cobalt', 'Bot Lyra', 'Bot Nova']

export function createRoyale(
  config: RoyaleConfig,
  playerNames: string[] = ['Tú'],
): RoyaleState {
  if (config.numPlayers < 2 || config.numPlayers > 10) {
    throw new Error('numPlayers debe estar entre 2 y 10')
  }
  const players: RoyalePlayer[] = Array.from({ length: config.numPlayers }, (_, i) => ({
    id: i,
    name: playerNames[i] ?? BOT_NAMES[(i - playerNames.length) % BOT_NAMES.length] ?? `Bot ${i}`,
    isBot: i >= playerNames.length,
    status: 'active',
    eliminatedRound: null,
    pulls: [],
  }))
  return { config, players, pot: [], round: 1, history: [], phase: 'pulling', winnerId: null }
}

/** Devuelve el id del jugador a eliminar: menor valor → menor rareza → menor grade → mayor asiento. */
export function lowestPlayerId(pulls: { playerId: number; card: RoyaleCard }[]): number {
  let worst = pulls[0]
  for (const p of pulls.slice(1)) {
    if (isWorse(p, worst)) worst = p
  }
  return worst.playerId
}

function isWorse(a: { playerId: number; card: RoyaleCard }, b: { playerId: number; card: RoyaleCard }): boolean {
  if (a.card.valueUsd !== b.card.valueUsd) return a.card.valueUsd < b.card.valueUsd
  const ra = RARITY_ORDER[a.card.rarity], rb = RARITY_ORDER[b.card.rarity]
  if (ra !== rb) return ra < rb
  if (a.card.grade !== b.card.grade) return a.card.grade < b.card.grade
  return a.playerId > b.playerId // mayor asiento cae en empate total
}

let _seq = 0
function defaultIdGen(): string { return `pull-${_seq++}` }

export function playRound(
  state: RoyaleState,
  rng: () => number = Math.random,
  idGen: () => string = defaultIdGen,
): RoyaleState {
  if (state.phase === 'finished') return state

  const active = state.players.filter((p) => p.status === 'active')
  const pulls = active.map((p) => ({ playerId: p.id, card: simulatePull(state.config.tier, rng, idGen) }))
  const eliminatedId = lowestPlayerId(pulls)

  const pot = [...state.pot, ...pulls.map((x) => x.card)]
  const pullByPlayer = new Map(pulls.map((x) => [x.playerId, x.card]))

  let players = state.players.map((p): RoyalePlayer => {
    const pulled = pullByPlayer.get(p.id)
    if (!pulled) return p
    const withPull = { ...p, pulls: [...p.pulls, pulled] }
    if (p.id === eliminatedId) return { ...withPull, status: 'eliminated', eliminatedRound: state.round }
    return withPull
  })

  const remaining = players.filter((p) => p.status === 'active')
  let phase: RoyaleState['phase'] = 'pulling'
  let winnerId: number | null = null
  if (remaining.length === 1) {
    winnerId = remaining[0].id
    players = players.map((p) => (p.id === winnerId ? { ...p, status: 'winner' } : p))
    phase = 'finished'
  }

  return {
    ...state,
    players,
    pot,
    round: phase === 'finished' ? state.round : state.round + 1,
    history: [...state.history, { round: state.round, pulls, eliminatedId }],
    phase,
    winnerId,
  }
}
