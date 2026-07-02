import { COLORS } from '../../theme'

export interface NewsItem { id: string; tag: string; accent: string; title: string; sub: string; cta: string; href: string }

export const LOBBY_NEWS: NewsItem[] = [
  { id: 'royale', tag: 'GAME MODE', accent: '#ff6bb5', title: 'Battle Royale is live', sub: 'Up to 10 players open packs in rounds — the lowest value drops each round, last one standing takes the pot.', cta: 'How it works', href: '/help#royale' },
  { id: 'fair', tag: 'FAIRNESS', accent: COLORS.green, title: 'Provably-fair pulls', sub: 'Every pull is verifiable and settlement is trustless on Solana. The card edge comes from insured value, nothing anyone can move.', cta: 'Learn more', href: '/help#features' },
  { id: 'deposit', tag: 'WALLET', accent: '#4ea8ff', title: 'Deposit USDC from any chain', sub: 'Top up without a seed phrase. Your balance shows what is free vs. reserved in open lobbies.', cta: 'Open help', href: '/help#features' },
  { id: 'gimmi', tag: 'REWARDS', accent: '#f5c542', title: 'Earn Gimmighouls as you play', sub: 'In-app points tracked next to your balance — earned on every battle and pull.', cta: 'Learn more', href: '/help#features' },
]
