import type { OpenBattle } from '../../../onchain/packBattleClient'
import type { LiveBattle } from './hubMockData'

const MAX_AVATARS = 4

// Maps a real open lobby to the presentational LiveBattle row shape.
// NOTE: secrecy — rows carry NO real NFTs; `cards` is a static teaser.
export function openBattleToLive(b: OpenBattle): LiveBattle {
  const shown = Math.min(b.players, MAX_AVATARS)
  const players = Array.from({ length: shown }, (_, i) => ({ violet: i % 2 === 1 }))
  const extra = b.players > MAX_AVATARS ? `+${b.players - MAX_AVATARS}` : undefined
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
    costValue: b.buyin,
    action: b.players < b.max_players ? 'join' : 'watch',
  }
}
