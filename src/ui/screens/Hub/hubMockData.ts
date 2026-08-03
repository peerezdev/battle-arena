// Datos de EJEMPLO para el Hub presentacional. NO son reales — se sustituirán
// por backend (chat, drops, battles) cuando exista. No representan saldos reales.
export type HubNav = 'lobby' | 'pack' | 'royale' | 'gacha' | 'winners' | 'mana' | 'ranks' | 'help'
export type BattleMode = 'pack' | 'royale' | 'mana'

export interface DropItem { id: string; name: string; set: string; ago: string; valueUsd: number; emoji: string; accent: string }
export interface ChatMsg { id: string; user: string; mod?: boolean; color: string; ts: string; text: string }
export interface LiveBattle {
  id: string; mode: BattleMode; live: boolean; title: string; sub: string
  players: { violet: boolean }[]; extra?: string; cards: string[]
  costLabel: string; costValue: number; action: 'watch' | 'join'
  canCancel?: boolean
  alreadyJoined?: boolean
  entry: number; pot: number; slots: string; statusText: string; statusColor: string
  machineCodes?: string[]   // packs opened (pack: the bundle in order; royale: the single machine)
  // Real-lobby extras (used by the wide royale card for named seats + per-round maths).
  playerWallets?: string[]  // joined players, in seat order
  creatorWallet?: string    // the host (shown as HOST)
  maxPlayers?: number       // total seats
  machinePrice?: number     // machine price in USD (royale = price per pull/round)
  // Live-games filter fields (from /pack-battles/list). Absent → treated as an open lobby.
  battleStatus?: 'lobby' | 'running' | 'settled' | 'voided' | 'cancelled'
  winner?: string | null
  createdAt?: string        // ISO — ordering for active games
  settledAt?: string | null // ISO — ordering for Recent
  /** Real loot won (USD), settled games only. `pot` is the ESTIMATE; this is what actually dropped. */
  lootUsd?: number
}

export const MOCK_DROPS: DropItem[] = [
  { id: 'd1', name: 'Charizard VMAX', set: 'Pokémon · 12s', ago: '12s', valueUsd: 320, emoji: '🔥', accent: '#00ffc4' },
  { id: 'd2', name: 'Pikachu V', set: 'V Starter · 49s', ago: '49s', valueUsd: 55, emoji: '⚡', accent: '#ff2e97' },
  { id: 'd3', name: 'Blastoise', set: 'Base · 2m', ago: '2m', valueUsd: 20, emoji: '💧', accent: '#5ad1ff' },
]

export const MOCK_CHAT: ChatMsg[] = [
  { id: 'm1', user: 'mole', color: '#b78cff', ts: '15:49', text: 'smacking the bot lol — 3-0 in $250s' },
  { id: 'm2', user: 'Netti', mod: true, color: '#00ffc4', ts: '15:50', text: 'double rare 👀 that\'s a big win' },
  { id: 'm3', user: 'shalev123', color: '#00ffc4', ts: '15:51', text: 'won a Charizard from a $50 pack 🔥' },
  { id: 'm4', user: 'kappa', color: '#b78cff', ts: '15:52', text: 'anyone up for a royale?' },
]

// ─── Barra inferior del MÓVIL ────────────────────────────────────────────────
// Pese al nombre, el raíl de escritorio no sale de aquí: LeftRail tiene su propia lista. Esto lo
// consume solo el BottomNav de AppShell.
export const NAV_ITEMS: { id: HubNav; icon: string; label: string }[] = [
  { id: 'lobby',  icon: '⌂',  label: 'Home'  },
  { id: 'pack',   icon: '⚔️', label: 'Pack'  },
  { id: 'royale', icon: '👑', label: 'Royale'  },
  { id: 'gacha',  icon: '🎰', label: 'Gacha'  },
  { id: 'ranks',  icon: '🏆', label: 'Ranking'  },
  { id: 'help',   icon: '?',  label: 'Help'  },
]
