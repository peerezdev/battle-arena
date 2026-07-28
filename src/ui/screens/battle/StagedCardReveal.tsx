import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { COLORS, FONTS, SHADOW } from '../../theme'
import { rarityColor } from './RevealCard'
import { CardBack } from './CardBack'
import { RarityBand } from './RarityBand'
import { STACK_T, BAND_T, EPIC_SPIN_DEG, FLIP_MS, bandRarity, bandColorFor } from './revealTiming'

type Stage = 'year' | 'grade' | 'rarity' | 'card'

/** Gacha-style staged reveal as a 3D flip card: during YEAR → GRADE → RARITY it shows the
 *  card back (rarity-glow) with the stage text on top; on the card stage it flips (rotateY)
 *  to the front (`children`). Reduced-motion shows the front immediately. `onCardShown` fires
 *  once the card stage lands.
 *
 *  `stacked` swaps the one-at-a-time text for the gacha's column: each value drops in under the
 *  previous one and STAYS, so the card is read as year + grade + rarity together before it flips.
 *  Off by default — Pack Battle's small cards have no room for three stacked rows. */
export function StagedCardReveal({
  year, grade, rarity, reduced, stepMs = 1700, dwellMs = 550, width = 180, height = 252,
  stacked = false, preloadSrc, onCardShown, children,
}: {
  year: string | null
  grade: number | string | null
  rarity: string | null
  reduced: boolean
  stepMs?: number
  dwellMs?: number    // how long the revealed card stays before onCardShown advances (ms)
  width?: number
  height?: number
  stacked?: boolean   // show year/grade/rarity as a persistent column instead of one at a time
  /** Imagen de la carta, para precargarla mientras corre la ceremonia (ver abajo). */
  preloadSrc?: string
  onCardShown?: () => void
  children: ReactNode
}) {
  const rc = rarityColor(rarity)

  const stages = useMemo<Stage[]>(() => {
    const s: Stage[] = []
    if (year) s.push('year')
    if (grade != null && grade !== '') s.push('grade')
    if (rarity) s.push('rarity')
    s.push('card')
    return s
  }, [year, grade, rarity])

  // Stacked rows, in the order they drop in. Same source as `stages`, minus the card step.
  const rows = useMemo(() => {
    const r: { key: string; value: string; color?: string }[] = []
    if (year) r.push({ key: 'Year', value: String(year) })
    if (grade != null && grade !== '') r.push({ key: 'Grade', value: String(grade) })
    if (rarity) r.push({ key: 'Rarity', value: rarity.toUpperCase(), color: rc })
    return r
  }, [year, grade, rarity, rc])

  const [i, setI] = useState(reduced ? stages.length - 1 : 0)
  const [shown, setShown] = useState(reduced ? rows.length : 0)   // stacked: how many rows are in
  const [flipped, setFlipped] = useState(reduced)                 // stacked: card turned over

  // Franja de rareza: solo Rare y Epic. `band` = null oculta · 'in' entra · 'out' se desvanece.
  const bandKey = bandRarity(rarity)
  const [band, setBand] = useState<null | 'in' | 'out'>(null)
  const [spinning, setSpinning] = useState(false)   // Epic: giro de varias vueltas acelerando

  /** Guion de la franja, común a los dos modos. `rarityAt` es cuándo se lee la rareza. */
  const bandSchedule = (rarityAt: number, at: (ms: number, fn: () => void) => void, land: () => void) => {
    at(rarityAt + BAND_T.band, () => setBand('in'))
    if (bandKey === 'epic') {
      // La franja se va AL RITMO del giro: las dos cosas arrancan en el mismo instante.
      at(rarityAt + BAND_T.epicSpin, () => { setSpinning(true); setBand('out') })
      at(rarityAt + BAND_T.epicLand, land)
    } else {
      at(rarityAt + BAND_T.rareFlip, () => { setBand('out'); land() })
    }
  }

  useEffect(() => {
    if (reduced || stacked) return
    if (i >= stages.length - 1) return
    // Con franja, el salto de la rareza a la carta lo manda el guion de la franja, no `stepMs`.
    if (bandKey && stages[i] === 'rarity') return
    const t = setTimeout(() => setI((n) => Math.min(n + 1, stages.length - 1)), stepMs)
    return () => clearTimeout(t)
  }, [i, stages, reduced, stacked, stepMs, bandKey])

  // Modo NO apilado (Pack Battle): la franja cuelga del momento en que se muestra la rareza.
  useEffect(() => {
    if (reduced || stacked || !bandKey) return
    if (stages[i] !== 'rarity') return
    const timers: ReturnType<typeof setTimeout>[] = []
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))
    bandSchedule(0, at, () => setI(stages.length - 1))
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, stages, reduced, stacked, bandKey])

  // Stacked schedule: drop each row in turn, hold the full column, then flip.
  useEffect(() => {
    if (!stacked || reduced) return
    const timers: ReturnType<typeof setTimeout>[] = []
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))
    // La rareza siempre es la última fila y se hace esperar un poco más: es la que remata.
    const rowAt = (k: number) =>
      STACK_T.first + k * STACK_T.step + (rows[k]?.key === 'Rarity' ? STACK_T.rarityExtra : 0)
    rows.forEach((_, k) => at(rowAt(k), () => setShown(k + 1)))
    const rarityAt = rowAt(Math.max(0, rows.length - 1))
    if (bandKey) bandSchedule(rarityAt, at, () => setFlipped(true))
    else at(rarityAt + STACK_T.hold, () => setFlipped(true))
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stacked, reduced, rows, bandKey])

  // La imagen se descargaba al montar la carta, o sea AL VOLTEAR: se veía el hueco vacío hasta
  // que llegaba. Aquí se pide durante el año/grado/rareza, que dura segundos, así que al voltear
  // ya está en caché del navegador. Si falla, RevealCard enseña su marcador — no hay que hacer nada.
  useEffect(() => {
    if (!preloadSrc) return
    const img = new Image()
    img.src = preloadSrc
  }, [preloadSrc])

  const stage = stages[i]
  const onCard = stacked ? flipped : stage === 'card'

  // The rarity color must land WITH the rarity text, not before. With AnimatePresence mode="wait"
  // the rarity text only mounts after the previous stage finishes exiting, so we flip the back color
  // when that text's enter animation STARTS (opacity === 1 distinguishes enter from exit).
  const [accentOn, setAccentOn] = useState(false)
  // Common stays like the neutral state — no rarity color, no strong beam.
  const isCommon = (rarity ?? '').toLowerCase() === 'common'
  // Stacked has no exit animation to hook, and rarity is always the last row in — so the back
  // lights up exactly when that row lands.
  const lit = stacked ? (!!rarity && shown >= rows.length) : accentOn
  const backAccent = lit && !isCommon ? rc : COLORS.muted

  useEffect(() => {
    if (!onCard) return
    // Fire AFTER the flip lands so totals/leaders update once the card is actually shown
    // (not while it's still flipping). Reduced motion fires synchronously.
    if (reduced) { onCardShown?.(); return }
    const t = setTimeout(() => onCardShown?.(), dwellMs)
    return () => clearTimeout(t)
    // Fire once when the card stage is reached; onCardShown identity intentionally ignored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCard])

  const stageValue = stage === 'year' ? year : stage === 'grade' ? grade : rarity

  // Stage text must fit the card on ONE line. Cards go down to ~76px wide on the mobile Pack
  // Battle grid, where fixed sizes wrapped mid-word ("UNCO / MMON"). Size from the text length
  // and the card width; the caps keep the original look on normal/desktop cards.
  // 0.72 = measured avg glyph width per font-size in the display face (~0.69), plus margin.
  const avail = Math.max(24, width - 16)
  const fitSize = (text: string, max: number) =>
    Math.max(9, Math.min(max, Math.floor(avail / (Math.max(1, text.length) * 0.72))))
  const valueSize = fitSize(String(stageValue ?? ''), stage === 'rarity' ? 20 : 34)

  return (
    <div style={{ width, height, perspective: 1100, position: 'relative' }}>
      <motion.div
        animate={{ rotateY: spinning ? EPIC_SPIN_DEG : onCard ? 180 : 0 }}
        transition={
          reduced ? { duration: 0 }
            // Epic: varias vueltas COGIENDO VELOCIDAD, así que ease-in y no el muelle de siempre.
            : spinning ? { duration: (BAND_T.epicLand - BAND_T.epicSpin) / 1000, ease: [0.45, 0, 0.95, 0.5] }
              : { type: 'spring', stiffness: 160, damping: 20 }
        }
        style={{ position: 'relative', width: '100%', height: '100%', transformStyle: 'preserve-3d' }}
      >
        {/* BACK — card back + the current stage text overlaid */}
        <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
          <CardBack width={width} height={height} accent={backAccent} strong={lit && !isCommon} quietMark={stacked} />
          {stacked && !onCard && (
            /* Column of values, each one staying put once it drops in. */
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'space-evenly', padding: `${Math.round(height * 0.07)}px 8px`,
            }}>
              {rows.map((r, k) => (
                <div key={r.key} style={{
                  textAlign: 'center', maxWidth: '100%',
                  opacity: shown > k ? 1 : 0,
                  transform: shown > k ? 'none' : 'translateY(10px) scale(.82)',
                  transition: 'opacity .35s ease-out, transform .45s cubic-bezier(.2,1.4,.4,1)',
                }}>
                  <div style={{ fontFamily: FONTS.mono, fontSize: Math.min(9, Math.max(7, Math.round(width / 22))), letterSpacing: '.18em', color: COLORS.muted, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                    {r.key}
                  </div>
                  <div style={{
                    fontFamily: FONTS.display, fontWeight: 900, lineHeight: 1.1, letterSpacing: '-.02em', marginTop: 3,
                    fontSize: fitSize(r.value, 26), whiteSpace: 'nowrap',
                    color: r.color ?? COLORS.text,
                    textShadow: r.color ? SHADOW.glow(r.color) : 'none',
                  }}>
                    {r.value}
                  </div>
                </div>
              ))}
            </div>
          )}
          {!stacked && !onCard && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AnimatePresence mode="wait">
                <motion.div
                  key={stage}
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 1.1, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                  onAnimationStart={(def) => { if (stage === 'rarity' && (def as { opacity?: number })?.opacity === 1) setAccentOn(true) }}
                  style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, userSelect: 'none' }}
                >
                  <div style={{ fontFamily: FONTS.mono, fontSize: Math.min(10, Math.max(7, Math.round(width / 18))), letterSpacing: '.14em', color: COLORS.muted, whiteSpace: 'nowrap' }}>{stage.toUpperCase()}</div>
                  <div style={{
                    fontFamily: FONTS.display, fontWeight: 900, lineHeight: 1.05,
                    // Sized to fit the card width on one line (longest real value: "uncommon").
                    fontSize: valueSize,
                    maxWidth: avail, textAlign: 'center', whiteSpace: 'nowrap',
                    color: stage === 'rarity' ? rc : COLORS.text, textShadow: stage === 'rarity' ? SHADOW.glow(rc) : 'none',
                  }}>
                    {stageValue}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* FRONT — mounted at the card stage; the flip reveals it. En Epic se monta ya al
            empezar el giro: durante las vueltas la cara delantera pasa por delante varias
            veces, y si no está montada se ven huecos en lugar de la carta. */}
        {(onCard || spinning) && (
          <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: 'rotateY(180deg)', display: 'flex', justifyContent: 'center' }}>
            {children}
          </div>
        )}
      </motion.div>

      {/* La franja va FUERA del elemento que rota: tiene que quedarse quieta mientras la carta
          gira, y sobresalir por los lados sin heredar la perspectiva. */}
      {band && bandKey && (
        <RarityBand
          label={bandKey.toUpperCase()}
          color={bandColorFor(bandKey)}
          w={width} h={height} phase={band} reduced={reduced}
          turnMs={bandKey === 'epic' ? BAND_T.epicLand - BAND_T.epicSpin : FLIP_MS}
        />
      )}
    </div>
  )
}
