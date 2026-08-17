/**
 * Búsqueda de jugadores para el autocompletado del comando `/tip`.
 *
 * Este fichero existe por el FRENO, no por la petición. `src/ui/useAliases.ts` documenta que una
 * ráfaga de peticiones tumbó producción: el backend corre en UN proceso y consulta la base de
 * forma síncrona, así que una petición por pulsación lo deja sin atender nada. Aquí se espera a
 * que el jugador pare de escribir y se recuerda lo ya preguntado.
 *
 * El servidor tiene además su propio límite por wallet: este freno es la primera capa, no la
 * única, porque una convención del frontend se puede borrar en una refactorización.
 */
import { useEffect, useState } from 'react'
import { config } from './config'

/** Cuánto se espera tras la última pulsación antes de preguntar. */
export const ESPERA_MS = 250

export interface UsuarioEncontrado {
  wallet: string
  alias: string | null
  online: boolean
}

// Caché de módulo: escribir "ana", borrar hasta "an" y volver a "ana" no vuelve a preguntar.
const cache = new Map<string, UsuarioEncontrado[]>()

/** Solo para tests: deja la caché como recién importada. */
export function _limpiarCacheBusqueda(): void {
  cache.clear()
}

export function useUserSearch(token: string | null, consulta: string, activo: boolean) {
  // Lo traído se guarda JUNTO A SU CONSULTA. Sin eso, al cambiar de consulta se seguirían viendo
  // los resultados de la anterior hasta que llegara la nueva: nombres que ya no corresponden a lo
  // que hay escrito, en una lista de la que se elige a quién mandar dinero.
  const [traido, setTraido] = useState<{ q: string; datos: UsuarioEncontrado[] } | null>(null)

  useEffect(() => {
    if (!activo || !token) return
    if (cache.has(consulta)) return

    let vivo = true
    const id = setTimeout(() => {
      fetch(`${config.backendUrl}/users/search?q=${encodeURIComponent(consulta)}`, {
        headers: { Authorization: `Bearer ${token}`, 'ngrok-skip-browser-warning': 'true' },
      })
        .then(async (r) => {
          const datos: UsuarioEncontrado[] = r.ok ? await r.json() : []
          // Se guarda SOLO lo que vino bien. Cachear la lista vacía de un 429 o de un corte de red
          // deja a un jugador que SÍ existe contestando "no existe" el resto de la sesión, y en el
          // chat eso se lee como "esa persona no está", que es mentira.
          if (r.ok) cache.set(consulta, datos)
          if (vivo) setTraido({ q: consulta, datos })
        })
        // El autocompletado es un extra: si falla, se escribe el nombre a mano. Lo que no puede es
        // reventar el chat entero, ni dejar resultados viejos de otra consulta.
        .catch(() => { if (vivo) setTraido({ q: consulta, datos: [] }) })
    }, ESPERA_MS)

    // Cada pulsación cancela la espera anterior: por eso escribir "ana" del tirón es UNA petición
    // y no tres.
    return () => { vivo = false; clearTimeout(id) }
  }, [token, consulta, activo])

  // Se DERIVA al pintar en vez de guardarse con un setState desde el efecto, que encadena renders
  // y además lo prohíbe el linter (react-hooks/set-state-in-effect).
  const respondida = cache.has(consulta) || traido?.q === consulta
  const resultados = !activo || !token
    ? []
    : cache.get(consulta) ?? (traido?.q === consulta ? traido.datos : [])

  // `cargando` NO es "hay un fetch en vuelo", es "todavía no sé nada de ESTA consulta", e incluye
  // la espera de 250 ms de antes de preguntar. Es la diferencia entre "ese jugador no existe" y
  // "aún no lo sé" para quien pega `/tip ana 5` y pulsa Enter sin pausa: con el otro criterio,
  // durante la espera `cargando` sería false y se le acusaría de escribir un nombre inventado.
  const cargando = activo && !!token && !respondida

  return { resultados, cargando }
}
