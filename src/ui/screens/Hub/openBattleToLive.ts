import type { OpenBattle } from '../../../onchain/packBattleClient'
import type { LiveBattle } from './hubMockData'
import { royaleTotalPulls } from './createBattleBody'

// buyin arrives from the backend in USDC base units (1 USD = 1_000_000 units).
const BASE_UNITS = 1e6

const MAX_AVATARS = 4

// Maps a real open lobby to the presentational LiveBattle row shape.
// NOTE: secrecy — rows carry NO real NFTs; `cards` is a static teaser.
export function openBattleToLive(b: OpenBattle, meWallet: string | null = null): LiveBattle {
  const shown = Math.min(b.players, MAX_AVATARS)
  const players = Array.from({ length: shown }, (_, i) => ({ violet: i % 2 === 1 }))
  const extra = b.players > MAX_AVATARS ? `+${b.players - MAX_AVATARS}` : undefined
  const entry = b.buyin / BASE_UNITS // convert base units → USD for display
  const priceUsd = b.price / BASE_UNITS
  // Estimated pot at a full lobby. Royale: machine price × total packs opened (1 elim/round).
  // Pack: each player opens the same bundle (b.price is the bundle total) × players.
  const estPot = b.mode === 'royale'
    ? priceUsd * royaleTotalPulls(b.max_players)
    : priceUsd * b.max_players
  const full = b.players >= b.max_players
  const status = full
    ? { statusText: 'Live', statusColor: '#ff5e7a' }
    : b.max_players > 2
      ? { statusText: 'Filling', statusColor: '#f5b73d' }
      : { statusText: 'Waiting for opponent', statusColor: '#00ffc4' }
  return {
    id: b.id,
    mode: b.mode,
    live: false,
    title: b.machine_code,
    sub: `${b.players}/${b.max_players} joined`,
    players,
    extra,
    cards: b.mode === 'royale' ? ['🎴'] : ['🔥', '💧'],
    costLabel: b.mode === 'royale' ? 'ENTRY' : 'BUY-IN',
    costValue: entry,
    action: full ? 'watch' : 'join',
    canCancel: !!meWallet && b.creator_wallet === meWallet,
    alreadyJoined: !!meWallet && (b.player_wallets ?? []).includes(meWallet),
    entry,
    pot: estPot,
    slots: `${b.players}/${b.max_players}`,
    ...status,
  }
}
