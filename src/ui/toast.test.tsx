import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { Toaster } from './toast'
import { showToast, dismissToast, setToastInset } from './toastBus'

// jsdom no trae matchMedia: sin esto useIsWide diría "estrecho" y no se podría probar la rama
// de escritorio. Se fija a mano.
function viewport(wide: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: wide, media: query,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false,
  }))
}

const stack = () => document.querySelector('div[style*="position: fixed"]') as HTMLElement

describe('Toaster', () => {
  beforeEach(() => { vi.useFakeTimers(); setToastInset(0) })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('dismissToast lo retira antes de que expire', () => {
    viewport(false)
    render(<Toaster />)
    let id = 0
    act(() => { id = showToast('Turbo activated', 'success') })
    expect(screen.getByText('Turbo activated')).toBeTruthy()

    act(() => { dismissToast(id) })
    expect(screen.queryByText('Turbo activated')).toBeNull()
  })

  it('dismissToast con un id que ya no existe no rompe ni toca a los demás', () => {
    viewport(false)
    render(<Toaster />)
    act(() => { showToast('sigo aquí', 'info') })
    act(() => { dismissToast(9999); dismissToast(null) })
    expect(screen.getByText('sigo aquí')).toBeTruthy()
  })

  it('el hueco declarado sube los toasts por encima de la barra de turno', () => {
    viewport(false)
    render(<Toaster bottomOffset={92} />)
    act(() => { showToast('hola', 'info') })
    expect(stack().style.bottom).toBe('92px')

    act(() => { setToastInset(70) })      // la pantalla monta su barra pegajosa
    expect(stack().style.bottom).toBe('162px')

    act(() => { setToastInset(0) })       // y la retira al salir
    expect(stack().style.bottom).toBe('92px')
  })

  it('en móvil ocupa de lado a lado; en escritorio se queda centrado', () => {
    viewport(false)
    const { unmount } = render(<Toaster />)
    act(() => { showToast('ancho', 'info') })
    expect(stack().style.left).toBe('0px')
    expect(stack().style.right).toBe('0px')
    expect(stack().style.transform).toBe('')
    unmount()

    viewport(true)
    render(<Toaster />)
    act(() => { showToast('centrado', 'info') })
    expect(stack().style.left).toBe('50%')
    expect(stack().style.transform).toBe('translateX(-50%)')
  })
})
