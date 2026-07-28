import { useEffect, useRef, useState } from 'react'
import { COLORS, FONTS, RARITY } from '../../theme'
import type { YoloResult } from './pendingToResult'

// Reveal del gacha: dorso con año, grado y rareza APILADOS, casilla de rareza tipo rodillo,
// contador de valor y volteo final.
//
// Solo el gacha. Las batallas tienen su propio reveal (StagedCardReveal) y no comparten nada
// con este: allí lo que importa es comparar tiradas entre jugadores, no la ceremonia de una.
//
// El orden es deliberado: las tres etiquetas se ACUMULAN en vez de sustituirse, así que cuando
// entra el contador el jugador ya tiene el contexto completo delante y la cifra cae sobre algo
// que ya entiende.

const ORDER = ['common', 'uncommon', 'rare', 'epic'] as const
type Rarity = typeof ORDER[number]

const RARITY_HEX: Record<Rarity, string> = {
  common: RARITY.common, uncommon: RARITY.uncommon, rare: RARITY.rare, epic: RARITY.epic,
}

const ROW = 38   // alto de fila de la casilla; debe cuadrar con el alto del .reelItem de abajo

/** Guion de la secuencia, en ms. Un solo sitio que tocar para recalibrar ritmos. */
// Las tres primeras van sincronizadas con el reveal de batallas (STACK_T): la ceremonia es
// distinta —aquí hay ruleta y contador— pero el arranque tiene que sonar igual.
export const REVEAL_T = { year: 500, grade: 1000, rarity: 1750, gap: 250, roll: 1600, hold: 1000, flip: 750 }

/** Lo que tarda la casilla en parar, por rareza. Escala a propósito: una común para casi en
 *  seco y una épica coquetea con las bajas antes de deslizarse. Es lo que hace que una épica se
 *  SIENTA distinta sin añadir etapas nuevas. */
export const SPIN_MS: Record<Rarity, number> = { common: 2500, uncommon: 3000, rare: 3000, epic: 3000 }

function norm(rarity: string | null | undefined): Rarity | null {
  const k = (rarity ?? '').toLowerCase()
  return (ORDER as readonly string[]).includes(k) ? (k as Rarity) : null
}

/** Elige al azar evitando `prev`: dos nombres iguales seguidos rompen la ilusión de rodillo —
 *  parece que se ha atascado, no que está girando. */
function pickNot(prev: Rarity | undefined, pool: readonly Rarity[] = ORDER): Rarity {
  const opts = pool.filter((k) => k !== prev)
  return opts[Math.floor(Math.random() * opts.length)]
}

/** Tira de nombres de la casilla. Termina SIEMPRE en la rareza real; lo anterior es relleno.
 *  En rareza alta las dos previas se fuerzan a common/uncommon: es el bait — parece que va a
 *  parar en una mala y luego se desliza a la buena. */
export function buildReelStrip(target: Rarity, n = 14): Rarity[] {
  const items: Rarity[] = []
  for (let i = 0; i < n; i++) items.push(pickNot(items[i - 1]))
  if (target === 'epic' || target === 'rare') {
    const low: readonly Rarity[] = ['common', 'uncommon']
    items[n - 2] = pickNot(items[n - 3], low)
    items[n - 1] = pickNot(items[n - 2], low)
  }
  // El ganador tampoco puede repetir al anterior: sin bait, el relleno podría acabar en él.
  if (items[n - 1] === target) items[n - 1] = pickNot(target, ORDER.filter((k) => k !== items[n - 2]))
  items.push(target)
  return items
}

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
  const stripRef = useRef<HTMLDivElement | null>(null)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  const hasYear = !!result.year
  const hasGrade = !!result.grade
  const spin = rarity ? SPIN_MS[rarity] : SPIN_MS.common

  useEffect(() => {
    // Sin animación (reduced motion o skip) se entrega la carta y punto: quien pide menos
    // movimiento quiere su resultado, no el espectáculo.
    if (reduced || skip) { doneRef.current(); return }

    const timers: ReturnType<typeof setTimeout>[] = []
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))

    at(REVEAL_T.year, () => setShown(1))
    at(REVEAL_T.grade, () => setShown(2))
    at(REVEAL_T.rarity, () => {
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
        el.animate(frames, { duration: spin, fill: 'forwards' })
      }
    })

    const tCount = REVEAL_T.rarity + spin + REVEAL_T.gap
    at(tCount, () => setShown(4))

    // El contador sube con cúbica invertida: acelera y aterriza suave, no se corta en seco.
    let raf = 0
    at(tCount, () => {
      const t0 = performance.now()
      const step = () => {
        const p = Math.min(1, (performance.now() - t0) / REVEAL_T.roll)
        setAmount(value * (1 - Math.pow(1 - p, 3)))
        if (p < 1) raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    })

    const tFlip = tCount + REVEAL_T.roll + REVEAL_T.hold
    at(tFlip, () => setFlipped(true))
    at(tFlip + REVEAL_T.flip, () => doneRef.current())

    return () => { timers.forEach(clearTimeout); cancelAnimationFrame(raf) }
  }, [reduced, skip, spin, value, rarity, strip])

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
      <div style={{ perspective: 1200, position: 'relative', width: 196, height: 274 }}>
        <div style={{
          width: 196, height: 274, position: 'relative', transformStyle: 'preserve-3d',
          transform: flipped ? 'rotateY(0)' : 'rotateY(180deg)',
          transition: `transform ${REVEAL_T.flip}ms cubic-bezier(.4,0,.2,1)`,
        }}>
          <div style={{
            position: 'absolute', inset: 0, backfaceVisibility: 'hidden', borderRadius: 10,
            transform: 'rotateY(180deg)', border: '1px solid #ffffff1a',
            background: 'repeating-linear-gradient(45deg,#141a26 0 8px,#101620 8px 16px)',
          }} />
          <div style={{
            position: 'absolute', inset: 0, backfaceVisibility: 'hidden', borderRadius: 10,
            overflow: 'hidden', background: COLORS.panel2, border: `1px solid ${color}66`,
            boxShadow: `0 18px 34px #000a, 0 0 26px -6px ${color}`,
            display: 'grid', placeItems: 'center',
          }}>
            {result.image
              ? <img src={result.image} alt={result.name ?? ''} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              : <span style={{ fontSize: 46 }}>🃏</span>}
          </div>
        </div>

        {/* Las etiquetas van FUERA del elemento que rota: dentro heredarían su rotateY(180deg)
            y se verían en espejo. */}
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'space-evenly', padding: '22px 10px',
          pointerEvents: 'none', opacity: flipped ? 0 : 1, transition: 'opacity .3s ease-out',
        }}>
          {hasYear && row('Year', big(String(result.year)), shown >= 1)}
          {hasGrade && row('Grade', big(String(result.grade)), shown >= 2)}
          {rarity && row('Rarity', (
            <div style={{
              height: ROW, width: 150, overflow: 'hidden', position: 'relative', marginTop: 3,
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
