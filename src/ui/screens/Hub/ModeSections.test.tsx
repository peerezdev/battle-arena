import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ModeSections } from './ModeSections'

const renderIt = () => render(<MemoryRouter><ModeSections /></MemoryRouter>)

describe('ModeSections', () => {
  // Copy (titles/tags/CTA text) changes freely, so assert structure/routing, not wording.
  it('renders a section CTA linking into each of the three mode pages', () => {
    renderIt()
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    // Los dos modos de batalla apuntan ya al Lobby con su filtro, no a las rutas viejas: esas
    // siguen vivas solo como redirección, y enlazar a un redirect es un salto de más.
    expect(hrefs).toContain('/play/lobby?mode=royale')
    expect(hrefs).toContain('/play/lobby?mode=pack')
    expect(hrefs).toContain('/play/gacha')
  })
})
