import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
vi.mock('../../useReducedMotion', () => ({ useReducedMotion: () => true }))  // no auto-advance in this test
import { NewsCarousel } from './NewsCarousel'
import { LOBBY_NEWS } from './lobbyNews'

describe('NewsCarousel', () => {
  it('shows the first item and advances on next', () => {
    render(<MemoryRouter><NewsCarousel /></MemoryRouter>)
    expect(screen.getAllByText(LOBBY_NEWS[0].title)[0]).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Next'))
    expect(screen.getAllByText(LOBBY_NEWS[1].title)[0]).toBeTruthy()
  })
})
