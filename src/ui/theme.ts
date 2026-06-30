// Shared "Crypto Platform" design tokens — UI only, no engine logic.
export const COLORS = {
  bg: '#06080b',
  panel: '#11161f',
  panel2: '#171d28',
  border: '#ffffff14',
  muted: '#8b95a3',
  text: '#eef2f6',
  green: '#00ffc4',    // player A / "you"
  violet: '#ff2e97',   // player B / opponent (accent purple)
  red: '#ff5e7a',      // ONLY danger / loss / elimination
} as const

export const GRADIENT = 'linear-gradient(135deg,#ff2e97,#00ffc4)'

export const SHADOW = {
  panel: '0 8px 24px #00000055',
  glow: (accent: string) => `0 0 16px ${accent}33`,
} as const

export const player = {
  a: {
    color: COLORS.green,
    glow: '0 0 8px #00ffc466',
    glowLg: '0 0 16px #00ffc433',
    gradient: 'linear-gradient(90deg,#0f2a1e,#06080b)',
    borderColor: '#00ffc455',
    label: '🟢',
    sliderClass: 'slider-green',
  },
  b: {
    color: COLORS.violet,
    glow: '0 0 8px #ff2e9766',
    glowLg: '0 0 16px #ff2e9733',
    gradient: 'linear-gradient(90deg,#1a1430,#06080b)',
    borderColor: '#ff2e9755',
    label: '🟣',
    sliderClass: 'slider-violet',
  },
} as const

export const RARITY = {
  common: COLORS.muted,
  uncommon: COLORS.green,
  rare: '#5ad1ff',
  epic: '#ff6bb5',
} as const

/** Beam-of-light glow color for a Live Drop by rarity. Common (or unknown) → null (no glow). */
export function rarityGlow(rarity: string | null | undefined): string | null {
  switch ((rarity ?? '').toLowerCase()) {
    case 'uncommon': return '#00ffc4'  // green
    case 'rare': return '#4ea8ff'      // blue
    case 'epic': return '#ff6bb5'      // purple
    case 'legendary':
    case 'mythic': return '#f5c542'    // gold (above epic)
    default: return null               // common / unknown → no glow
  }
}

export function formatUsd(v: number): string {
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`
  // Max 2 decimals, drop trailing zeros (avoids float noise like 159.10000000000002).
  return `$${Math.round(v * 100) / 100}`
}

export const FONTS = {
  display: "'Space Grotesk', system-ui, sans-serif",
  mono: "'JetBrains Mono', 'Courier New', monospace",
  body: "'Space Grotesk', system-ui, sans-serif",
} as const
