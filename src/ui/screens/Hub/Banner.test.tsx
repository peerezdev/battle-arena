import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Banner } from './Banner'

const base = {
  kicker: '02 · PACK BATTLE',
  titlePlain: 'Open a pack.',
  body: 'More pressure. More adrenaline.',
  cta: 'Enter →',
  to: '/play/arena',
  accent: '#3ce8a8',
}

const pinta = (props: Partial<React.ComponentProps<typeof Banner>> = {}) =>
  render(<MemoryRouter><Banner {...base} {...props} /></MemoryRouter>)

describe('Banner · frase de cierre', () => {
  it('con `tail`, la frase va aparte y con una raya delante', () => {
    const { container } = pinta({ tail: 'Think you can handle it?' })
    const cuerpo = screen.getByText('More pressure. More adrenaline.')
    const cierre = screen.getByText('Think you can handle it?')
    // Párrafos distintos: pegada al cuerpo se leía como una frase más.
    expect(cierre).not.toBe(cuerpo)
    // Y una raya entre los dos, en ese orden.
    const raya = container.querySelector('div[aria-hidden]') as HTMLElement
    expect(raya).toBeTruthy()
    expect(cuerpo.compareDocumentPosition(raya) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(raya.compareDocumentPosition(cierre) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('la raya toma el color del acento del banner', () => {
    const { container } = pinta({ tail: 'Vamos', accent: '#a98bff' })
    const raya = container.querySelector('div[aria-hidden]') as HTMLElement
    // jsdom normaliza el hex+alfa a rgba(), así que se compara contra el color ya resuelto:
    // #a98bff → 169,139,255.
    expect(raya.style.background).toContain('gradient')
    expect(raya.style.background).toContain('rgba(169, 139, 255')
  })

  it('sin `tail` no se pinta ninguna raya', () => {
    // La mayoría de banners no tienen frase de cierre; no pueden salir con una raya suelta.
    const { container } = pinta()
    expect(container.querySelector('div[aria-hidden]')).toBeNull()
  })
})
