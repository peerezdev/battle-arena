import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { act } from 'react'
import { useStickyFollow } from './useStickyFollow'

function Panel({ activo = true, listo = true }: { activo?: boolean; listo?: boolean }) {
  const ref = useStickyFollow(activo)
  return (
    <div data-testid="scroller" style={{ overflowY: 'auto' }}>
      {listo && <div ref={ref} data-testid="panel" style={{ position: 'sticky' }} />}
    </div>
  )
}

/** jsdom no hace layout: offsetHeight y clientHeight son 0. Se fijan a mano DESPUÉS de renderizar,
 *  que es cuando el hook los lee — en el scroll, no al montar. */
function medir(el: HTMLElement, prop: 'offsetHeight' | 'clientHeight', v: number) {
  Object.defineProperty(el, prop, { value: v, configurable: true })
}

function montar({ activo = true, altoPanel = 900, altoVista = 600 } = {}) {
  const r = render(<Panel activo={activo} />)
  const panel = r.getByTestId('panel')
  const scroller = r.getByTestId('scroller')
  medir(panel, 'offsetHeight', altoPanel)
  medir(scroller, 'clientHeight', altoVista)
  return { panel, scroller }
}

function scrollear(scroller: HTMLElement, a: number) {
  Object.defineProperty(scroller, 'scrollTop', { value: a, configurable: true })
  act(() => { scroller.dispatchEvent(new Event('scroll')) })
}

let raf: ReturnType<typeof vi.fn>
beforeEach(() => {
  raf = vi.fn((cb: FrameRequestCallback) => { cb(0); return 1 })
  vi.stubGlobal('requestAnimationFrame', raf)
})

describe('useStickyFollow', () => {
  it('arranca pegado arriba', () => {
    const { panel } = montar()
    expect(panel.style.top).toBe('16px')
  })

  it('bajando, el panel sube para enseñar su final', () => {
    const { panel, scroller } = montar()
    scrollear(scroller, 200)
    expect(panel.style.top).toBe('-184px')            // 16 − 200
  })

  it('subiendo vuelve a bajar, desde donde estaba y sin saltos', () => {
    const { panel, scroller } = montar()
    scrollear(scroller, 200)
    scrollear(scroller, 150)
    expect(panel.style.top).toBe('-134px')            // −184 + 50
  })

  it('no se pasa: el final del panel se queda en el fondo de la ventana', () => {
    const { panel, scroller } = montar()
    scrollear(scroller, 10_000)
    expect(panel.style.top).toBe(`${600 - 900 - 16}px`)
  })

  it('desactivado no toca nada: en móvil el panel no se pega', () => {
    const { panel } = montar({ activo: false })
    expect(panel.style.top).toBe('')
  })

  it('un panel que cabe en la ventana se queda arriba', () => {
    const { panel, scroller } = montar({ altoPanel: 200 })
    scrollear(scroller, 400)
    expect(panel.style.top).toBe('16px')
  })

  it('el cálculo va en un frame, no en cada evento de scroll', () => {
    const { scroller } = montar()
    scrollear(scroller, 10)
    expect(raf).toHaveBeenCalled()
  })
})


it('se engancha aunque el panel aparezca DESPUÉS de montar', () => {
  // Es el caso real: el catálogo de máquinas se carga por red, así que en el primer render no hay
  // panel que pegar. Con un efecto que solo mira la ref al montar, el listener no se ponía nunca y
  // el scroll no hacía nada — que es exactamente lo que se veía en la pantalla.
  const r = render(<Panel listo={false} />)
  r.rerender(<Panel listo />)
  const panel = r.getByTestId('panel')
  const scroller = r.getByTestId('scroller')
  medir(panel, 'offsetHeight', 900)
  medir(scroller, 'clientHeight', 600)
  scrollear(scroller, 200)
  expect(panel.style.top).toBe('-184px')
})


it('al desactivarse deja el panel como estaba', () => {
  // La limpieza la hace el propio efecto al rehacerse. Si alguien la quitara, el panel se quedaría
  // con un `top` negativo pegado para siempre en móvil.
  const r = render(<Panel activo />)
  const panel = r.getByTestId('panel')
  const scroller = r.getByTestId('scroller')
  medir(panel, 'offsetHeight', 900)
  medir(scroller, 'clientHeight', 600)
  scrollear(scroller, 200)
  expect(panel.style.top).toBe('-184px')

  r.rerender(<Panel activo={false} />)
  expect(panel.style.top).toBe('')
})
