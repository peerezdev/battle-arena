// Shared dark-neon TCG Arena color constants — UI only, no engine logic.
export const COLORS = {
  bg: '#0a0e1a',
  panel: '#121a30',
  border: '#1d2740',
  muted: '#7c89a8',
  text: '#e7ecf5',
  green: '#34e29b',    // Player A accent
  red: '#ff5c72',      // Player B accent
} as const

export const player = {
  a: {
    color: COLORS.green,
    glow: '0 0 8px #34e29b',
    glowLg: '0 0 16px #34e29b44',
    gradient: 'linear-gradient(90deg,#10301f,#0a0e1a)',
    borderColor: '#34e29b55',
    label: '🟢',
    sliderClass: 'slider-green',
  },
  b: {
    color: COLORS.red,
    glow: '0 0 8px #ff5c72',
    glowLg: '0 0 16px #ff5c7244',
    gradient: 'linear-gradient(90deg,#300a0f,#0a0e1a)',
    borderColor: '#ff5c7255',
    label: '🔴',
    sliderClass: 'slider-red',
  },
} as const

/** Format USD value: ≥1000 → "$1.2k", else "$380" */
export function formatUsd(v: number): string {
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`
  return `$${v}`
}

export const FONTS = {
  orbitron: "'Orbitron', system-ui, sans-serif",
  mono: "'JetBrains Mono', 'Courier New', monospace",
} as const
