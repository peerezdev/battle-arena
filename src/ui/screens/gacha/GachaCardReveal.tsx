import { useEffect, useMemo, useRef, useState } from 'react'
import { COLORS, FONTS } from '../../theme'
import { ROW, PHASE, RARITY_HEX, CARD_W, CARD_H, buildReelStrip, buildGachaTimeline, norm } from './gachaTiming'
import type { YoloResult } from './pendingToResult'
// Compartidos con el reveal de batallas: la franja, su color y el sonido son los mismos, y
// duplicarlos sería garantizar que un día dejen de parecerse.
import { RarityBand } from '../battle/RarityBand'
import { bandColorFor, EPIC_SPIN_DEG } from '../battle/revealTiming'
import { playEpicSpin, playFlipThump, stopReveal } from '../../sfx'
import { CardBack } from '../battle/CardBack'

// Reveal del gacha: dorso con año, grado y rareza APILADOS, casilla de rareza tipo rodillo,
// contador de valor y volteo final.
//
// Solo el gacha. Las batallas tienen su propio reveal (StagedCardReveal) y no comparten nada
// con este: allí lo que importa es comparar tiradas entre jugadores, no la ceremonia de una.
//
// El orden es deliberado: las tres etiquetas se ACUMULAN en vez de sustituirse, así que cuando
// entra el contador el jugador ya tiene el contexto completo delante y la cifra cae sobre algo
// que ya entiende.

export function GachaCardReveal({ result, reduced, skip, onDone }: {
  result: YoloResult
  reduced: boolean
  /** true = el jugador pidió saltar: se resuelve al instante. */
  skip?: boolean
  onDone: () => void
}) {
  const rarity = norm(result.rarity)
  const color = rarity ? RARITY_HEX[rarity] : COLORS.muted
  const value = result.insured_value ?? 0

  const [strip] = useState(() => (rarity ? buildReelStrip(rarity) : []))
  const [shown, setShown] = useState(0)       // 0 nada · 1 año · 2 grado · 3 rareza · 4 contador
  const [amount, setAmount] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [spinning, setSpinning] = useState(false)          // Epic: varias vueltas acelerando
  const [band, setBand] = useState<null | 'in' | 'out'>(null)
  // El borde y el halo del dorso NO pueden llevar el color de la rareza antes de que la ruleta
  // pare: un marco morado destripa la épica mientras las casillas siguen girando. Se enciende
  // cuando para, que es cuando ya se sabe. (Batallas hace lo mismo con su `lit`.)
  const [lit, setLit] = useState(false)
  const stripRef = useRef<HTMLDivElement | null>(null)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  const hasYear = !!result.year
  const hasGrade = !!result.grade
  const tl = useMemo(() => buildGachaTimeline({ hasYear, hasGrade, rarity }), [hasYear, hasGrade, rarity])
  const bandKey = rarity === 'rare' || rarity === 'epic' ? rarity : null

  useEffect(() => {
    // Sin animación (reduced motion o skip) se entrega la carta y punto: quien pide menos
    // movimiento quiere su resultado, no el espectáculo.
    if (reduced || skip) { doneRef.current(); return }

    const timers: ReturnType<typeof setTimeout>[] = []
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))

    if (tl.yearAt != null) at(tl.yearAt, () => setShown(1))
    if (tl.gradeAt != null) at(tl.gradeAt, () => setShown(2))

    at(tl.reelAt, () => {
      setShown(3)
      const el = stripRef.current
      if (el && strip.length) {
        const idx = strip.length - 1
        const yBait = -(idx - 1) * ROW, yWin = -idx * ROW
        const bait = rarity === 'epic' || rarity === 'rare'
        // Con bait: frena hasta la penúltima (parece que ahí para), aguanta, y se desliza una
        // fila más. Sin bait: una sola deceleración limpia.
        const frames = bait
          ? [{ transform: 'translateY(0)', offset: 0, easing: 'cubic-bezier(.12,.7,.25,1)' },
             { transform: `translateY(${yBait}px)`, offset: .72, easing: 'linear' },
             { transform: `translateY(${yBait}px)`, offset: .86, easing: 'cubic-bezier(.4,0,.2,1)' },
             { transform: `translateY(${yWin}px)`, offset: 1 }]
          : [{ transform: 'translateY(0)', offset: 0, easing: 'cubic-bezier(.12,.7,.25,1)' },
             { transform: `translateY(${yWin}px)`, offset: 1 }]
        el.animate(frames, { duration: tl.reelMs, fill: 'forwards' })
      }
    })

    // La ruleta para: ahí se sabe la rareza. Es el instante del sonido, como en las batallas.
    at(tl.rarityAt, () => setLit(true))
    if (rarity === 'epic') at(tl.rarityAt, playEpicSpin)
    if (tl.bandAt != null) at(tl.bandAt, () => setBand('in'))

    at(tl.turnAt, () => {
      setBand((b) => (b ? 'out' : b))      // la franja se desvanece AL RITMO del giro
      if (rarity === 'epic') setSpinning(true)
      else setFlipped(true)
    })
    at(tl.faceUpAt, () => {
      if (rarity === 'epic') setFlipped(true)
      if (bandKey) playFlipThump()
    })

    // El contador entra con la carta YA de cara: el valor cae sobre la carta que lo justifica.
    let raf = 0
    at(tl.countAt, () => {
      setShown(4)
      const t0 = performance.now()
      const step = () => {
        const p = Math.min(1, (performance.now() - t0) / PHASE.count)
        setAmount(value * (1 - Math.pow(1 - p, 3)))
        if (p < 1) raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    })

    at(tl.doneAt, () => doneRef.current())

    return () => { timers.forEach(clearTimeout); cancelAnimationFrame(raf); stopReveal() }
  }, [reduced, skip, tl, value, rarity, bandKey, strip])

  if (reduced || skip) return null

  const row = (k: string, node: React.ReactNode, on: boolean) => (
    <div style={{
      textAlign: 'center', opacity: on ? 1 : 0,
      transform: on ? 'none' : 'translateY(10px) scale(.82)',
      transition: 'opacity .35s ease-out, transform .45s cubic-bezier(.2,1.4,.4,1)',
    }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: '.18em', color: COLORS.muted, textTransform: 'uppercase' }}>{k}</div>
      {node}
    </div>
  )
  const big = (t: string) => (
    <div style={{ fontFamily: FONTS.display, fontWeight: 900, fontSize: 30, lineHeight: 1.1, letterSpacing: '-.02em', marginTop: 3 }}>{t}</div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
      <div style={{ perspective: 1200, position: 'relative', width: CARD_W, height: CARD_H }}>
        <div style={{
          width: '100%', height: '100%', position: 'relative', transformStyle: 'preserve-3d',
          // Epic gira varias vueltas COGIENDO VELOCIDAD; el resto es el volteo de media vuelta
          // de siempre. -1800° ≡ 0° (mod 360), así que aterriza de cara sin salto.
          transform: spinning ? `rotateY(-${EPIC_SPIN_DEG - 180}deg)` : flipped ? 'rotateY(0)' : 'rotateY(180deg)',
          transition: `transform ${tl.turnMs}ms ${spinning ? 'cubic-bezier(.45,0,.95,.5)' : 'cubic-bezier(.4,0,.2,1)'}`,
        }}>
          {/* Dorso: la misma tapa que las batallas —negro con el logo en gris—, para que las
              tres pantallas enseñen la misma carta mientras no se sabe qué hay debajo. */}
          <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
            <CardBack width={CARD_W} height={CARD_H} accent={lit ? color : COLORS.muted} strong={lit} quietMark />
          </div>
          {/* Mientras GIRA lleva la tapa y no la carta: en un giro de varias vueltas esta cara
              pasa por delante cada media vuelta, y con la carta de verdad sería un spoiler. */}
          {spinning && !flipped && (
            <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', zIndex: 2 }}>
              <CardBack width={CARD_W} height={CARD_H} accent={color} strong />
            </div>
          )}
          <div style={{
            position: 'absolute', inset: 0, backfaceVisibility: 'hidden', borderRadius: 10,
            overflow: 'hidden', background: COLORS.panel2, border: `1px solid ${color}66`,
            boxShadow: `0 18px 34px #000a, 0 0 26px -6px ${color}`,
            display: 'grid', placeItems: 'center',
          }}>
            {/* En absoluto y no en el flujo: el padre es un grid con `place-items:center`, así que
                su fila se dimensiona por CONTENIDO y el `height:100%` de la imagen no limitaba
                nada. Una losa de 2425×4055 se pintaba 194×324 dentro de una caja de 274 de alto
                y el overflow se comía 50px de carta. Contra `inset:0` los porcentajes sí
                resuelven, y `contain` ya la encaja entera. */}
            {result.image
              ? <img src={result.image} alt={result.name ?? ''}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
              : <span style={{ fontSize: 46 }}>🃏</span>}
          </div>
        </div>

        {/* La franja también va fuera del elemento que rota: tiene que quedarse quieta mientras
            la carta gira. La caja de arriba la recorta a su ancho. */}
        {band && bandKey && (
          // Caja propia para recortarla: la franja se pasa de largo a propósito y aquí quien
          // manda es el ancho de la carta. No se recorta en el contenedor de la carta porque
          // ahí se comería su sombra y su halo.
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 10, pointerEvents: 'none', zIndex: 6 }}>
            <RarityBand label={bandKey.toUpperCase()} color={bandColorFor(bandKey)}
              w={CARD_W} h={CARD_H} phase={band} reduced={false} turnMs={tl.turnMs} />
          </div>
        )}

        {/* Las etiquetas van FUERA del elemento que rota: dentro heredarían su rotateY(180deg)
            y se verían en espejo. */}
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'space-evenly', padding: '22px 10px',
          pointerEvents: 'none', opacity: flipped || spinning ? 0 : 1, transition: 'opacity .3s ease-out',
        }}>
          {hasYear && row('Year', big(String(result.year)), shown >= 1)}
          {hasGrade && row('Grade', big(String(result.grade)), shown >= 2)}
          {rarity && row('Rarity', (
            <div style={{
              // Proporcional a la carta (150/196 del original): con una carta grande, una
              // casilla de 150 fijos se quedaba raquítica debajo.
              // Proporcional al ancho de la carta, como lo era al original (150/196).
              height: ROW, width: Math.round(CARD_W * 0.765), overflow: 'hidden', position: 'relative', marginTop: 3,
              borderTop: '1px solid #ffffff1a', borderBottom: '1px solid #ffffff1a',
              WebkitMaskImage: 'linear-gradient(180deg,transparent,#000 26%,#000 74%,transparent)',
              maskImage: 'linear-gradient(180deg,transparent,#000 26%,#000 74%,transparent)',
            }}>
              <div ref={stripRef} style={{ position: 'absolute', left: 0, right: 0, top: 0, willChange: 'transform' }}>
                {strip.map((k, i) => (
                  <div key={i} style={{
                    height: ROW, display: 'grid', placeItems: 'center', color: RARITY_HEX[k],
                    fontFamily: FONTS.display, fontWeight: 900, fontSize: 23, lineHeight: 1,
                    textShadow: i === strip.length - 1 && shown >= 4 ? `0 0 26px ${RARITY_HEX[k]}` : undefined,
                  }}>{k.toUpperCase()}</div>
                ))}
              </div>
            </div>
          ), shown >= 3)}
        </div>
      </div>

      <div style={{
        textAlign: 'center', opacity: shown >= 4 ? 1 : 0,
        transform: shown >= 4 ? 'none' : 'translateY(10px) scale(.82)',
        transition: 'opacity .35s ease-out, transform .45s cubic-bezier(.2,1.4,.4,1)',
      }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: '.18em', color: COLORS.muted, textTransform: 'uppercase' }}>Insured value</div>
        <div style={{ fontFamily: FONTS.mono, fontWeight: 700, fontSize: 44, letterSpacing: '-.02em', color, textShadow: `0 0 30px ${color}` }}>
          ${Math.round(amount).toLocaleString('en-US')}
        </div>
      </div>
    </div>
  )
}
