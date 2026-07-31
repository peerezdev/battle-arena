import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { AlphaVideo } from './AlphaVideo'

// Un <video> no recarga porque cambie el `src` de su <source>. Reutilizando el nodo, la barra de
// emotes se quedaba con el primero que cargó por mucho que se eligiera otro.
describe('AlphaVideo', () => {
  it('remonta el vídeo cuando cambia la fuente', () => {
    const { container, rerender } = render(<AlphaVideo webm="https://x.test/uno.webm" />)
    const antes = container.querySelector('video')

    rerender(<AlphaVideo webm="https://x.test/dos.webm" />)
    const despues = container.querySelector('video')

    expect(despues?.querySelector('source')?.getAttribute('src')).toContain('dos.webm')
    expect(despues).not.toBe(antes)
  })

  it('no lo remonta si la fuente no cambia', () => {
    const { container, rerender } = render(<AlphaVideo webm="https://x.test/uno.webm" />)
    const antes = container.querySelector('video')
    rerender(<AlphaVideo webm="https://x.test/uno.webm" loop={false} />)
    expect(container.querySelector('video')).toBe(antes)
  })
})
