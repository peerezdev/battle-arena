import { COLORS } from '../../theme'

export interface HelpMode { id: string; name: string; tag: string; accent: string; desc: string; steps: string[]; iconPaths: string }
export interface HelpFeature { title: string; body: string; accent: string; iconPaths: string }

export const HELP_MODES: HelpMode[] = [
  { id: 'pack', name: 'Pack Battle', tag: '1V1 · WINNER TAKES ALL', accent: COLORS.green,
    desc: 'Two players put up the same buy-in and each open a pack. The higher total insured value takes both cards.',
    steps: ['Pick a buy-in ($10–$250) and create or join a battle.', 'Both players open their pack at the same time.', 'Higher insured value wins both cards.'],
    iconPaths: '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" x2="9" y1="14" y2="18"/><line x1="7" x2="4" y1="17" y2="20"/><line x1="3" x2="5" y1="19" y2="21"/>' },
  { id: 'royale', name: 'Battle Royale', tag: '2–10 PLAYERS · LAST ONE STANDING', accent: '#ff6bb5',
    desc: 'A lobby of up to 10 players opens packs in synchronized rounds. After each round the lowest total value is eliminated. The last player standing takes the entire pot.',
    steps: ['Join a lobby and wait for the seats to fill.', 'Open your pack each round; the lowest value is eliminated.', 'Outlast everyone to take the whole pot.'],
    iconPaths: '<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.52l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/>' },
  { id: 'gacha', name: 'Gacha', tag: 'SOLO · PULL → PLAY', accent: '#a98bff',
    desc: 'Open Collector Crypt packs on your own to build your collection. Every card you pull is a real graded NFT you own — and you can take it straight into a battle.',
    steps: ['Choose a machine by set and price tier.', 'Pull your card — a provably-fair reveal.', 'Keep it, or jump straight into a battle.'],
    iconPaths: '<rect x="3" y="3" width="12" height="17" rx="1.2"/><path d="M3 9h12M3 15h12M7 9v6M11 9v6"/><path d="M5.5 5.5h7M5.5 7h7"/><path d="M15 11h2v3h-2"/><circle cx="19.5" cy="6" r="2"/><path d="M19.5 8v3"/>' },
]

export const HELP_FEATURES: HelpFeature[] = [
  { title: 'Wallet & deposits', accent: COLORS.green, body: 'Deposit USDC from any chain — no seed phrase. Your balance shows what is free vs. reserved in open lobbies.', iconPaths: '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>' },
  { title: 'Gimmighouls', accent: '#f5c542', body: 'The in-app points you earn by playing. Track them next to your balance and spend them on perks and events.', iconPaths: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9 12h6"/>' },
  { title: 'The radio', accent: '#a98bff', body: 'A live station plays while you are in the app. Play/pause, skip stations, or adjust volume from the top bar.', iconPaths: '<path d="M11 4.7 6.5 8.3H3v7.4h3.5L11 19.3z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M19 6.5a8 8 0 0 1 0 11"/>' },
  { title: 'Recent drops', accent: COLORS.green, body: 'A live feed of cards pulled across the arena. Your own drops are highlighted so you can spot them at a glance.', iconPaths: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>' },
  { title: 'Provably fair', accent: COLORS.green, body: "Every pull is verifiable and the card edge comes from insured value — not prices anyone can move.", iconPaths: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>' },
  { title: 'Platform fee', accent: '#4ea8ff', body: 'Battles charge a small platform fee (0.5% per player, capped) on the winner’s buyback value, collected in USDC after payout. Solo gacha pulls have no fee.', iconPaths: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5a3 3 0 0 0-3-1.5c-1.7 0-3 1-3 2.2 0 2.8 6 1.4 6 4.1 0 1.3-1.3 2.2-3 2.2a3 3 0 0 1-3-1.5"/><path d="M12 6v12"/>' },
  { title: 'Trustless settlement', accent: '#4ea8ff', body: 'Stakes sit in on-chain escrow and pay out automatically on Solana. You sign, the program pays — we never custody your funds.', iconPaths: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>' },
]
