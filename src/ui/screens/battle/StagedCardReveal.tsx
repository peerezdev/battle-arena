import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { COLORS, FONTS, SHADOW } from '../../theme'
import { rarityColor } from './RevealCard'
import { CardBack } from './CardBack'
import { RarityBand } from './RarityBand'
import { PHASE, EPIC_SPIN_DEG, bandRarity, bandColorFor, buildTimeline } from './revealTiming'
import { playEpicSpin, playFlipThump, stopReveal } from '../../sfx'

type Stage = 'year' | 'grade' | 'rarity' | 'card'

/** Gacha-style staged reveal as a 3D flip card: during YEAR → GRADE → RARITY it shows the
 *  card back (rarity-glow) with the stage text on top; on the card stage it flips (rotateY)
 *  to the front (`children`). Reduced-motion shows the front immediately. `onCardShown` fires
 *  once the card stage lands.
 *
 *  `stacked` swaps the one-at-a-time text for the gacha's column: each value drops in under the
 *  previous one and STAYS, so the card is read as year + grade + rarity together before it flips.
 *  Lo usan royale Y pack battle: las cartas de pack son de 140×196 para arriba y las tres filas
 *  caben (el bloque reparte con space-evenly y saca los tamaños del ancho). Sigue siendo opcional
 *  porque la parrilla móvil baja hasta ~76px de ancho, donde ya no cabrían. */
export function StagedCardReveal({
  year, grade, rarity, reduced, dwellMs = PHASE.hold, width = 180, height = 252,
  stacked = false, preloadSrc, onCardShown, onFaceUp, children,
}: {
  year: string | null
  grade: number | string | null
  rarity: string | null
  reduced: boolean
  dwellMs?: number    // how long the revealed card stays before onCardShown advances (ms)
  width?: number
  height?: number
  stacked?: boolean   // show year/grade/rarity as a persistent column instead of one at a time
  /** Imagen de la carta, para precargarla mientras corre la ceremonia (ver abajo). */
  preloadSrc?: string
  onCardShown?: () => void
  /** La carta acaba de quedar de cara. Va ANTES del `hold`, para que lo que dependa de su
   *  valor —la tabla de posiciones— se mueva mientras la carta sigue en el escenario. */
  onFaceUp?: () => void
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
  // No apilado: hasta que no arranca el primer escalón no se pinta nada, para que el año no
  // aparezca de golpe en el ms 0 y respete su turno como en el modo apilado.
  const [preStarted, setPreStarted] = useState(reduced)

  // Franja de rareza: solo Rare y Epic. `band` = null oculta · 'in' entra · 'out' se desvanece.
  const bandKey = bandRarity(rarity)
  const [band, setBand] = useState<null | 'in' | 'out'>(null)
  const [spinning, setSpinning] = useState(false)   // Epic: giro de varias vueltas acelerando

  // Un solo guion para los dos modos: las fases salen de sus DURACIONES (revealTiming.PHASE),
  // encadenadas sobre las filas que trae esta carta.
  // Por ref: el guion no debe reprogramarse porque el padre pase otra función.
  const onFaceUpRef = useRef(onFaceUp)
  const onCardShownRef = useRef(onCardShown)
  // En un efecto y no en el render: tocar una ref mientras se renderiza es un efecto colateral.
  useEffect(() => { onFaceUpRef.current = onFaceUp; onCardShownRef.current = onCardShown })

  const rowKeys = useMemo(() => rows.map((r) => r.key), [rows])
  const tl = useMemo(() => buildTimeline(rowKeys, rarity), [rowKeys, rarity])

  useEffect(() => {
    if (reduced) return
    const timers: ReturnType<typeof setTimeout>[] = []
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))

    tl.rowAt.forEach((ms, k) => at(ms, () => {
      if (stacked) setShown(k + 1)
      else { setPreStarted(true); setI(k) }
    }))
    // El sonido arranca CON la rareza, antes de que entre la franja: el audio va por delante de
    // la imagen y la franja cae dentro del sonido. Solo Epic.
    if (bandKey === 'epic') at(tl.rowAt[tl.rowAt.length - 1] ?? 0, playEpicSpin)

    if (tl.bandAt != null) at(tl.bandAt, () => setBand('in'))
    at(tl.turnAt, () => {
      setBand((b) => (b ? 'out' : b))       // la franja se va AL RITMO del giro
      if (bandKey === 'epic') setSpinning(true)
      else if (stacked) setFlipped(true)
      else setI(stages.length - 1)
    })
    // El golpe grave cierra la ceremonia: suena al quedar de cara, no al empezar a moverse.
    at(tl.faceUpAt, () => {
      if (bandKey === 'epic') { if (stacked) setFlipped(true); else setI(stages.length - 1) }
      if (bandKey) playFlipThump()
      onFaceUpRef.current?.()
    })
    // `hold` es lo que la carta se queda DE CARA, así que cuenta desde faceUpAt. Antes colgaba
    // del inicio del volteo, y en Common/Rare eso se comía 800-1000 ms del hold.
    at(tl.faceUpAt + dwellMs, () => onCardShownRef.current?.())

    // Al desmontar —o sea, al pasar a la carta siguiente— se corta lo que esté sonando.
    return () => { timers.forEach(clearTimeout); stopReveal() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tl, reduced, stacked, bandKey, dwellMs])

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
    // Sin animación se entrega el resultado y punto; con ella lo programa la línea de tiempos.
    if (reduced && onCard) onCardShownRef.current?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCard, reduced])

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
            : spinning ? { duration: tl.turnMs / 1000, ease: [0.45, 0, 0.95, 0.5] }
              // El volteo normal dura lo que diga su fase, en vez de un muelle libre.
              : { duration: tl.turnMs / 1000, ease: [0.2, 0.8, 0.25, 1] }
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
          {!stacked && !onCard && preStarted && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {/* Sin `mode="wait"`: esperar a que el escalón anterior TERMINE de salir retrasaba
                  al siguiente ~540 ms, y el retraso se acumulaba —el grado llegaba a 1538 en vez
                  de a 1000— hasta el punto de que la franja aparecía ANTES que la rareza. Ahora
                  el que entra lo hace a su hora y el que sale se desvanece encima, para lo cual
                  se posicionan en absoluto y no en flujo. */}
              <AnimatePresence>
                <motion.div
                  key={stage}
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 1.1, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                  onAnimationStart={(def) => { if (stage === 'rarity' && (def as { opacity?: number })?.opacity === 1) setAccentOn(true) }}
                  style={{ position: 'absolute', inset: 0, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, userSelect: 'none' }}
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
            {/* Mientras GIRA, esta cara lleva la tapa y no la carta: en un giro de varias vueltas
                la cara delantera pasa por delante del jugador cada media vuelta, y con la carta
                de verdad el giro destriparía lo que va a salir. Se cambia al aterrizar, que es
                cuando la carta está quieta y de cara. */}
            {onCard ? children : <CardBack width={width} height={height} accent={backAccent} strong={lit && !isCommon} />}
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
          turnMs={tl.turnMs}
        />
      )}
    </div>
  )
}
