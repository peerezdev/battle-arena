import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ModeSections } from './ModeSections'

const renderIt = () => render(<MemoryRouter><ModeSections /></MemoryRouter>)

describe('ModeSections', () => {
  it('renders the three modes in order with their tags', () => {
    renderIt()
    expect(screen.getByText('Battle Royale')).toBeTruthy()
    expect(screen.getByText('Pack Battle')).toBeTruthy()
    expect(screen.getByText('Gacha')).toBeTruthy()
    expect(screen.getByText('2–10 PLAYERS')).toBeTruthy()
    expect(screen.getByText('1V1 · WINNER TAKES ALL')).toBeTruthy()
  })

  it('each CTA links into its mode page', () => {
    renderIt()
    expect(screen.getByRole('link', { name: /Enter the Royale/ }).getAttribute('href')).toBe('/play/royale')
    expect(screen.getByRole('link', { name: /Find a rival/ }).getAttribute('href')).toBe('/play/arena')
    expect(screen.getByRole('link', { name: /Spin the Gacha/ }).getAttribute('href')).toBe('/play/gacha')
  })
})
