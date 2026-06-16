// src/ui/components/CardSlab.tsx
// Skeuomorphic PSA/CGC-style graded slab frame. No image assets.
// Accepts an optional imageUrl — shows real card art when present,
// otherwise renders the gradient placeholder with holographic sheen.

import { COLORS, FONTS } from '../theme'

interface Props {
  /** Card display name. */
  name: string
  /** Grading company label (e.g. "PSA", "BGS"). */
  gradeCompany: string
  /** Numeric grade (e.g. 10, 9.5). */
  grade: number
  /** Cert / serial number string. */
  cert?: string
  /** Player accent color (green or red). */
  accentColor: string
  /** Optional real card image URL — renders inside the window when present. */
  imageUrl?: string
  /** 'compact' = smaller, used in row layouts; 'full' = standalone slab. */
  variant?: 'compact' | 'full'
  /** Show the holographic sheen animation (skip when reduced-motion). */
  sheen?: boolean
}

export function CardSlab({
  name,
  gradeCompany,
  grade,
  cert,
  accentColor,
  imageUrl,
  variant = 'compact',
  sheen = true,
}: Props) {
  const isCompact = variant === 'compact'

  // Outer slab dimensions
  const slabPad = isCompact ? '4px 6px 6px' : '8px 10px 10px'
  const borderRadius = isCompact ? '8px' : '12px'
  const windowHeight = isCompact ? 52 : 110
  const windowRadius = isCompact ? '4px' : '8px'

  // Slab body — slightly lighter than panel, with a subtle inner bevel
  const slabBg = `linear-gradient(160deg, #1a2440 0%, #101828 100%)`

  // Label bar (top) — monospace, accent-colored
  const labelFontSize = isCompact ? '9px' : '11px'

  // Name font
  const nameFontSize = isCompact ? '11px' : '14px'

  // Grade badge
  const gradeFontSize = isCompact ? '13px' : '18px'

  // Holographic sheen overlay — only when sheen=true, CSS animation
  const sheenStyle: React.CSSProperties = sheen
    ? {
        position: 'absolute',
        inset: 0,
        borderRadius: windowRadius,
        background:
          'linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.08) 50%, transparent 70%)',
        backgroundSize: '200% 100%',
        animation: 'holographic-sheen 3s linear infinite',
        pointerEvents: 'none',
      }
    : {}

  // Card window content
  const windowContent = imageUrl ? (
    <img
      src={imageUrl}
      alt={name}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        borderRadius: windowRadius,
        display: 'block',
      }}
    />
  ) : (
    <div
      style={{
        width: '100%',
        height: '100%',
        borderRadius: windowRadius,
        background: `linear-gradient(135deg, ${accentColor}22 0%, #0a0e1a 60%, ${accentColor}11 100%)`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4px',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Placeholder card art: grid lines */}
      <svg
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.08 }}
        preserveAspectRatio="none"
      >
        {Array.from({ length: 5 }, (_, i) => (
          <line
            key={`h${i}`}
            x1="0%" y1={`${(i + 1) * 16.7}%`}
            x2="100%" y2={`${(i + 1) * 16.7}%`}
            stroke={accentColor} strokeWidth="0.5"
          />
        ))}
        {Array.from({ length: 4 }, (_, i) => (
          <line
            key={`v${i}`}
            x1={`${(i + 1) * 20}%`} y1="0%"
            x2={`${(i + 1) * 20}%`} y2="100%"
            stroke={accentColor} strokeWidth="0.5"
          />
        ))}
      </svg>
      {/* Card name in window */}
      <span
        style={{
          fontSize: nameFontSize,
          fontWeight: 700,
          color: accentColor,
          fontFamily: FONTS.display,
          textAlign: 'center',
          padding: '0 6px',
          letterSpacing: '.04em',
          lineHeight: 1.2,
          position: 'relative',
          zIndex: 1,
          textShadow: `0 0 8px ${accentColor}88`,
        }}
      >
        {name}
      </span>
    </div>
  )

  return (
    <div
      style={{
        background: slabBg,
        border: `1px solid ${accentColor}55`,
        borderRadius,
        padding: slabPad,
        boxShadow: `0 0 12px ${accentColor}22, inset 0 1px 0 rgba(255,255,255,0.06)`,
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
      }}
    >
      {/* Top label bar: COMPANY · GRADE · CERT */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontFamily: FONTS.mono,
          fontSize: labelFontSize,
          color: accentColor,
          letterSpacing: '.06em',
          lineHeight: 1,
          paddingBottom: '3px',
          borderBottom: `1px solid ${accentColor}33`,
        }}
      >
        <span style={{ fontWeight: 500 }}>{gradeCompany.toUpperCase()}</span>
        <span
          style={{
            fontWeight: 700,
            fontSize: isCompact ? '11px' : gradeFontSize,
            fontFamily: FONTS.display,
            color: accentColor,
          }}
        >
          {grade}
        </span>
        {cert && (
          <span style={{ opacity: 0.6 }}>#{cert.slice(0, 8)}</span>
        )}
      </div>

      {/* Card window */}
      <div
        style={{
          position: 'relative',
          height: windowHeight,
          borderRadius: windowRadius,
          overflow: 'hidden',
          background: '#080c18',
        }}
      >
        {windowContent}
        {sheen && !imageUrl && <div style={sheenStyle} />}
      </div>

      {/* Bottom: card name (compact variant only — already in window for full) */}
      {isCompact && (
        <div
          style={{
            fontSize: '9px',
            color: COLORS.muted,
            fontFamily: FONTS.mono,
            letterSpacing: '.04em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </div>
      )}
    </div>
  )
}
