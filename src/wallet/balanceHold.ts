import { useEffect, useState } from 'react'

// Congelación del saldo mostrado.
//
// El turbo hace que Collector Crypt recompre las commons en el acto, así que el USDC del jugador
// sube EN CUANTO se abre el sobre por dentro — antes de que él lo vea. Como la cabecera refresca
// el saldo cada 30s, basta con que el poll caiga a mitad de la tirada para destriparla: si el
// número sube, ya sabes que te tocó una common. Mientras haya una tirada sin revelar, el saldo
// se queda con el último valor conocido y no se toca.
//
// Es un contador y no un booleano porque puede haber más de una cosa pidiendo la congelación a la
// vez (la tirada y, más adelante, el modal de sobres pendientes); soltar una no debe descongelar
// mientras la otra siga viva.

let holds = 0
let listeners: Array<(held: boolean) => void> = []

function emit() {
  const held = holds > 0
  listeners.forEach((l) => l(held))
}

/** Congela el saldo mostrado. Devuelve la función para soltarlo; es idempotente, así que se puede
 *  llamar desde el cleanup de un efecto sin miedo a descontar de más. */
export function holdBalance(): () => void {
  holds += 1
  emit()
  let released = false
  return () => {
    if (released) return
    released = true
    holds = Math.max(0, holds - 1)
    emit()
  }
}

export function isBalanceHeld(): boolean {
  return holds > 0
}

export function useBalanceHeld(): boolean {
  const [held, setHeld] = useState(isBalanceHeld())
  useEffect(() => {
    const l = (h: boolean) => setHeld(h)
    listeners.push(l)
    setHeld(isBalanceHeld())
    return () => { listeners = listeners.filter((x) => x !== l) }
  }, [])
  return held
}
