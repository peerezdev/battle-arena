import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HelpPage } from './HelpPage'

describe('HelpPage', () => {
  it('renders the modes and the platform-fee disclosure', () => {
    render(<MemoryRouter><HelpPage /></MemoryRouter>)
    expect(screen.getByText('How Collector Arena works')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Pack Battle' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Battle Royale' })).toBeTruthy()
    expect(screen.getByText('Platform fee')).toBeTruthy()   // fee disclosure card
  })
})
