// Efectos de sonido del reveal.
//
// Dos piezas, y de distinta naturaleza a propósito:
//
//   · spin-epic.mp3 — un fichero, porque es el momento que tiene que sonar a algo concreto.
//   · el golpe del volteo — sintetizado, portado tal cual del mockup que se validó: un seno de
//     180 Hz cayendo a 48 en 0,28 s. No hay fichero que mantener y pesa cero.
//
// `play()` puede fallar: el navegador lo bloquea hasta que el usuario ha interactuado con la
// página, y en móvil también con el interruptor de silencio. Se traga el error — la ceremonia
// no puede depender del audio.

const cache = new Map<string, HTMLAudioElement>()

function el(src: string): HTMLAudioElement | null {
  try {
    let a = cache.get(src)
    if (!a) { a = new Audio(src); a.preload = 'auto'; cache.set(src, a) }
    return a
  } catch { return null }   // entorno sin Audio (tests, SSR)
}

const EPIC_SPIN = '/spin-epic.mp3'

/** Suena al aparecer la rareza cuando la carta es EPIC. Solo Epic — es lo que la hace especial. */
export function playEpicSpin() {
  const a = el(EPIC_SPIN)
  if (!a) return
  a.volume = 0.7
  a.currentTime = 0
  void a.play().catch(() => { /* bloqueado por el navegador: sin sonido y sin ruido en consola */ })
}

/**
 * Corta lo que esté sonando del reveal. Se llama al cambiar de carta: sin esto, el sonido de una
 * épica seguía sonando encima de la tirada siguiente —que puede ser una común y muda—, y en una
 * ronda de royale eso son diez tiradas pisándose.
 */
export function stopReveal() {
  const a = cache.get(EPIC_SPIN)
  if (!a) return
  try { a.pause(); a.currentTime = 0 } catch { /* nada que cortar */ }
}

// ── Golpe del volteo ────────────────────────────────────────────────────────
// Sintetizado con WebAudio en vez de un mp3: son 300 ms de seno y así no hay binario que
// versionar. El AudioContext se crea al primer uso, no al cargar la app, para no dejarlo
// suspendido esperando una interacción que quizá nunca llegue.

let actx: AudioContext | null = null

/** Golpe grave cuando la carta queda de cara. Solo en Rare y Epic, con la franja. */
export function playFlipThump() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    actx ??= new Ctx()
    void actx.resume?.().catch(() => {})
    const c = actx
    const t0 = c.currentTime
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(180, t0)
    osc.frequency.exponentialRampToValueAtTime(48, t0 + 0.28)
    gain.gain.setValueAtTime(0.34, t0)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34)
    osc.connect(gain).connect(c.destination)
    osc.start(t0)
    osc.stop(t0 + 0.36)
  } catch { /* sin WebAudio: la ceremonia sigue igual */ }
}
