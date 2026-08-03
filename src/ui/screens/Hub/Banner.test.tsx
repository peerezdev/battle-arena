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
