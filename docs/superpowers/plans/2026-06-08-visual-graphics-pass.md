# Visual + Animation Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 3D/tactile/immersive visual layer (Orbitron/JetBrains Mono fonts, CardSlab, FrontSigil, EnergyOrbs, ArenaBackdrop, VsIntro) to the React+Vite+TS+Tailwind card-battle game without touching engine/bot/instrumentation.

**Architecture:** All new graphics are coded SVG/CSS/framer-motion — no image assets. Shared components are added to `src/ui/components/` and consumed by the existing screens. Fonts are loaded via `@import` in `src/index.css` and registered as Tailwind tokens. Animation discipline: transform/opacity only; every new motion has a `useReducedMotion` instant/static fallback; `npx tsc --noEmit` + `npm run build` + 81 tests stay green throughout.

**Tech Stack:** React 19, Vite, TypeScript ~6, Tailwind 3, framer-motion 12, Web Animations API (none new), Google Fonts via @import (Orbitron + JetBrains Mono).

---

## File Map

### New files
| File | Responsibility |
|------|---------------|
| `src/ui/components/CardSlab.tsx` | Skeuomorphic PSA/CGC graded-case frame (SVG/CSS), accepts `imageUrl?` prop |
| `src/ui/components/FrontSigil.tsx` | Inline SVG stroke emblems for `apertura`/`choque`/`remate` |
| `src/ui/components/ArenaBackdrop.tsx` | Animated layered radial-gradient + particle background (canvas, respects reduced-motion) |
| `src/ui/components/VsIntro.tsx` | Slab clash splash with skip control, auto-dismiss ~1.5s |

### Modified files
| File | Change |
|------|--------|
| `src/index.css` | Add `@import` for Orbitron + JetBrains Mono; add CSS custom-prop `--font-orbitron`, `--font-mono`; add `@keyframes holographic-sheen`, `orb-pulse` |
| `tailwind.config.js` | Add `fontFamily.orbitron`, `fontFamily.mono` tokens |
| `src/ui/theme.ts` | Add font constants; no logic changes |
| `src/ui/components/PlayerCard.tsx` | Render `CardSlab` instead of flat div |
| `src/ui/components/EnergyAllocator.tsx` | Replace `Pip` circles with `EnergyOrb`; replace emoji icons with `FrontSigil` |
| `src/ui/components/EnergyHeader.tsx` | Apply Orbitron to big numbers; JetBrains Mono to labels |
| `src/ui/screens/AllocationScreen.tsx` | Apply font tokens to round label/player label; wrap with `ArenaBackdrop` |
| `src/ui/screens/RevealScreen.tsx` | Enhance FlipCard with slam-down + impact shake; spotlight pulse on winner; apply fonts; replace emoji with `FrontSigil`; wrap with `ArenaBackdrop` |
| `src/ui/screens/ResultScreen.tsx` | Add winner slab glow/pulse; apply Orbitron to big result text |
| `src/ui/screens/SetupScreen.tsx` | Apply Orbitron to the main title; replace plain `PlayerCard` usage with `CardSlab` compact variant |
| `src/App.tsx` | Mount `VsIntro` splash between setup→allocateA transitions |
| `src/mode/ModeSelect.tsx` | Apply Orbitron to main title |

### NOT touched (hard constraint)
- `src/engine/**`
- `src/bot/**`
- `src/instrumentation/**`

---

## Task 1: Fonts — @import + Tailwind tokens + CSS vars

**Files:**
- Modify: `src/index.css`
- Modify: `tailwind.config.js`
- Modify: `src/ui/theme.ts`

- [ ] **Step 1: Add Google Fonts import to index.css**

Replace the existing `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');` line with:

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Orbitron:wght@700;900&family=JetBrains+Mono:wght@400;500&display=swap');
```

- [ ] **Step 2: Add CSS custom properties and holographic keyframe to index.css**

After the `body {}` block (before the `input[type="range"]` rule) add:

```css
:root {
  --font-orbitron: 'Orbitron', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'Courier New', monospace;
}

@keyframes holographic-sheen {
  0%   { background-position: -200% center; }
  100% { background-position:  200% center; }
}

@keyframes orb-pulse {
  0%, 100% { box-shadow: 0 0 6px var(--orb-color, #34e29b), 0 0 12px var(--orb-color, #34e29b44); }
  50%       { box-shadow: 0 0 10px var(--orb-color, #34e29b), 0 0 22px var(--orb-color, #34e29b66); }
}
```

- [ ] **Step 3: Add font tokens to tailwind.config.js**

In the `theme.extend.fontFamily` object, add:

```js
orbitron: ['Orbitron', 'system-ui', 'sans-serif'],
mono: ['JetBrains Mono', 'Courier New', 'monospace'],
```

So `fontFamily` becomes:

```js
fontFamily: {
  sans: ['Inter', 'system-ui', 'sans-serif'],
  orbitron: ['Orbitron', 'system-ui', 'sans-serif'],
  mono: ['JetBrains Mono', 'Courier New', 'monospace'],
},
```

- [ ] **Step 4: Add font constants to theme.ts**

After the last `export` in `src/ui/theme.ts`, add:

```ts
export const FONTS = {
  orbitron: "'Orbitron', system-ui, sans-serif",
  mono: "'JetBrains Mono', 'Courier New', monospace",
} as const
```

- [ ] **Step 5: Verify TypeScript clean**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npx tsc --noEmit
```
Expected: no output (clean).

- [ ] **Step 6: Run tests**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npm run test
```
Expected: `Tests  81 passed (81)`.

- [ ] **Step 7: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add src/index.css tailwind.config.js src/ui/theme.ts
git commit -m "feat(ui): add Orbitron + JetBrains Mono fonts, CSS vars, Tailwind tokens"
```

---

## Task 2: FrontSigil — SVG emblems replacing emoji

**Files:**
- Create: `src/ui/components/FrontSigil.tsx`

- [ ] **Step 1: Create FrontSigil.tsx**

```tsx
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
```

- [ ] **Step 2: Verify TypeScript clean**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add src/ui/components/FrontSigil.tsx
git commit -m "feat(ui): FrontSigil — stroke SVG emblems for apertura/choque/remate"
```

---

## Task 3: CardSlab — skeuomorphic graded-case card frame

**Files:**
- Create: `src/ui/components/CardSlab.tsx`

- [ ] **Step 1: Create CardSlab.tsx**

```tsx
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
          fontFamily: FONTS.orbitron,
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
            fontFamily: FONTS.orbitron,
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
```

- [ ] **Step 2: Verify TypeScript clean**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add src/ui/components/CardSlab.tsx
git commit -m "feat(ui): CardSlab — skeuomorphic graded-case slab frame (SVG/CSS, asset-ready)"
```

---

## Task 4: Update PlayerCard to use CardSlab

**Files:**
- Modify: `src/ui/components/PlayerCard.tsx`

- [ ] **Step 1: Rewrite PlayerCard.tsx to render a compact CardSlab**

Replace the entire file content with:

```tsx
import type { Card } from '../../engine'
import { player as playerTheme } from '../theme'
import { CardSlab } from './CardSlab'

interface Props {
  card: Card
  playerKey: 'a' | 'b'
  /** Forward an optional imageUrl to CardSlab. */
  imageUrl?: string
  sheen?: boolean
}

export function PlayerCard({ card, playerKey, imageUrl, sheen = true }: Props) {
  const t = playerTheme[playerKey]

  return (
    <CardSlab
      name={card.name}
      gradeCompany={card.gradeCompany}
      grade={card.grade}
      cert={card.id}
      accentColor={t.color}
      imageUrl={imageUrl}
      variant="compact"
      sheen={sheen}
    />
  )
}
```

- [ ] **Step 2: Verify TypeScript clean**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 3: Run tests**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npm run test
```
Expected: `Tests  81 passed (81)`.

- [ ] **Step 4: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add src/ui/components/PlayerCard.tsx
git commit -m "feat(ui): PlayerCard now renders compact CardSlab"
```

---

## Task 5: EnergyOrb in EnergyAllocator + FrontSigil replaces emoji

**Files:**
- Modify: `src/ui/components/EnergyAllocator.tsx`

This task replaces the `Pip` component with a larger glowing `EnergyOrb` with CSS pulse animation, and replaces the `⚔️💥🎯` emoji icons with `FrontSigil`. The existing tap interaction, lock-on-commit, and reduced-motion behavior are preserved byte-for-byte in logic.

- [ ] **Step 1: Update EnergyAllocator.tsx**

Replace the entire file content with:

```tsx
import { AnimatePresence, motion } from 'framer-motion'
import type { Allocation, FrontKey } from '../../engine'
import { COLORS, FONTS } from '../theme'
import { playSfx, haptic } from '../sound'
import { FrontSigil } from './FrontSigil'

interface Props {
  alloc: Allocation
  /** Total energy available this round. */
  available: number
  /** Called with the front key and a +1 or -1 delta; parent owns clamping. */
  onChange: (key: FrontKey, delta: number) => void
  accentColor: string
  reducedMotion: boolean
  /** When true, all controls become no-ops and are visually inactive. */
  disabled?: boolean
}

const FRONTS: { key: FrontKey; label: string }[] = [
  { key: 'apertura', label: 'Apertura' },
  { key: 'choque',   label: 'Choque'   },
  { key: 'remate',   label: 'Remate'   },
]

/**
 * Glowing energy orb — replaces the old Pip.
 * Uses a CSS custom-property for the pulse animation color.
 */
function EnergyOrb({ color, reduced }: { color: string; reduced: boolean }) {
  return (
    <motion.span
      layout={!reduced}
      initial={reduced ? false : { scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={reduced ? undefined : { scale: 0, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 600, damping: 34 }}
      style={{
        '--orb-color': color,
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: `radial-gradient(circle at 38% 36%, ${color}ee 0%, ${color}88 55%, ${color}44 100%)`,
        boxShadow: `0 0 6px ${color}, 0 0 12px ${color}44`,
        display: 'inline-block',
        flex: '0 0 auto',
        animation: reduced ? 'none' : 'orb-pulse 2.2s ease-in-out infinite',
      } as React.CSSProperties}
    />
  )
}

export function EnergyAllocator({ alloc, available, onChange, accentColor, reducedMotion, disabled = false }: Props) {
  const spent = alloc.apertura + alloc.choque + alloc.remate
  const pool = available - spent

  function add(key: FrontKey) {
    if (disabled || pool <= 0) return
    onChange(key, +1)
    playSfx('tick')
    haptic(8)
  }

  function remove(key: FrontKey) {
    if (disabled || alloc[key] <= 0) return
    onChange(key, -1)
    playSfx('tick')
    haptic(8)
  }

  return (
    <div>
      {/* Energy pool */}
      <div
        style={{
          background: COLORS.panel,
          border: `1px solid ${COLORS.border}`,
          borderRadius: '10px',
          padding: '12px',
          marginBottom: '12px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginBottom: '8px',
          }}
        >
          <span style={{ fontSize: '11px', color: COLORS.muted, letterSpacing: '.06em', fontFamily: FONTS.mono }}>
            ENERGÍA DISPONIBLE
          </span>
          <span style={{ fontSize: '11px', color: COLORS.muted, fontFamily: FONTS.mono }}>
            sin asignar <strong style={{ color: accentColor, fontSize: '13px', fontFamily: FONTS.orbitron }}>{pool}</strong> · se banca
          </span>
        </div>
        <motion.div
          layout={!reducedMotion}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '7px',
            minHeight: '16px',
            alignItems: 'center',
          }}
        >
          <AnimatePresence>
            {Array.from({ length: pool }, (_, i) => (
              <EnergyOrb key={`pool-${i}`} color={accentColor} reduced={reducedMotion} />
            ))}
          </AnimatePresence>
          {pool === 0 && (
            <span style={{ fontSize: '11px', color: COLORS.muted, fontStyle: 'italic', fontFamily: FONTS.mono }}>
              Sin energía en reserva
            </span>
          )}
        </motion.div>
      </div>

      {/* Three tappable front zones. */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          marginBottom: '14px',
          opacity: disabled ? 0.5 : 1,
          pointerEvents: disabled ? 'none' : undefined,
          transition: 'opacity .15s',
        }}
        aria-disabled={disabled || undefined}
      >
        {FRONTS.map((f) => {
          const value = alloc[f.key]
          const disabledAdd = disabled || pool <= 0
          const disabledRemove = disabled || value <= 0
          return (
            <div
              key={f.key}
              style={{
                background: COLORS.panel,
                border: `1px solid ${value > 0 ? `${accentColor}66` : COLORS.border}`,
                borderRadius: '12px',
                padding: '12px 14px',
                boxShadow: value > 0 ? `0 0 12px ${accentColor}22` : 'none',
                transition: 'border-color .15s, box-shadow .15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {/* Big tappable area = add 1 energy. */}
                <button
                  type="button"
                  onClick={() => add(f.key)}
                  disabled={disabledAdd}
                  aria-disabled={disabledAdd || undefined}
                  aria-label={`Añadir 1 energía a ${f.label}`}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    background: 'transparent',
                    border: 'none',
                    color: COLORS.text,
                    cursor: disabledAdd ? 'default' : 'pointer',
                    opacity: disabledAdd ? 0.55 : 1,
                    padding: '6px 0',
                    textAlign: 'left',
                    minHeight: '44px',
                  }}
                >
                  <FrontSigil
                    front={f.key}
                    color={value > 0 ? accentColor : COLORS.muted}
                    size={22}
                    glow={value > 0 && !reducedMotion}
                  />
                  <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '15px', fontWeight: 700 }}>{f.label}</span>
                    <span style={{ fontSize: '10px', color: COLORS.muted, fontFamily: FONTS.mono }}>
                      {disabledAdd ? 'pulsa − para quitar' : 'pulsa para sumar'}
                    </span>
                  </span>
                </button>

                {/* Current amount, big and bold, with a bump animation. */}
                <motion.span
                  key={value}
                  initial={reducedMotion ? false : { scale: 1.35 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 18 }}
                  aria-live="polite"
                  style={{
                    fontSize: '30px',
                    fontWeight: 800,
                    fontFamily: FONTS.orbitron,
                    color: value > 0 ? accentColor : COLORS.muted,
                    minWidth: '34px',
                    textAlign: 'center',
                    lineHeight: 1,
                  }}
                >
                  {value}
                </motion.span>

                {/* − control. */}
                <button
                  type="button"
                  onClick={() => remove(f.key)}
                  disabled={disabledRemove}
                  aria-disabled={disabledRemove || undefined}
                  aria-label={`Quitar 1 energía de ${f.label}`}
                  style={{
                    width: '44px',
                    height: '44px',
                    flex: '0 0 auto',
                    borderRadius: '10px',
                    background: COLORS.bg,
                    border: `1px solid ${COLORS.border}`,
                    color: disabledRemove ? COLORS.border : COLORS.text,
                    fontSize: '24px',
                    fontWeight: 700,
                    cursor: disabledRemove ? 'default' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  −
                </button>
              </div>

              {/* Orbs currently allocated to this front. */}
              {value > 0 && (
                <motion.div
                  layout={!reducedMotion}
                  style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}
                >
                  <AnimatePresence>
                    {Array.from({ length: value }, (_, i) => (
                      <EnergyOrb key={`${f.key}-${i}`} color={accentColor} reduced={reducedMotion} />
                    ))}
                  </AnimatePresence>
                </motion.div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript clean**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 3: Run tests**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npm run test
```
Expected: `Tests  81 passed (81)`.

- [ ] **Step 4: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add src/ui/components/EnergyAllocator.tsx
git commit -m "feat(ui): EnergyOrbs replace Pips; FrontSigil replaces emoji in allocator"
```

---

## Task 6: ArenaBackdrop — layered animated battle background

**Files:**
- Create: `src/ui/components/ArenaBackdrop.tsx`

- [ ] **Step 1: Create ArenaBackdrop.tsx**

```tsx
// src/ui/components/ArenaBackdrop.tsx
// Animated battle background: layered radial gradients + subtle
// drifting particle layer (canvas). Very low contrast — never
// competes with foreground content. Respects reduced-motion.
// Cap 40 particles; DPR ≤ 2; canvas unmounts when reducedMotion.

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  reducedMotion: boolean
  /** Optional player accent for tinting the radial gradients. */
  accentA?: string
  accentB?: string
}

interface Particle {
  x: number; y: number
  vx: number; vy: number
  r: number; alpha: number
  color: string
}

const PARTICLE_COLORS = ['#34e29b', '#ff5c72', '#5ad1ff', '#e7ecf5']

export function ArenaBackdrop({ children, reducedMotion, accentA = '#34e29b', accentB = '#ff5c72' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (reducedMotion) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    function resize() {
      if (!canvas) return
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      canvas.style.width = '100%'
      canvas.style.height = '100%'
    }
    resize()
    window.addEventListener('resize', resize)

    const COUNT = 40
    const particles: Particle[] = Array.from({ length: COUNT }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.4 * dpr,
      vy: (Math.random() - 0.5) * 0.4 * dpr,
      r: (Math.random() * 1.5 + 0.5) * dpr,
      alpha: Math.random() * 0.25 + 0.05,
      color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
    }))

    let raf = 0
    function frame() {
      if (!canvas || !ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const p of particles) {
        p.x += p.vx
        p.y += p.vy
        // Wrap at edges
        if (p.x < 0) p.x += canvas.width
        if (p.x > canvas.width) p.x -= canvas.width
        if (p.y < 0) p.y += canvas.height
        if (p.y > canvas.height) p.y -= canvas.height

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = p.color
        ctx.globalAlpha = p.alpha
        ctx.fill()
      }
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [reducedMotion])

  return (
    <div style={{ position: 'relative', minHeight: '100dvh', overflow: 'hidden' }}>
      {/* Layer 1: dark base */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          background: '#0a0e1a',
          zIndex: 0,
        }}
      />
      {/* Layer 2: two radial gradients (player A top-left, player B bottom-right) */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          background: `
            radial-gradient(ellipse 60% 40% at 15% 20%, ${accentA}0d 0%, transparent 70%),
            radial-gradient(ellipse 60% 40% at 85% 80%, ${accentB}0d 0%, transparent 70%)
          `,
          zIndex: 1,
        }}
      />
      {/* Layer 3: slow-drifting particle canvas (skipped when reduced-motion) */}
      {!reducedMotion && (
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 2,
          }}
        />
      )}
      {/* Layer 4: content */}
      <div style={{ position: 'relative', zIndex: 3 }}>
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript clean**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add src/ui/components/ArenaBackdrop.tsx
git commit -m "feat(ui): ArenaBackdrop — layered radial-gradient + particle canvas background"
```

---

## Task 7: VsIntro — slab clash splash with skip

**Files:**
- Create: `src/ui/components/VsIntro.tsx`

- [ ] **Step 1: Create VsIntro.tsx**

```tsx
// src/ui/components/VsIntro.tsx
// VS intro splash: player slabs slide in from opposite sides,
// "clash" in the center with a flash, then auto-dismiss after ~1.5s.
// Includes a skip button and tap-anywhere dismiss.
// Reduced-motion: shows a static VS frame briefly (400ms), then dismisses.

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Card } from '../../engine'
import { CardSlab } from './CardSlab'
import { COLORS, FONTS } from '../theme'

interface Props {
  cardA: Card
  cardB: Card
  reducedMotion: boolean
  onDone: () => void
}

const AUTO_DISMISS_MS = 1500
const REDUCED_DISMISS_MS = 400

export function VsIntro({ cardA, cardB, reducedMotion, onDone }: Props) {
  const [visible, setVisible] = useState(true)
  const [flash, setFlash] = useState(false)

  function dismiss() {
    setVisible(false)
    // Give AnimatePresence exit a tiny window, then fire onDone
    setTimeout(onDone, reducedMotion ? 0 : 300)
  }

  useEffect(() => {
    // Flash appears at ~600ms for full animation; instant for reduced.
    const flashTimer = reducedMotion ? null : setTimeout(() => setFlash(true), 600)
    const dismissTimer = setTimeout(dismiss, reducedMotion ? REDUCED_DISMISS_MS : AUTO_DISMISS_MS)
    return () => {
      if (flashTimer) clearTimeout(flashTimer)
      clearTimeout(dismissTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="vs-intro"
          initial={{ opacity: reducedMotion ? 1 : 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.25 }}
          onClick={dismiss}
          style={{
            position: 'fixed',
            inset: 0,
            background: '#0a0e1aee',
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            padding: '24px 16px',
          }}
        >
          {/* Flash overlay */}
          <AnimatePresence>
            {flash && (
              <motion.div
                key="flash"
                initial={{ opacity: 0.85 }}
                animate={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'white',
                  pointerEvents: 'none',
                  zIndex: 1,
                }}
              />
            )}
          </AnimatePresence>

          {/* Slab row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0',
              width: '100%',
              maxWidth: '380px',
              position: 'relative',
              zIndex: 2,
            }}
          >
            {/* Player A slab slides in from left */}
            <motion.div
              style={{ flex: 1 }}
              initial={reducedMotion ? false : { x: -80, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 22, delay: 0.05 }}
            >
              <CardSlab
                name={cardA.name}
                gradeCompany={cardA.gradeCompany}
                grade={cardA.grade}
                cert={cardA.id}
                accentColor={COLORS.green}
                variant="compact"
                sheen={!reducedMotion}
              />
            </motion.div>

            {/* VS badge */}
            <motion.div
              initial={reducedMotion ? false : { scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 18, delay: 0.35 }}
              style={{
                fontFamily: FONTS.orbitron,
                fontWeight: 900,
                fontSize: '26px',
                color: COLORS.text,
                textShadow: '0 0 16px #ffffff88',
                padding: '0 12px',
                flexShrink: 0,
                letterSpacing: '.05em',
              }}
            >
              VS
            </motion.div>

            {/* Player B slab slides in from right */}
            <motion.div
              style={{ flex: 1 }}
              initial={reducedMotion ? false : { x: 80, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 22, delay: 0.05 }}
            >
              <CardSlab
                name={cardB.name}
                gradeCompany={cardB.gradeCompany}
                grade={cardB.grade}
                cert={cardB.id}
                accentColor={COLORS.red}
                variant="compact"
                sheen={!reducedMotion}
              />
            </motion.div>
          </div>

          {/* Skip hint */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.55 }}
            transition={{ delay: reducedMotion ? 0 : 0.6, duration: 0.3 }}
            style={{
              marginTop: '32px',
              fontSize: '12px',
              fontFamily: FONTS.mono,
              color: COLORS.muted,
              letterSpacing: '.05em',
              zIndex: 2,
              position: 'relative',
            }}
          >
            Toca para continuar
          </motion.div>

          {/* Explicit skip button (also accessible via tap-anywhere above) */}
          <motion.button
            onClick={(e) => { e.stopPropagation(); dismiss() }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.7 }}
            transition={{ delay: reducedMotion ? 0 : 0.5, duration: 0.3 }}
            style={{
              position: 'absolute',
              top: 'max(12px, env(safe-area-inset-top))',
              right: 'max(12px, env(safe-area-inset-right))',
              background: COLORS.panel,
              border: `1px solid ${COLORS.border}`,
              borderRadius: '8px',
              padding: '8px 14px',
              color: COLORS.muted,
              fontSize: '12px',
              fontFamily: FONTS.mono,
              cursor: 'pointer',
              letterSpacing: '.04em',
              zIndex: 3,
              minHeight: '44px',
            }}
            whileTap={{ scale: 0.95 }}
          >
            SKIP
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

- [ ] **Step 2: Verify TypeScript clean**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add src/ui/components/VsIntro.tsx
git commit -m "feat(ui): VsIntro — slab clash splash with auto-dismiss + skip control"
```

---

## Task 8: Apply ArenaBackdrop to AllocationScreen + RevealScreen

**Files:**
- Modify: `src/ui/screens/AllocationScreen.tsx`
- Modify: `src/ui/screens/RevealScreen.tsx`

- [ ] **Step 1: Update AllocationScreen.tsx to use ArenaBackdrop and apply fonts**

In `AllocationScreen.tsx`:

1. Add these imports at the top (after existing imports):
```tsx
import { ArenaBackdrop } from '../components/ArenaBackdrop'
import { FONTS } from '../theme'
```

2. Replace the outermost `<div style={{ minHeight: '100dvh', background: COLORS.bg, ... }}>` wrapper with `<ArenaBackdrop reducedMotion={reduced} accentA={playerKey === 'a' ? COLORS.green : COLORS.red} accentB={playerKey === 'a' ? COLORS.red : COLORS.green}>` — keeping the inner content div unchanged.  Ensure you close `</ArenaBackdrop>` at the end.

3. Inside the outermost wrapper, find the `background: COLORS.bg` style property and remove it (ArenaBackdrop supplies the background now).  Keep all other styles intact.

4. Apply Orbitron to the round label (the `RONDA {round + 1}` div):
```tsx
style={{ fontSize: '11px', color: COLORS.muted, letterSpacing: '.06em', marginBottom: '2px', fontFamily: FONTS.mono }}
```

5. Apply Orbitron to the player name div (fontSize: '18px'):
```tsx
style={{ fontSize: '18px', fontWeight: 800, color: t.color, fontFamily: FONTS.orbitron }}
```

6. Apply Orbitron to the COMMIT button inner text — change the font on the button style:
```tsx
fontFamily: FONTS.orbitron,
```

The final return (outermost element) will look like:
```tsx
return (
  <ArenaBackdrop
    reducedMotion={reduced}
    accentA={playerKey === 'a' ? COLORS.green : COLORS.red}
    accentB={playerKey === 'a' ? COLORS.red : COLORS.green}
  >
    <div
      style={{
        color: COLORS.text,
        fontFamily: 'Inter, system-ui, sans-serif',
        padding: '0 16px 32px',
      }}
    >
      <div style={{ maxWidth: '420px', margin: '0 auto', paddingTop: '24px' }}>
        {/* ... all existing inner content unchanged ... */}
      </div>
    </div>
  </ArenaBackdrop>
)
```

- [ ] **Step 2: Update RevealScreen.tsx to use ArenaBackdrop, apply fonts, and enhance flip**

In `RevealScreen.tsx`:

1. Add these imports at top (after existing):
```tsx
import { ArenaBackdrop } from '../components/ArenaBackdrop'
import { FrontSigil } from '../components/FrontSigil'
import { FONTS } from '../theme'
```

2. Remove the `icon` field from the `FRONTS` constant (it used emoji) — update to:
```tsx
const FRONTS: { key: FrontKey; label: string }[] = [
  { key: 'apertura', label: 'Apertura' },
  { key: 'choque',   label: 'Choque'   },
  { key: 'remate',   label: 'Remate'   },
]
```

3. Replace `{f.icon} {f.label}` references with:
- In `faceContent`: `<span style={{ display:'flex', alignItems:'center', gap:'6px', fontWeight:600, fontSize:'13px' }}><FrontSigil front={f.key} color={isRevealed ? tag.color : COLORS.muted} size={16} glow={isRevealed && !reduced} />{f.label}</span>`
- In `backContent`: same structure but color always `COLORS.muted`, glow `false`

4. In the FlipCard `transition` prop, add a "slam-down" feel using spring physics:
```tsx
// In FlipCard usage, pass a custom transition for a snappier reveal:
// (FlipCard already accepts `delay` prop which we keep as-is)
```
Actually, the slam-down effect is best added inside `FlipCard.tsx` itself — we'll update FlipCard in the next task step. For now, also add a post-reveal "impact shake" by wrapping `faceContent` in a motion.div that shakes when `isRevealed`:
```tsx
// Wrap faceContent in:
const faceWithShake = (
  <motion.div
    animate={isRevealed && !reduced && w !== 'disputed'
      ? { x: [0, -4, 4, -3, 3, 0] }
      : undefined
    }
    transition={{ duration: 0.3, delay: 0.38 }}
  >
    {faceContent}
  </motion.div>
)
// Then pass faceWithShake as the `front` prop to FlipCard
```

5. Add spotlight pulse overlay on the winning front row: wrap each `<div key={f.key}>` in a `<div style={{ position: 'relative' }}>` and after FlipCard, add:
```tsx
{isRevealed && w !== 'disputed' && !reduced && (
  <motion.div
    initial={{ opacity: 0.6 }}
    animate={{ opacity: 0 }}
    transition={{ duration: 0.8 }}
    style={{
      position: 'absolute',
      inset: 0,
      borderRadius: '8px',
      background: `radial-gradient(ellipse at center, ${tag.color}33 0%, transparent 70%)`,
      pointerEvents: 'none',
    }}
  />
)}
```

6. Apply Orbitron to the big round-winner text and the "REVEAL" label:
```tsx
// "REVEAL" label:
style={{ fontSize: '11px', color: COLORS.muted, letterSpacing: '.06em', marginBottom: '2px', fontFamily: FONTS.mono }}
// "Resultados de la ronda" heading:
style={{ fontSize: '22px', fontWeight: 800, fontFamily: FONTS.orbitron }}
// Winner name in banner:
style={{ fontSize: '20px', fontWeight: 800, color: roundWinTag.color, fontFamily: FONTS.orbitron }}
```

7. Apply Orbitron to the numeric alloc values (the big `{allocA[f.key]}` / `{allocB[f.key]}`):
```tsx
style={{ ..., fontFamily: FONTS.orbitron }}
```

8. Wrap the outermost div with `<ArenaBackdrop reducedMotion={reduced}>` similar to AllocationScreen.

- [ ] **Step 3: Verify TypeScript clean**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 4: Run tests**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npm run test
```
Expected: `Tests  81 passed (81)`.

- [ ] **Step 5: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add src/ui/screens/AllocationScreen.tsx src/ui/screens/RevealScreen.tsx
git commit -m "feat(ui): ArenaBackdrop + FrontSigil + fonts on Allocation/Reveal screens; impact shake + spotlight"
```

---

## Task 9: Enhance FlipCard — slam-down + spring physics

**Files:**
- Modify: `src/ui/components/FlipCard.tsx`

- [ ] **Step 1: Update FlipCard.tsx with improved spring transition and STAGGER_MS update**

Replace the `transition` inside the `<motion.div>` in FlipCard to use spring physics with a pronounced snap:

```tsx
transition={
  flipped
    ? { type: 'spring', stiffness: 420, damping: 30, delay }
    : { duration: 0.2, delay, ease: 'easeIn' }
}
```

This makes the front-face land with a springy "slam" and the back-reveal is a quick ease-in. No other changes to the file.

Full updated `FlipCard.tsx`:

```tsx
import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

interface Props {
  /** When true the card shows its face; when false it shows its back. */
  flipped: boolean
  back: ReactNode
  front: ReactNode
  /** Skip the 3D rotation (reduced motion). */
  reducedMotion?: boolean
  delay?: number
  minHeight?: number | string
}

/** 3D card flip via CSS rotateY + perspective. No assets. Spring slam-down on reveal. */
export function FlipCard({ flipped, back, front, reducedMotion = false, delay = 0, minHeight = 56 }: Props) {
  if (reducedMotion) {
    return <div style={{ minHeight }}>{flipped ? front : back}</div>
  }

  return (
    <div style={{ perspective: 800, minHeight }}>
      <motion.div
        initial={false}
        animate={{ rotateY: flipped ? 0 : 180 }}
        transition={
          flipped
            ? { type: 'spring', stiffness: 420, damping: 30, delay }
            : { duration: 0.2, delay, ease: 'easeIn' }
        }
        style={{
          position: 'relative',
          width: '100%',
          minHeight,
          transformStyle: 'preserve-3d',
        }}
      >
        {/* Face */}
        <div
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
          }}
        >
          {front}
        </div>
        {/* Back */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: 'rotateY(180deg)',
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
          }}
        >
          {back}
        </div>
      </motion.div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript clean**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add src/ui/components/FlipCard.tsx
git commit -m "feat(ui): FlipCard spring slam-down transition on reveal"
```

---

## Task 10: ResultScreen — winner glow/pulse, Orbitron titles

**Files:**
- Modify: `src/ui/screens/ResultScreen.tsx`

- [ ] **Step 1: Update ResultScreen.tsx**

1. Add import for `FONTS`:
```tsx
import { COLORS, FONTS } from '../theme'
```

2. Replace the trophy/medal emoji icons with SVG equivalents — add these inline SVGs as tiny helper components at the top of the file (before the component function):

```tsx
function TrophySvg() {
  return (
    <svg width="52" height="52" viewBox="0 0 24 24" fill="none"
      stroke="#f59e0b" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M8 21h8M12 17v4M17 3h3a1 1 0 0 1 1 1v1a4 4 0 0 1-4 4h-.18" />
      <path d="M7 3H4a1 1 0 0 0-1 1v1a4 4 0 0 0 4 4H7" />
      <path d="M12 17a5 5 0 0 0 5-5V3H7v9a5 5 0 0 0 5 5Z" />
    </svg>
  )
}

function MedalSvg() {
  return (
    <svg width="52" height="52" viewBox="0 0 24 24" fill="none"
      stroke="#7c89a8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <circle cx="12" cy="14" r="6" />
      <path d="M8 2h8l-2 6H10L8 2Z" />
      <line x1="12" y1="11" x2="12" y2="17" />
    </svg>
  )
}
```

3. Replace the `<motion.div ... style={{ fontSize: '52px', ... }}>` that renders `{celebrate ? '🏆' : '🥈'}` with:
```tsx
<motion.div
  initial={reduced ? false : { scale: 0, rotate: -25 }}
  animate={{ scale: 1, rotate: 0 }}
  transition={{ type: 'spring', stiffness: 240, damping: 12, delay: reduced ? 0 : 0.15 }}
  style={{ marginBottom: '12px', display: 'flex', justifyContent: 'center' }}
>
  {celebrate ? <TrophySvg /> : <MedalSvg />}
</motion.div>
```

4. Apply Orbitron to the winner label:
```tsx
style={{ fontSize: '26px', fontWeight: 800, color: accent, marginBottom: '32px', lineHeight: 1.2, fontFamily: FONTS.orbitron }}
```

5. Apply Mono to the "RESULTADO FINAL" label:
```tsx
style={{ fontSize: '11px', color: COLORS.muted, letterSpacing: '.08em', marginBottom: '8px', fontFamily: FONTS.mono }}
```

6. Add a pulsing glow animation to the outer panel when `celebrate` is true — wrap the existing `motion.div` panel in a `motion.div` with `animate` for glow:
```tsx
// Add to the panel motion.div's animate prop:
animate={
  celebrate && !reduced
    ? {
        boxShadow: [
          `0 0 32px ${COLORS.green}33`,
          `0 0 48px ${COLORS.green}66`,
          `0 0 32px ${COLORS.green}33`,
        ],
      }
    : { boxShadow: 'none' }
}
transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
```

- [ ] **Step 2: Verify TypeScript clean**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 3: Run tests**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npm run test
```
Expected: `Tests  81 passed (81)`.

- [ ] **Step 4: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add src/ui/screens/ResultScreen.tsx
git commit -m "feat(ui): ResultScreen SVG icons, Orbitron title, winner glow pulse"
```

---

## Task 11: Wire VsIntro in App.tsx + font tokens on SetupScreen + ModeSelect

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/ui/screens/SetupScreen.tsx`
- Modify: `src/mode/ModeSelect.tsx`

- [ ] **Step 1: Wire VsIntro in App.tsx**

1. Add import for `VsIntro` at top of `App.tsx`:
```tsx
import { VsIntro } from './ui/components/VsIntro'
```

2. Add state for `showVsIntro` near the other offline state:
```tsx
const [showVsIntro, setShowVsIntro] = useState(false)
```

3. In the `start()` function, after `setOfflineScreen('allocateA')`, show the VsIntro:
```tsx
function start(s: Setup) {
  try {
    const cardA = MOCK_CARDS.find((c) => c.id === s.cardAId)!
    const cardB = MOCK_CARDS.find((c) => c.id === s.cardBId)!
    const st = createMatch(cardA, cardB, { ...DEFAULT_CONFIG, mode: s.mode, edgeEnabled: s.edgeEnabled })
    setSetup(s); setState(st); setError(undefined)
    setShowVsIntro(true)         // ← added
    setOfflineScreen('allocateA')
  } catch (e) {
    setError((e as Error).message)
  }
}
```

4. In the offline flow render block (just before the `<>` fragment that wraps `<MuteButton />` and `<AnimatePresence>`), add the VsIntro overlay:
```tsx
if (appMode === 'offline') {
  return (
    <>
      <MuteButton />
      {showVsIntro && state && (
        <VsIntro
          cardA={state.cardA}
          cardB={state.cardB}
          reducedMotion={reduced}
          onDone={() => setShowVsIntro(false)}
        />
      )}
      <AnimatePresence mode="wait">
        <motion.div
          key={offlineScreen}
          variants={variants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{ duration: reduced ? 0 : 0.28, ease: 'easeInOut' }}
        >
          {renderOfflineScreen()}
        </motion.div>
      </AnimatePresence>
    </>
  )
}
```

- [ ] **Step 2: Apply Orbitron to SetupScreen title**

In `SetupScreen.tsx`, add import for `FONTS`:
```tsx
import { COLORS, formatUsd, FONTS } from '../theme'
```

Find the title `⚡ TCG Battle Arena` div and update its style:
```tsx
style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '-0.5px', color: COLORS.green, fontFamily: FONTS.orbitron }}
```

Also add `fontFamily: FONTS.mono` to the `fontSize: '12px', color: COLORS.muted` subtitle below it.

- [ ] **Step 3: Apply Orbitron to ModeSelect title**

In `src/mode/ModeSelect.tsx`, add import for `FONTS`:
```tsx
import { COLORS, FONTS } from '../ui/theme'
```

Find the `⚡ TCG Battle Arena` div and update:
```tsx
style={{
  fontSize: '30px',
  fontWeight: 800,
  letterSpacing: '-0.5px',
  color: COLORS.green,
  marginBottom: '8px',
  fontFamily: FONTS.orbitron,
}}
```

Also update the subtitle:
```tsx
style={{ fontSize: '13px', color: COLORS.muted, fontFamily: FONTS.mono }}
```

- [ ] **Step 4: Apply EnergyHeader font tokens**

In `src/ui/components/EnergyHeader.tsx`, add import for `FONTS`:
```tsx
import { COLORS, FONTS } from '../theme'
```

Apply to the three big number divs:
```tsx
// All three big number spans (DISPONIBLE, SIN ASIGNAR, RONDAS):
style={{ fontSize: '22px', fontWeight: 800, color: playerColor, lineHeight: 1, fontFamily: FONTS.orbitron }}
// Column headers (DISPONIBLE, SIN ASIGNAR, RONDAS labels):
style={{ fontSize: '9px', color: COLORS.muted, letterSpacing: '.06em', marginBottom: '2px', fontFamily: FONTS.mono }}
// Breakdown text:
style={{ fontSize: '9px', color: COLORS.muted, marginTop: '2px', fontFamily: FONTS.mono }}
```

- [ ] **Step 5: Verify TypeScript clean**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 6: Run tests**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npm run test
```
Expected: `Tests  81 passed (81)`.

- [ ] **Step 7: Build check**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npm run build 2>&1 | tail -8
```
Expected: successful build, no errors.

- [ ] **Step 8: Confirm engine/bot/instrumentation untouched**

```bash
cd /Users/mauro/Desarrollos/BattleArena && git diff master..HEAD --name-only | grep -E 'engine|bot|instrumentation'
```
Expected: empty output (no lines).

- [ ] **Step 9: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add src/App.tsx src/ui/screens/SetupScreen.tsx src/mode/ModeSelect.tsx \
        src/ui/components/EnergyHeader.tsx
git commit -m "feat(ui): VsIntro wired to offline start; Orbitron/Mono on titles, headers, numbers"
```

---

## Task 12: Final verification pass

This task has no code changes — it is a verification-only gate.

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npm run test
```
Expected: `Tests  81 passed (81)`.

- [ ] **Step 2: TypeScript clean**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 3: Production build**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npm run build 2>&1 | tail -10
```
Expected: successful build.

- [ ] **Step 4: Engine / bot / instrumentation untouched**

```bash
cd /Users/mauro/Desarrollos/BattleArena && git diff master..HEAD --name-only | grep -E 'engine|bot|instrumentation'
```
Expected: empty.

- [ ] **Step 5: Mobile overflow check**

```bash
cd /Users/mauro/Desarrollos/BattleArena && npx tsc --noEmit && echo "OK — check 375px width in browser DevTools, no horizontal scroll on AllocationScreen, RevealScreen, VsIntro"
```

- [ ] **Step 6: Summarize new components and usages**

All new components:
- `src/ui/components/CardSlab.tsx` — used by `PlayerCard` (all screens with `PlayerCard`), directly in `VsIntro`
- `src/ui/components/FrontSigil.tsx` — used by `EnergyAllocator`, `RevealScreen`
- `src/ui/components/ArenaBackdrop.tsx` — used by `AllocationScreen`, `RevealScreen`
- `src/ui/components/VsIntro.tsx` — used by `App.tsx` (fires at offline battle start)

---

## Self-Review Checklist

### Spec coverage
| Requirement | Task |
|-------------|------|
| Orbitron headings/big numbers | Task 1, 5, 8, 9, 10, 11 |
| JetBrains Mono labels/tabular | Task 1, 5, 8, 10, 11 |
| CardSlab with imageUrl prop | Task 3 |
| PlayerCard uses CardSlab | Task 4 |
| FrontSigil emblems (SVG) | Task 2 |
| FrontSigil replaces emoji in allocator | Task 5 |
| FrontSigil replaces emoji in reveal | Task 8 |
| EnergyOrbs (radial-gradient, pulse) | Task 5 |
| ArenaBackdrop (parallax, particle, reduced-motion) | Task 6, 8 |
| VsIntro (slab clash, skip, auto-dismiss, reduced-motion) | Task 7, 11 |
| FlipCard slam-down spring | Task 9 |
| RevealScreen impact shake + spotlight pulse | Task 8 |
| Commit lock flourish | Handled via existing `committing` scale animation in AllocationScreen (already present in original; font/slab upgrade sufficient for this pass) |
| ResultScreen winner glow pulse | Task 10 |
| SVG result icons (no emoji) | Task 10 |
| Engine/bot/instrumentation untouched | Task 12 |
| 81 tests green throughout | Each task |
| tsc clean throughout | Each task |
| Mobile-first, no 375px overflow | ArenaBackdrop uses `fixed` not `absolute` for layers; VsIntro uses maxWidth 380px; Task 12 |
| Reduced-motion fallbacks everywhere | Each animated component |
| Touch targets ≥44px | Preserved from original; EnergyOrb/FrontSigil don't change button sizes |

### Placeholder scan
No TBD, TODO, or "similar to Task N" patterns — all code blocks are complete.

### Type consistency
- `FrontKey` from `../../engine` used consistently across `FrontSigil`, `EnergyAllocator`
- `Card` from `../../engine` used in `VsIntro`
- `FONTS` exported from `src/ui/theme` and imported identically in all tasks
- `CardSlab` props (`name`, `gradeCompany`, `grade`, `cert`, `accentColor`, `variant`, `sheen`) used consistently in `PlayerCard` and `VsIntro`
- `ArenaBackdrop` props (`children`, `reducedMotion`, `accentA`, `accentB`) consistent in both screen usages
