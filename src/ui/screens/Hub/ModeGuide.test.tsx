import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ModeGuide } from './ModeGuide'

beforeEach(() => localStorage.clear())

describe('ModeGuide', () => {
  it('shows the three modes and collapses (persisting the state)', () => {
    render(<MemoryRouter><ModeGuide /></MemoryRouter>)
    expect(screen.getByText('Pack Battle')).toBeTruthy()
    expect(screen.getByText('Battle Royale')).toBeTruthy()
    expect(screen.getByText('Gacha')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /got it/i }))
    expect(localStorage.getItem('ba.lobbyGuideOpen')).toBe('0')
    expect(screen.queryByText('Pack Battle')).toBeNull()
  })
})
