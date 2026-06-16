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
            sin asignar <strong style={{ color: accentColor, fontSize: '13px', fontFamily: FONTS.display }}>{pool}</strong> · se banca
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
                    fontFamily: FONTS.display,
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
