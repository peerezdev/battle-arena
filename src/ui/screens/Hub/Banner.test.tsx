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
  it('con `tail`, la frase va en un párrafo APARTE y después del cuerpo', () => {
    const { container } = pinta({ tail: 'Think you can handle it?' })
    const cuerpo = screen.getByText('More pressure. More adrenaline.')
    const cierre = screen.getByText('Think you can handle it?')
    expect(cierre.tagName).toBe('P')
    expect(cierre).not.toBe(cuerpo)   // pegada al cuerpo se leía como una frase más
    expect(cuerpo.compareDocumentPosition(cierre) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelectorAll('p')).toHaveLength(2)
  })

  it('sin `tail` solo hay un párrafo', () => {
    const { container } = pinta()
    expect(container.querySelectorAll('p')).toHaveLength(1)
  })
})


describe('Banner · botones a la misma altura', () => {
  it('en `stacked` el botón se empuja al fondo de la tarjeta', () => {
    // Los dos banners de abajo del Hub van en una rejilla, así que las tarjetas ya salen igual de
    // altas. Lo que se descuadraba era el botón: quedaba justo donde acababa su párrafo, y como
    // Pack Battle y Gacha tienen textos de distinta longitud, cada uno caía a una altura.
    render(<MemoryRouter><Banner {...base} layout="stacked" /></MemoryRouter>)
    const boton = screen.getByText('Enter →').closest('a') as HTMLAnchorElement
    expect(boton.style.marginTop).toBe('auto')
    // Sin esto, siendo hijo de una columna flex, el botón se estiraría a todo el ancho.
    expect(boton.style.alignSelf).toBe('flex-start')
    // Y el bloque de texto tiene que crecer para que quede hueco que empujar.
    const bloque = boton.parentElement as HTMLElement
    expect(bloque.style.flex).toBe('1 1 0%')   // jsdom expande el shorthand
    expect(bloque.style.flexDirection).toBe('column')
  })

  it('el banner ancho no se toca: ahí no hay pareja con la que cuadrar', () => {
    render(<MemoryRouter><Banner {...base} layout="side" /></MemoryRouter>)
    const boton = screen.getByText('Enter →').closest('a') as HTMLAnchorElement
    expect(boton.style.marginTop).toBe('')
  })
})
