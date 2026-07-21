import { useEffect, useState } from 'react'

// Aviso de "la lista de sobres pendientes ha cambiado".
//
// AppShell consulta esa lista al entrar y al cambiar de ruta, pero abrir los sobres ocurre en el
// gacha SIN cambiar de ruta: sin este aviso, su lista se quedaría desfasada y el saldo seguiría
// congelado después de que el jugador ya haya visto sus cartas.
//
// Mismo patrón que los toasts: módulo con oyentes, sin provider ni contexto.

let listeners: Array<() => void> = []
let version = 0

export function notifyPendingPacksChanged() {
  version += 1
  listeners.forEach((l) => l())
}

/** Cambia cada vez que hay que releer los pendientes. Úsalo como dependencia del efecto. */
export function usePendingPacksVersion(): number {
  const [v, setV] = useState(version)
  useEffect(() => {
    const l = () => setV(version)
    listeners.push(l)
    setV(version)
    return () => { listeners = listeners.filter((x) => x !== l) }
  }, [])
  return v
}
