import { describe, it, expect } from 'vitest'
import { estaAlFondo, MARGEN_FONDO } from './useStickToBottom'

const el = (scrollHeight: number, scrollTop: number, clientHeight: number) =>
  ({ scrollHeight, scrollTop, clientHeight })

describe('estaAlFondo', () => {
  it('el fondo exacto cuenta como fondo', () => {
    expect(estaAlFondo(el(1000, 800, 200))).toBe(true)
  })

  it('tolera el margen, porque el fondo exacto es inalcanzable en la práctica', () => {
    // Un píxel de inercia del ratón o del rebote táctil bastaba para salir del modo seguir
    // y que el chat dejara de moverse sin que el jugador hubiera hecho nada.
    expect(estaAlFondo(el(1000, 800 - MARGEN_FONDO, 200))).toBe(true)
    expect(estaAlFondo(el(1000, 800 - MARGEN_FONDO - 1, 200))).toBe(false)
  })

  it('leyendo historial NO está al fondo', () => {
    expect(estaAlFondo(el(1000, 0, 200))).toBe(false)
  })

  it('una lista que no llega a llenar el alto está al fondo', () => {
    // Sin esto, un chat con dos mensajes nunca entraría en modo seguir: `scrollHeight` es menor
    // que `clientHeight` y la resta sale negativa.
    expect(estaAlFondo(el(150, 0, 200))).toBe(true)
  })
})

// ── El hook ───────────────────────────────────────────────────────────────────
// La función de arriba es la regla; esto comprueba las tres transiciones que importan.

import { renderHook, act } from '@testing-library/react'
import { useStickToBottom } from './useStickToBottom'

/** Contenedor falso: jsdom no calcula layout, así que las medidas se ponen a mano. */
function contenedor(alto = 1000, visible = 200) {
  const el = {
    scrollHeight: alto,
    clientHeight: visible,
    scrollTop: alto - visible,          // empieza abajo
    scrollTo({ top }: { top: number }) { this.scrollTop = top },
  }
  return { current: el as unknown as HTMLElement }
}

describe('useStickToBottom', () => {
  it('estando abajo, un mensaje nuevo baja y NO cuenta como no visto', () => {
    const ref = contenedor()
    const { result, rerender } = renderHook(({ n }) => useStickToBottom(ref, n),
                                            { initialProps: { n: 1 } })
    rerender({ n: 2 })
    expect(result.current.nuevosSinVer).toBe(0)
    expect(result.current.pegadoAlFondo).toBe(true)
  })

  it('habiendo subido a leer, los mensajes nuevos se cuentan y no se baja', () => {
    const ref = contenedor()
    const { result, rerender } = renderHook(({ n }) => useStickToBottom(ref, n),
                                            { initialProps: { n: 1 } })
    ;(ref.current as unknown as { scrollTop: number }).scrollTop = 0   // sube del todo
    act(() => { result.current.alHacerScroll() })
    expect(result.current.pegadoAlFondo).toBe(false)

    rerender({ n: 3 })
    expect(result.current.nuevosSinVer).toBe(2)
    expect((ref.current as unknown as { scrollTop: number }).scrollTop).toBe(0)  // no le movió
  })

  it('tras bajar del todo, volver a subir NO arrastra los que ya vio', () => {
    // El fallo que motivó este test: `bajarDelTodo` ponía el contador a cero pero no marcaba los
    // mensajes como vistos, así que al subir otra vez reaparecían todos como nuevos.
    const ref = contenedor()
    const { result, rerender } = renderHook(({ n }) => useStickToBottom(ref, n),
                                            { initialProps: { n: 1 } })
    ;(ref.current as unknown as { scrollTop: number }).scrollTop = 0
    act(() => { result.current.alHacerScroll() })
    rerender({ n: 5 })
    expect(result.current.nuevosSinVer).toBe(4)

    act(() => { result.current.bajarDelTodo() })      // el jugador pulsa "bajar"
    ;(ref.current as unknown as { scrollTop: number }).scrollTop = 0
    act(() => { result.current.alHacerScroll() })     // y vuelve a subir
    rerender({ n: 6 })

    expect(result.current.nuevosSinVer).toBe(1)       // solo el de verdad nuevo
  })
})

it('sin scrollTo en el entorno, baja igual asignando scrollTop', () => {
  // jsdom no implementa scrollTo, y Safari antiguo tampoco lo acepta con opciones. Sin la
  // alternativa, montar el chat reventaba con "el.scrollTo is not a function": 15 tests del
  // ChatDock cayeron de golpe por esto.
  const el = { scrollHeight: 1000, clientHeight: 200, scrollTop: 0 }
  const ref = { current: el as unknown as HTMLElement }
  const { rerender } = renderHook(({ n }) => useStickToBottom(ref, n), { initialProps: { n: 1 } })
  rerender({ n: 2 })
  expect(el.scrollTop).toBe(1000)
})
