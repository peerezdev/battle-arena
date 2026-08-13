import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { COLORS, FONTS, RARITY, SHADOW, GRADIENT, formatUsd } from '../../theme'
import { useReducedMotion } from '../../useReducedMotion'
import { useIsWide } from '../../useIsWide'
import type { GachaMachine } from '../../../onchain/gachaClient'
import { yoloTotalCost, clampCount } from '../../../onchain/gachaClient'
import { showToast, dismissToast, setToastInset } from '../../toastBus'
import { tiradasGratis } from './freeSpins'

interface Props {
  machine: GachaMachine
  /** Logged in (identity token present). */
  authed: boolean
  /** Embedded-wallet USDC balance; null = unknown/still loading. */
  usdc: number | null
  /** Open `count` packs at once (YOLO); optional turbo (auto-sell Commons). */
  onYolo?: (count: number, turbo: boolean) => void
  /** Puntos de CC del jugador. Solo eso: cuántas tiradas dan depende del precio de ESTA máquina,
   *  y se calcula aquí. Sin él no se pinta el botón: es un extra, no una pieza del flujo. */
  freeSpins?: { points_available: number } | null
  /** Por qué no hay puntos, si es que han fallado. Sin esto, un fallo se ve igual que "esta
   *  máquina no da tiradas gratis": la pantalla vacía y el jugador sin saber qué hacer. */
  freeSpinsError?: 'sesion' | 'no_disponible' | 'fallo' | null
  onFreePack?: () => void
}

/** Qué se le dice al jugador cuando no se han podido leer sus puntos. Cada uno dice qué pasa Y qué
 *  hacer: el único que se arregla reintentando es el último. */
const FREE_SPINS_ERROR_MSG: Record<'sesion' | 'no_disponible' | 'fallo', string> = {
  sesion: 'Log in again to see your free spins.',
  no_disponible: 'Free spins are unavailable right now.',
  fallo: 'Could not load your points. Try again in a moment.',
}

const RARITY_ORDER = ['epic', 'rare', 'uncommon', 'common'] as const
const RARITY_COLOR: Record<string, string> = {
  Epic: RARITY.epic,   epic: RARITY.epic,
  Rare: RARITY.rare,   rare: RARITY.rare,
  Uncommon: RARITY.uncommon, uncommon: RARITY.uncommon,
  Common: RARITY.common, common: RARITY.common,
}

const TURBO_ON_MSG = 'Turbo activated — Commons will be auto-sold'

export function MachineDetailPanel({ machine, authed, usdc, onYolo, freeSpins, freeSpinsError, onFreePack }: Props) {
  const reduced = useReducedMotion()
  // Lo que dan esos puntos EN ESTA máquina. Cambia con el precio, así que se recalcula por máquina
  // y no se puede leer de la respuesta de CC, que viene siempre en la escala de la de 50 $.
  const gratis = tiradasGratis(machine.price, freeSpins?.points_available ?? 0)
  const mobile = !useIsWide('(min-width: 760px)')   // bottom nav shows below 760 → use a sticky bar

  const [yoloCount, setYoloCount] = useState(1)
  const [turbo, setTurbo] = useState(false)
  // Id del aviso del turbo, para poder retirarlo si se apaga antes de que expire.
  const turboToast = useRef<number | null>(null)
  // La barra de acciones tapa la parte de abajo, así que se mide y se declara para que los
  // toasts salgan POR ENCIMA de ella. Se mide en vez de codificar su alto: cambia con el
  // safe-area del móvil y con el tamaño de fuente del sistema.
  const barRef = useRef<HTMLDivElement | null>(null)

  const showBar = !!onYolo && mobile && machine.turboMode !== undefined
  useEffect(() => {
    const bar = barRef.current
    if (!bar) { setToastInset(0); return }
    const apply = () => setToastInset(Math.round(bar.getBoundingClientRect().height))
    apply()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null
    ro?.observe(bar)
    // Al salir de la pantalla se devuelve el hueco: si no, los toasts de otras pantallas
    // seguirían flotando donde ya no hay barra.
    return () => { ro?.disconnect(); setToastInset(0) }
  }, [showBar])
  const yoloTotal = yoloTotalCost(machine.price ?? 0, yoloCount)
  const yoloBlocked = !authed || machine.available === false || (usdc != null && usdc < yoloTotal)
  const openLabel = !authed ? 'Log in to open'
    : machine.available === false ? 'Currently unavailable'
    : (usdc != null && usdc < yoloTotal) ? `Insufficient USDC · ${formatUsd(usdc ?? 0)}`
    : `Open ×${yoloCount} · ${formatUsd(yoloTotal)}`

  const unavailable = machine.available === false

  // Sort odds with the canonical order; unknown rarities go last
  const oddsEntries = Object.entries(machine.odds ?? {}).sort(([a], [b]) => {
    const ia = RARITY_ORDER.indexOf(a.toLowerCase() as typeof RARITY_ORDER[number])
    const ib = RARITY_ORDER.indexOf(b.toLowerCase() as typeof RARITY_ORDER[number])
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })

  const totalOdds = oddsEntries.reduce((sum, [, v]) => sum + (v ?? 0), 0)

  return (
    <div
      style={{
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 14,
        padding: '24px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        // En escritorio el panel se estrecha al 90% de su columna y se centra. La imagen sigue
        // llenando el interior, así que el conjunto ocupa ese 90% sin dejar panel sobrante
        // alrededor de la imagen. En móvil se mantiene a ancho completo: ahí el espacio escasea.
        ...(mobile ? null : { width: '90%', margin: '0 auto' }),
      }}
    >
      {/* Pack image */}
      <div
        style={{
          width: '100%',
          aspectRatio: '1/1',
          background: COLORS.panel2,
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          border: `1px solid ${COLORS.border}`,
        }}
      >
        {machine.videoSrc ? (
          <video
            // La key fuerza a React a crear un <video> NUEVO al cambiar de máquina. Sin ella
            // reutiliza el nodo y solo reescribe el `src` del <source> — cosa que el navegador
            // ignora: un vídeo no recarga por eso, hay que remontarlo o llamar a load(). El
            // resultado era que todas las máquinas enseñaban el vídeo de la primera que se cargó,
            // la seleccionada por defecto (pokemon_50 en mainnet, el primero que devuelve CC).
            key={machine.videoSrc}
            poster={machine.thumbnailUrl ?? machine.image ?? undefined}
            autoPlay
            loop
            muted
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 10 }}
          >
            <source src={machine.videoSrc} type="video/webm" />
            {machine.videoHevc && <source src={machine.videoHevc} type="video/mp4" />}
          </video>
        ) : machine.thumbnailUrl || machine.image ? (
          <img
            src={(machine.thumbnailUrl ?? machine.image)!}
            alt={machine.name}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        ) : (
          <span style={{ fontSize: 64 }}>🎰</span>
        )}
      </div>

      {/* Pack name */}
      <div>
        <div
          style={{
            fontFamily: FONTS.display,
            fontWeight: 800,
            fontSize: 20,
            color: COLORS.text,
          }}
        >
          {machine.name}
        </div>
      </div>

      {/* EV + Price */}
      <div style={{ display: 'flex', gap: 14 }}>
        <div
          style={{
            flex: 1,
            background: COLORS.panel2,
            borderRadius: 10,
            padding: '12px 14px',
            border: `1px solid ${COLORS.border}`,
          }}
        >
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 10,
              color: COLORS.muted,
              letterSpacing: '.07em',
              marginBottom: 4,
              textTransform: 'uppercase',
            }}
          >
            EXPECTED VALUE
          </div>
          <div
            style={{
              fontFamily: FONTS.display,
              fontWeight: 800,
              fontSize: 18,
              color: COLORS.green,
            }}
          >
            {machine.ev != null ? `$${machine.ev.toFixed(2)}` : '—'}
          </div>
        </div>
        <div
          style={{
            flex: 1,
            background: COLORS.panel2,
            borderRadius: 10,
            padding: '12px 14px',
            border: `1px solid ${COLORS.border}`,
          }}
        >
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 10,
              color: COLORS.muted,
              letterSpacing: '.07em',
              marginBottom: 4,
              textTransform: 'uppercase',
            }}
          >
            PRICE
          </div>
          <div
            style={{
              fontFamily: FONTS.display,
              fontWeight: 800,
              fontSize: 18,
              color: COLORS.text,
            }}
          >
            {formatUsd(machine.price)}
          </div>
        </div>
      </div>

      {/* Unavailability reason */}
      {unavailable && (
        <div
          style={{
            textAlign: 'center',
            fontFamily: FONTS.mono,
            fontSize: 12,
            color: COLORS.muted,
          }}
        >
          ⚠ This machine is currently off — try another pack.
        </div>
      )}

      {onYolo && !mobile && (
        <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.1em', color: COLORS.muted, textTransform: 'uppercase' }}>Open multiple</div>

          {/* Stepper + presets */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => setYoloCount((n) => clampCount(n - 1))} aria-label="Less"
                style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${COLORS.border}`, background: COLORS.panel2, color: COLORS.text, cursor: 'pointer', fontSize: 18 }}>−</button>
              <span style={{ minWidth: 28, textAlign: 'center', fontFamily: FONTS.display, fontWeight: 800, fontSize: 18, color: COLORS.text }}>{yoloCount}</span>
              <button onClick={() => setYoloCount((n) => clampCount(n + 1))} aria-label="More"
                style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${COLORS.border}`, background: COLORS.panel2, color: COLORS.text, cursor: 'pointer', fontSize: 18 }}>+</button>
            </div>
            {[3, 5, 10].map((p) => (
              <button key={p} onClick={() => setYoloCount(p)}
                style={{ padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
                  border: `1px solid ${yoloCount === p ? COLORS.green : COLORS.border}`,
                  background: yoloCount === p ? COLORS.panel2 : 'transparent',
                  color: yoloCount === p ? COLORS.green : COLORS.muted, fontFamily: FONTS.mono, fontSize: 12 }}>x{p}</button>
            ))}
          </div>

          {/* Turbo toggle — only if the machine supports it */}
          {machine.turboMode && (
            <button onClick={() => setTurbo((t) => !t)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 10, cursor: 'pointer',
                border: `1px solid ${turbo ? COLORS.green : COLORS.border}`, background: turbo ? COLORS.panel2 : 'transparent', color: COLORS.text }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>⚡ Turbo (auto-sell Commons)</span>
              <span style={{ fontFamily: FONTS.mono, fontSize: 12, color: turbo ? COLORS.green : COLORS.muted }}>{turbo ? 'ON' : 'OFF'}</span>
            </button>
          )}

          {/* Open ×N */}
          <motion.button
            onClick={() => onYolo(yoloCount, machine.turboMode ? turbo : false)}
            disabled={yoloBlocked}
            whileTap={reduced || yoloBlocked ? undefined : { scale: 0.97 }}
            style={{ width: '100%', borderRadius: 12, padding: '13px 18px', fontSize: 14, fontWeight: 800, fontFamily: FONTS.display, cursor: yoloBlocked ? 'not-allowed' : 'pointer',
              border: yoloBlocked ? `1px solid ${COLORS.border}` : 'none', background: yoloBlocked ? COLORS.panel2 : GRADIENT, color: yoloBlocked ? COLORS.muted : '#06120c' }}>
            {openLabel}
          </motion.button>

          {/* Tirada gratis. Dos condiciones, y las dos son de la MÁQUINA, no del jugador: que esta
              la ofrezca (`machine.freeSpins` — muchas no) y que sus puntos lleguen a lo que cuesta
              AQUÍ, que sube con el precio. Con puntos de sobra para la de 50 $ puede no haber ni
              para una en la de 250 $.

              Cuando no llega se dice en texto en vez de un botón apagado: un botón que no se puede
              pulsar invita a mirar los puntos, no a jugar. */}
          {/* Si los puntos NO se pudieron leer, se dice. Callarlo era el bug: la máquina ofrece
              tiradas gratis, el jugador tiene puntos, y la pantalla no enseñaba ni una cosa ni la
              otra porque el dato venía nulo. */}
          {onFreePack && !freeSpins && freeSpinsError && machine.freeSpins && (
            <div style={{ marginTop: 10, textAlign: 'center', fontFamily: FONTS.mono, fontSize: 11, color: COLORS.muted }}>
              {FREE_SPINS_ERROR_MSG[freeSpinsError]}
            </div>
          )}

          {onFreePack && freeSpins && machine.freeSpins && (
            gratis.count > 0 ? (
              <button
                onClick={onFreePack}
                style={{ width: '100%', marginTop: 10, borderRadius: 12, padding: '11px 18px',
                  fontSize: 13.5, fontWeight: 800, fontFamily: FONTS.display, cursor: 'pointer',
                  border: `1px solid ${COLORS.green}66`, background: `${COLORS.green}14`, color: COLORS.green }}>
                ★ Free pack · {gratis.count} left
              </button>
            ) : (
              <div style={{ marginTop: 10, textAlign: 'center', fontFamily: FONTS.mono, fontSize: 11, color: COLORS.muted }}>
                {gratis.untilNext.toLocaleString('en-US')} points to a free pack here
              </div>
            )
          )}
        </div>
      )}

      {/* Mobile: sticky action bar above the bottom nav (Open + turbo + counter), always on screen */}
      {onYolo && mobile && (
          <div ref={barRef} style={{
            position: 'fixed', left: 0, right: 0, bottom: 60, zIndex: 90,
            display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px calc(10px + env(safe-area-inset-bottom,0px))',
            background: 'rgba(10,13,20,.96)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderTop: `1px solid ${COLORS.border}`,
          }}>
            {/* counter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: 3, borderRadius: 11, background: COLORS.panel2, border: `1px solid ${COLORS.border}`, flexShrink: 0 }}>
              <button onClick={() => setYoloCount((n) => clampCount(n - 1))} aria-label="Less"
                style={{ width: 30, height: 30, borderRadius: 8, border: 0, background: 'transparent', color: COLORS.text, cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>−</button>
              <span style={{ minWidth: 22, textAlign: 'center', fontFamily: FONTS.display, fontWeight: 800, fontSize: 16, color: COLORS.text }}>{yoloCount}</span>
              <button onClick={() => setYoloCount((n) => clampCount(n + 1))} aria-label="More"
                style={{ width: 30, height: 30, borderRadius: 8, border: 0, background: 'transparent', color: COLORS.text, cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>+</button>
            </div>
            {/* turbo toggle (only if supported) */}
            {machine.turboMode && (
              // En móvil el botón es solo un ⚡ sin etiqueta —no cabe la del escritorio—, así que
              // al encenderlo se dice en un toast lo que acaba de activar. Al apagarlo no hace
              // falta: nadie necesita que le confirmen que ha vuelto a lo normal.
              // Fuera del updater de setState a propósito: React puede invocarlo dos veces y
              // saldrían dos toasts.
              <button onClick={() => {
                  const on = !turbo
                  setTurbo(on)
                  // Al apagar se retira el aviso: describe un estado, y ese estado ya no es cierto.
                  if (on) turboToast.current = showToast(TURBO_ON_MSG, 'success')
                  else { dismissToast(turboToast.current); turboToast.current = null }
                }}
                title="Turbo (auto-sell Commons)" aria-pressed={turbo}
                style={{ flexShrink: 0, width: 44, height: 36, borderRadius: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                  border: `1px solid ${turbo ? COLORS.green : COLORS.border}`, background: turbo ? 'rgba(0,255,196,.12)' : COLORS.panel2, color: turbo ? COLORS.green : COLORS.muted }}>⚡</button>
            )}
            {/* open */}
            <motion.button
              onClick={() => onYolo(yoloCount, machine.turboMode ? turbo : false)}
              disabled={yoloBlocked}
              whileTap={reduced || yoloBlocked ? undefined : { scale: 0.97 }}
              style={{ flex: 1, borderRadius: 12, padding: '12px 14px', fontSize: 14, fontWeight: 800, fontFamily: FONTS.display, cursor: yoloBlocked ? 'not-allowed' : 'pointer',
                border: yoloBlocked ? `1px solid ${COLORS.border}` : 'none', background: yoloBlocked ? COLORS.panel2 : GRADIENT, color: yoloBlocked ? COLORS.muted : '#06120c', whiteSpace: 'nowrap' }}>
              {openLabel}
            </motion.button>
          </div>
      )}

      {/* Buyback meta */}
      {machine.instantBuyback != null && (
        <div
          style={{
            fontFamily: FONTS.mono,
            fontSize: 11,
            color: COLORS.muted,
            letterSpacing: '.05em',
          }}
        >
          INSTANT BUYBACK · {machine.instantBuyback}% OF VALUE
        </div>
      )}

      {/* Odds bars */}
      {oddsEntries.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 10,
              color: COLORS.muted,
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              marginBottom: 2,
            }}
          >
            ODDS
          </div>
          {oddsEntries.map(([rarity, pct]) => {
            const accent = RARITY_COLOR[rarity] ?? COLORS.muted
            const width = totalOdds > 0 ? Math.round((pct / totalOdds) * 100) : pct
            const range = machine.tierRanges?.[rarity.toLowerCase()]
            return (
              <div key={rarity}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: 8,
                    marginBottom: 4,
                    fontFamily: FONTS.mono,
                    fontSize: 11,
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 7, minWidth: 0 }}>
                    <span style={{ color: accent, textTransform: 'capitalize', fontWeight: 700 }}>
                      {rarity.toLowerCase()}
                    </span>
                    {range && (
                      <span style={{ color: COLORS.muted, fontSize: 10 }} title="Card value range">
                        {formatUsd(range.start)}–{formatUsd(range.end)}
                      </span>
                    )}
                  </span>
                  <span style={{ color: COLORS.muted, flexShrink: 0 }}>{+(pct * 100).toFixed(2)}%</span>
                </div>
                <div
                  style={{
                    height: 5,
                    background: COLORS.panel2,
                    borderRadius: 3,
                    overflow: 'hidden',
                    border: `1px solid ${COLORS.border}`,
                  }}
                >
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(width, 100)}%` }}
                    transition={{ duration: reduced ? 0 : 0.5, ease: 'easeOut' }}
                    style={{
                      height: '100%',
                      background: accent,
                      borderRadius: 3,
                      boxShadow: SHADOW.glow(accent),
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
