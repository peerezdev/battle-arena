import { useCallback, useEffect, useRef, useState } from 'react'

/** Cuánto puede alejarse del fondo y seguir contando como "está abajo".
 *
 *  No es el fondo exacto a propósito: con el fondo exacto, un píxel de inercia del ratón o del
 *  rebote táctil de iOS ya saca del modo seguir, y el chat deja de moverse sin que el jugador haya
 *  hecho nada. 40px es aproximadamente una línea de mensaje. */
export const MARGEN_FONDO = 40

interface Medidas { scrollHeight: number; scrollTop: number; clientHeight: number }

export function estaAlFondo(el: Medidas, margen: number = MARGEN_FONDO): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= margen
}

/**
 * Mantiene el chat pegado al final, sin arrastrar a quien ha subido a leer.
 *
 * El chat no tenía NADA de esto: el contenedor scrollea, pero nadie lo desplazaba nunca, así que
 * al entrar se quedaba donde nace —arriba— y enseñaba los mensajes más viejos.
 *
 * Con cada mensaje nuevo baja solo si el jugador estaba abajo. Si había subido a leer, no se mueve
 * nada y se cuentan los que no ha visto, para ofrecerle bajar cuando él quiera.
 */
export function useStickToBottom(
  ref: React.RefObject<HTMLElement | null>,
  totalMensajes: number,
) {
  const [pegadoAlFondo, setPegadoAlFondo] = useState(true)
  const [nuevosSinVer, setNuevosSinVer] = useState(0)
  const vistos = useRef(totalMensajes)
  // Estos dos espejos existen porque el efecto de más abajo NO puede depender de sus valores: si
  // dependiera, el chat bajaría solo al volver a tocar fondo con el ratón, y no solo al llegar un
  // mensaje. Se sincronizan en efectos y no en el cuerpo del render, que es lo que prohíbe la
  // regla `react-hooks/refs`: escribir un ref durante el render puede dejar la pantalla sin
  // actualizar. Van ANTES del efecto principal a propósito, porque los efectos corren en orden de
  // declaración y este necesita leerlos ya sincronizados.
  const pegadoRef = useRef(pegadoAlFondo)
  const totalRef = useRef(totalMensajes)
  useEffect(() => { pegadoRef.current = pegadoAlFondo }, [pegadoAlFondo])
  useEffect(() => { totalRef.current = totalMensajes }, [totalMensajes])

  /** Al llegar abajo, TODO queda visto. Sin esto, bajar y volver a subir dejaba el contador
   *  arrastrando los mensajes de antes y anunciaba más nuevos de los que había. */
  const marcarVisto = useCallback(() => {
    vistos.current = totalRef.current
    setNuevosSinVer(0)
  }, [])

  const bajarDelTodo = useCallback((suave = true) => {
    const el = ref.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: suave ? 'smooth' : 'auto' })
    marcarVisto()
    setPegadoAlFondo(true)
  }, [ref, marcarVisto])

  const alHacerScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    const abajo = estaAlFondo(el)
    setPegadoAlFondo(abajo)
    if (abajo) marcarVisto()
  }, [ref, marcarVisto])

  useEffect(() => {
    if (totalMensajes === 0) return
    const primeraVez = vistos.current === 0
    if (pegadoRef.current) {
      // Sin animación la primera vez: al entrar hay que APARECER abajo, no ver un barrido por
      // todo el historial.
      bajarDelTodo(!primeraVez)
    } else {
      setNuevosSinVer(Math.max(0, totalMensajes - vistos.current))
    }
  }, [totalMensajes, bajarDelTodo])

  return { pegadoAlFondo, nuevosSinVer, bajarDelTodo, alHacerScroll }
}
