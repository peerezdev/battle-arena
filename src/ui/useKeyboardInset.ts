import { useEffect, useState } from 'react'

/**
 * Cuántos píxeles de la parte de abajo tapa el teclado del móvil.
 *
 * El teclado NO encoge el viewport de maquetación, solo el visual. Por eso un elemento anclado con
 * `position: fixed; bottom: N` se queda debajo del teclado en vez de encima: su `bottom` sigue
 * midiendo desde el fondo de la pantalla, que ya no se ve. Es lo que obligaba a hacer scroll para
 * leer lo que uno está escribiendo.
 *
 * `visualViewport` es lo único que sabe la altura de verdad. La resta da lo tapado:
 *
 *     innerHeight − visualViewport.height − visualViewport.offsetTop
 *
 * El `offsetTop` importa porque el navegador puede desplazar el viewport visual hacia arriba al
 * enfocar; sin restarlo, el hueco se contaría dos veces.
 */
export function keyboardInset(
  innerHeight: number,
  vv: { height: number; offsetTop: number } | null | undefined,
): number {
  if (!vv) return 0   // navegador sin visualViewport: mejor no mover nada que moverlo mal
  return Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop))
}

/**
 * Sigue el alto del teclado en vivo.
 *
 * Devuelve 0 con el teclado cerrado, en escritorio y en cualquier navegador sin `visualViewport`,
 * así que quien lo use puede sumarlo siempre sin condicionales.
 */
/**
 * Atajo SOLO en desarrollo: `?kb=300` finge un teclado de 300 px.
 *
 * El modo dispositivo de DevTools cambia el tamaño del lienzo pero NO abre ningún teclado, así que
 * `visualViewport` no encoge y esto no se ejercita nunca desde el escritorio. Con el parámetro se
 * puede comprobar que la maquetación reacciona bien; lo que NO comprueba es el teclado de verdad,
 * que solo se ve en un móvil o en un simulador.
 *
 * Se lee una vez al cargar el módulo, no en un efecto: el parámetro no cambia durante la sesión.
 */
const KB_FORZADO: number = (() => {
  if (!import.meta.env.DEV || typeof window === 'undefined') return 0
  const v = Number(new URLSearchParams(window.location.search).get('kb'))
  return Number.isFinite(v) && v > 0 ? v : 0
})()

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(KB_FORZADO)

  useEffect(() => {
    if (KB_FORZADO) return   // atajo de desarrollo: no hay nada que medir
    const vv = window.visualViewport
    if (!vv) return
    const medir = () => setInset(keyboardInset(window.innerHeight, vv))
    medir()
    // `scroll` además de `resize`: en iOS el viewport visual se desplaza sin cambiar de tamaño.
    vv.addEventListener('resize', medir)
    vv.addEventListener('scroll', medir)
    return () => {
      vv.removeEventListener('resize', medir)
      vv.removeEventListener('scroll', medir)
    }
  }, [])

  return inset
}
