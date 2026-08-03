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
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
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
