// Efectos de sonido del reveal.
//
// Un solo <audio> por pista, reutilizado: crear uno por tirada deja elementos colgando y en una
// ronda de royale son diez seguidas. `play()` puede fallar —el navegador lo bloquea hasta que el
// usuario ha interactuado con la página, y en móvil también si el móvil está en silencio—, así
// que se traga el error: la ceremonia no depende del audio.

const cache = new Map<string, HTMLAudioElement>()

function play(src: string, volume: number) {
  try {
    let el = cache.get(src)
    if (!el) { el = new Audio(src); el.preload = 'auto'; cache.set(src, el) }
    el.volume = volume
    el.currentTime = 0
    void el.play().catch(() => { /* bloqueado por el navegador: sin sonido y sin ruido en consola */ })
  } catch { /* entorno sin Audio (tests, SSR) */ }
}

/** Suena al aparecer la rareza cuando la carta es EPIC. Solo Epic — es lo que la hace especial. */
export function playEpicSpin() {
  play('/spin-epic.mp3', 0.7)
}
