// src/ui/components/FrontSigil.tsx
// Stroke-based inline SVG emblems for the three battle fronts.
// color = player accent; size = px; glow = optional CSS filter glow.

import type { FrontKey } from '../../engine'

interface Props {
  front: FrontKey
  color: string
  size?: number
  /** Add a CSS drop-shadow glow (matches the neon palette). */
  glow?: boolean
}

/** Rising blade / dawn silhouette — Apertura (opening). */
function AperturaSvg({ color, size }: { color: string; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Blade rising from base */}
      <line x1="12" y1="20" x2="12" y2="6" />
      <polyline points="7,11 12,6 17,11" />
      {/* Dawn arc behind */}
      <path d="M5 20 A7 7 0 0 1 19 20" strokeOpacity="0.55" />
      {/* Guard at base */}
      <line x1="9" y1="20" x2="15" y2="20" />
    </svg>
  )
}

/** Clashing burst — Choque (clash). */
function ChoqueSvg({ color, size }: { color: string; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Burst star — 6 spokes */}
      <line x1="12" y1="3"  x2="12" y2="7"  />
      <line x1="12" y1="17" x2="12" y2="21" />
      <line x1="3"  y1="12" x2="7"  y2="12" />
      <line x1="17" y1="12" x2="21" y2="12" />
      <line x1="5.6"  y1="5.6"  x2="8.4"  y2="8.4"  />
      <line x1="15.6" y1="15.6" x2="18.4" y2="18.4" />
      <line x1="18.4" y1="5.6"  x2="15.6" y2="8.4"  />
      <line x1="8.4"  y1="15.6" x2="5.6"  y2="18.4" />
      {/* Center ring */}
      <circle cx="12" cy="12" r="3" strokeOpacity="0.7" />
    </svg>
  )
}

/** Target / finisher crosshair — Remate (finisher). */
function RemateSvg({ color, size }: { color: string; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Outer ring */}
      <circle cx="12" cy="12" r="9" strokeOpacity="0.55" />
      {/* Inner ring */}
      <circle cx="12" cy="12" r="4.5" />
      {/* Crosshairs — only outer ticks (gap at center for clarity) */}
      <line x1="12" y1="2"   x2="12" y2="6.5"  />
      <line x1="12" y1="17.5" x2="12" y2="22"  />
      <line x1="2"  y1="12"  x2="6.5" y2="12"  />
      <line x1="17.5" y1="12" x2="22" y2="12"  />
      {/* Center dot */}
      <circle cx="12" cy="12" r="1.2" fill={color} stroke="none" />
    </svg>
  )
}

export function FrontSigil({ front, color, size = 22, glow = false }: Props) {
  const filter = glow
    ? `drop-shadow(0 0 4px ${color}) drop-shadow(0 0 8px ${color}66)`
    : undefined

  const svgProps = { color, size }

  const icon =
    front === 'apertura' ? <AperturaSvg {...svgProps} /> :
    front === 'choque'   ? <ChoqueSvg   {...svgProps} /> :
                           <RemateSvg   {...svgProps} />

  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', filter, flexShrink: 0 }}
      role="img"
      aria-label={front}
    >
      {icon}
    </span>
  )
}
