// Shared "Crypto Platform" design tokens — UI only, no engine logic.
export const COLORS = {
  bg: '#0b0e14',
  panel: '#161b24',
  panel2: '#1b212c',
  border: '#ffffff14',
  muted: '#9aa3b2',
  text: '#e9edf5',
  green: '#14F195',    // jugador A / "tú"
  violet: '#9945FF',   // jugador B / rival
  red: '#ff5c72',      // SOLO peligro / derrota / eliminación
} as const

export const GRADIENT = 'linear-gradient(90deg,#9945FF,#14F195)'

export const SHADOW = {
  panel: '0 8px 24px #00000055',
  glow: (accent: string) => `0 0 16px ${accent}33`,
} as const

export const player = {
  a: {
    color: COLORS.green,
    glow: '0 0 8px #14F19566',
    glowLg: '0 0 16px #14F19533',
    gradient: 'linear-gradient(90deg,#0f2a1e,#0b0e14)',
    borderColor: '#14F19555',
    label: '🟢',
    sliderClass: 'slider-green',
  },
  b: {
    color: COLORS.violet,
    glow: '0 0 8px #9945FF66',
    glowLg: '0 0 16px #9945FF33',
    gradient: 'linear-gradient(90deg,#1a1430,#0b0e14)',
    borderColor: '#9945FF55',
    label: '🟣',
    sliderClass: 'slider-violet',
  },
} as const

export const RARITY = {
  common: COLORS.muted,
  uncommon: COLORS.green,
  rare: '#5ad1ff',
  epic: '#f0b54a',
} as const

export function formatUsd(v: number): string {
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`
  return `$${v}`
}

export const FONTS = {
  display: "'Sora', system-ui, sans-serif",
  mono: "'JetBrains Mono', 'Courier New', monospace",
  body: "'Inter', system-ui, sans-serif",
} as const
