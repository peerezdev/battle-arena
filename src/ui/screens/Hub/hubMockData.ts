// Datos de EJEMPLO para el Hub presentacional. NO son reales — se sustituirán
// por backend (chat, drops, battles) cuando exista. No representan saldos reales.
export type HubNav = 'lobby' | 'pack' | 'royale' | 'gacha' | 'mana' | 'ranks'
export type BattleMode = 'pack' | 'royale' | 'mana'

export interface DropItem { id: string; name: string; set: string; ago: string; valueUsd: number; emoji: string; accent: string }
export interface ChatMsg { id: string; user: string; mod?: boolean; color: string; ts: string; text: string }
export interface LiveBattle {
  id: string; mode: BattleMode; live: boolean; title: string; sub: string
  players: { violet: boolean }[]; extra?: string; cards: string[]
  costLabel: string; costValue: number; action: 'watch' | 'join'
  canCancel?: boolean
}
export interface HubStat { value: string; label: string; gradient?: boolean }

export const MOCK_DROPS: DropItem[] = [
  { id: 'd1', name: 'Charizard VMAX', set: 'Pokémon · 12s', ago: '12s', valueUsd: 320, emoji: '🔥', accent: '#14F195' },
  { id: 'd2', name: 'Pikachu V', set: 'V Starter · 49s', ago: '49s', valueUsd: 55, emoji: '⚡', accent: '#9945FF' },
  { id: 'd3', name: 'Blastoise', set: 'Base · 2m', ago: '2m', valueUsd: 20, emoji: '💧', accent: '#5ad1ff' },
]

export const MOCK_CHAT: ChatMsg[] = [
  { id: 'm1', user: 'mole', color: '#b78cff', ts: '15:49', text: 'smacking the bot lol — 3-0 in $250s' },
  { id: 'm2', user: 'Netti', mod: true, color: '#14F195', ts: '15:50', text: 'double rare 👀 that\'s a big win' },
  { id: 'm3', user: 'shalev123', color: '#14F195', ts: '15:51', text: 'won a Charizard from a $50 pack 🔥' },
  { id: 'm4', user: 'kappa', color: '#b78cff', ts: '15:52', text: 'anyone up for a royale?' },
]

export const MOCK_STATS: HubStat[] = [
  { value: '—', label: 'Live battles', gradient: true },
  { value: '$2.4k', label: 'Biggest pull today' },
  { value: '312', label: 'Packs opened 24h' },
]

export const STAKE_OPTIONS = [10, 50, 125, 250]

// ─── Bottom-nav / LeftRail items — shared between Hub and AppShell ────────────
export const NAV_ITEMS: { id: HubNav; icon: string; label: string }[] = [
  { id: 'lobby',  icon: '⌂',  label: 'Lobby'  },
  { id: 'pack',   icon: '⚔️', label: 'Pack'   },
  { id: 'royale', icon: '👑', label: 'Royale' },
  { id: 'gacha',  icon: '🎰', label: 'Gacha'  },
  { id: 'mana',   icon: '🎯', label: 'Mana'   },
  { id: 'ranks',  icon: '🏆', label: 'Ranks'  },
]
