import { useEffect, useState } from 'react'

// Aviso de "la lista de batallas sin ver ha cambiado". AppShell la consulta al entrar y al
// cambiar de ruta, pero marcar una como vista ocurre en BattleFlow sin cambiar a una ruta que
// AppShell observe de forma útil; sin esto, su lista se quedaría desfasada y el saldo seguiría
// congelado tras haberlas visto. Mismo patrón que los toasts y que pendingPacksBus.

let listeners: Array<() => void> = []
let version = 0

export function notifyUnseenBattlesChanged() {
  version += 1
  listeners.forEach((l) => l())
}

export function useUnseenBattlesVersion(): number {
  const [v, setV] = useState(version)
  useEffect(() => {
    const l = () => setV(version)
    listeners.push(l)
    setV(version)
    return () => { listeners = listeners.filter((x) => x !== l) }
  }, [])
  return v
}
