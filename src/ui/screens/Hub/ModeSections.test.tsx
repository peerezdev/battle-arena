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
    expect(hrefs).toContain('/play/royale')
    expect(hrefs).toContain('/play/arena')
    expect(hrefs).toContain('/play/gacha')
  })
})
