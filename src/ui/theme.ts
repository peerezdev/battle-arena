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

// Rarity colours are SEMANTIC and independent of the brand palette: uncommon=green, rare=blue,
// epic=purple, legendary=gold. They intentionally do NOT follow the Neón Cyber recolor.
export const RARITY = {
  common: COLORS.muted,
  uncommon: '#2fe28a',
  rare: '#5ad1ff',
  epic: '#a98bff',
} as const

/** Beam-of-light glow color for a Live Drop by rarity. Common (or unknown) → null (no glow). */
export function rarityGlow(rarity: string | null | undefined): string | null {
  switch ((rarity ?? '').toLowerCase()) {
    case 'uncommon': return '#2fe28a'  // green
    case 'rare': return '#4ea8ff'      // blue
    case 'epic': return '#a98bff'      // purple
    case 'legendary':
    case 'mythic': return '#f5c542'    // gold (above epic)
    default: return null               // common / unknown → no glow
  }
}

export function formatUsd(v: number): string {
  // Full amount with thousands separators (no k/M abbreviation). Max 2 decimals, trailing
  // zeros dropped (so no float noise like 159.10000000000002, and whole dollars show clean).
  return `$${(Math.round(v * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

export const FONTS = {
  display: "'Space Grotesk', system-ui, sans-serif",
  mono: "'JetBrains Mono', 'Courier New', monospace",
  body: "'Space Grotesk', system-ui, sans-serif",
} as const

/**
 * Escala de capas. Los z-index estaban puestos a ojo fichero a fichero y eso dejó modales POR
 * DEBAJO del chrome: `DelegationGate` y `VerifyPanel` (ambos `aria-modal`) iban a 50 con la barra
 * superior a 60, así que la cabecera —y el logo, que en móvil vive ahí— se pintaba encima de un
 * diálogo. `MuteButton` iba fijo arriba a la derecha, exactamente donde está la barra, o sea
 * tapado del todo en móvil.
 *
 * Regla: nada que deba verse por encima del contenido puede ir por debajo de `chrome`.
 */
export const Z = {
  backdrop: 0,     // fondos decorativos (ArenaBackdrop)
  content: 1,      // contenido normal de la página
  bottomBar: 50,   // navegación inferior en móvil
  chrome: 60,      // barra superior y rail: por encima del contenido, sus menús se despliegan
  floating: 70,    // controles flotantes sobre el chrome (mute)
  modal: 100,      // diálogos y sus fondos
  drawer: 120,     // chat lateral y pantallas a pantalla completa
  overlay: 200,    // reveals y overlays que se comen la pantalla entera
  toast: 9999,     // avisos: siempre lo último
} as const
