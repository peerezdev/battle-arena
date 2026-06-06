import { useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Allocation, FrontKey } from '../../engine'
import { COLORS } from '../theme'
import { playSfx, haptic } from '../sound'

interface Props {
  alloc: Allocation
  /** Total energy available this round. */
  available: number
  onChange: (a: Allocation) => void
  accentColor: string
  reducedMotion: boolean
}

const FRONTS: { key: FrontKey; label: string; icon: string }[] = [
  { key: 'apertura', label: 'Apertura', icon: '⚔️' },
  { key: 'choque', label: 'Choque', icon: '💥' },
  { key: 'remate', label: 'Remate', icon: '🎯' },
]

/** A glowing energy pip. `layoutId` lets framer-motion fly it pool <-> front. */
function Pip({ id, color, reduced }: { id: string; color: string; reduced: boolean }) {
  return (
    <motion.span
      layout={!reduced}
      layoutId={reduced ? undefined : id}
      initial={false}
      transition={{ type: 'spring', stiffness: 600, damping: 34 }}
      style={{
        width: 14,
        height: 14,
        borderRadius: '50%',
        background: color,
        boxShadow: `0 0 6px ${color}`,
        display: 'inline-block',
        flex: '0 0 auto',
      }}
    />
  )
}

export function EnergyAllocator({ alloc, available, onChange, accentColor, reducedMotion }: Props) {
  const spent = alloc.apertura + alloc.choque + alloc.remate
  const pool = available - spent

  // Stable per-token ids so framer-motion can animate the same node moving
  // between the pool and a front (shared layoutId).
  const ids = useMemo(
    () => Array.from({ length: available }, (_, i) => `pip-${i}`),
    [available],
  )

  // Deterministic assignment of token ids: first `pool` ids stay in pool,
  // then apertura, choque, remate consume the rest in order.
  const poolEnd = pool
  const aEnd = poolEnd + alloc.apertura
  const cEnd = aEnd + alloc.choque
  const rEnd = cEnd + alloc.remate
  const poolIds = ids.slice(0, poolEnd)
  const frontIds: Record<FrontKey, string[]> = {
    apertura: ids.slice(poolEnd, aEnd),
    choque: ids.slice(aEnd, cEnd),
    remate: ids.slice(cEnd, rEnd),
  }

  function add(key: FrontKey) {
    if (pool <= 0) return
    onChange({ ...alloc, [key]: alloc[key] + 1 })
    playSfx('tick')
    haptic(8)
  }

  function remove(key: FrontKey) {
    if (alloc[key] <= 0) return
    onChange({ ...alloc, [key]: alloc[key] - 1 })
    playSfx('tick')
    haptic(8)
  }

  return (
    <div>
      {/* Energy pool — labeled "se banca" (unspent carries over). */}
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
          <span style={{ fontSize: '11px', color: COLORS.muted, letterSpacing: '.06em' }}>
            ENERGÍA DISPONIBLE
          </span>
          <span style={{ fontSize: '11px', color: COLORS.muted }}>
            sin asignar <strong style={{ color: accentColor, fontSize: '13px' }}>{pool}</strong> · se banca
          </span>
        </div>
        <motion.div
          layout={!reducedMotion}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '7px',
            minHeight: '14px',
            alignItems: 'center',
          }}
        >
          <AnimatePresence>
            {poolIds.map((id) => (
              <Pip key={id} id={id} color={accentColor} reduced={reducedMotion} />
            ))}
          </AnimatePresence>
          {pool === 0 && (
            <span style={{ fontSize: '11px', color: COLORS.muted, fontStyle: 'italic' }}>
              Sin energía en reserva
            </span>
          )}
        </motion.div>
      </div>

      {/* Three tappable front zones. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
        {FRONTS.map((f) => {
          const value = alloc[f.key]
          const disabledAdd = pool <= 0
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
                  <span style={{ fontSize: '22px' }}>{f.icon}</span>
                  <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '15px', fontWeight: 700 }}>{f.label}</span>
                    <span style={{ fontSize: '10px', color: COLORS.muted }}>
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
                  disabled={value <= 0}
                  aria-label={`Quitar 1 energía de ${f.label}`}
                  style={{
                    width: '44px',
                    height: '44px',
                    flex: '0 0 auto',
                    borderRadius: '10px',
                    background: COLORS.bg,
                    border: `1px solid ${COLORS.border}`,
                    color: value <= 0 ? COLORS.border : COLORS.text,
                    fontSize: '24px',
                    fontWeight: 700,
                    cursor: value <= 0 ? 'default' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  −
                </button>
              </div>

              {/* Pips currently allocated to this front. */}
              {value > 0 && (
                <motion.div
                  layout={!reducedMotion}
                  style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}
                >
                  <AnimatePresence>
                    {frontIds[f.key].map((id) => (
                      <Pip key={id} id={id} color={accentColor} reduced={reducedMotion} />
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
