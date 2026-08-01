import { useEffect, useRef } from 'react'
import { siguienteTop } from './stickyFollow'

/** El ancestro que scrollea de verdad. En esta app NO es la ventana: el contenido vive dentro de
 *  un <main> con overflow-y, así que escuchar `window` no recibiría nada. */
function scrollerDe(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY
    if (oy === 'auto' || oy === 'scroll') return p
  }
  return null
}

/**
 * Hace que un panel `position: sticky` siga la dirección del scroll en vez de anclarse arriba.
 *
 * Devuelve la ref que hay que poner en el elemento sticky. Ver `stickyFollow.ts` para el porqué.
 *
 * `activo` en false lo deja quieto y limpia lo que hubiera puesto: en móvil el panel va a ancho
 * completo sobre el contenido y no hay nada que pegar.
 */
export function useStickyFollow(activo: boolean, hueco = 16) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!activo || !el) {
      if (el) el.style.top = ''
      return
    }
    const scroller = scrollerDe(el)
    if (!scroller) return

    let top = hueco
    let ultimo = scroller.scrollTop
    let pendiente = false
    el.style.top = `${top}px`

    const aplicar = () => {
      pendiente = false
      const y = scroller.scrollTop
      const dy = y - ultimo
      ultimo = y
      // Se releen las alturas en cada vuelta: el panel cambia de alto al cargar la imagen o el
      // vídeo de la máquina, y con un alto cacheado el tope de abajo quedaría mal puesto.
      top = siguienteTop(top, dy, el.offsetHeight, scroller.clientHeight, hueco)
      el.style.top = `${top}px`
    }
    // El listener solo apunta trabajo; el cálculo va en el frame, que es cuando el navegador va a
    // pintar de todas formas.
    const onScroll = () => {
      if (pendiente) return
      pendiente = true
      requestAnimationFrame(aplicar)
    }

    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      el.style.top = ''
    }
  }, [activo, hueco])

  return ref
}
