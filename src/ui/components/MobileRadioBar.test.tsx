import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MobileRadioBar } from './MobileRadioBar'

const mocks = vi.hoisted(() => ({
  radio: {
    tracks: [{ id: 't1', title: 'Lavender Town', artist: 'x' }],
    track: { id: 't1', title: 'Lavender Town', artist: 'x' },
    isPlaying: true,
    toggle: vi.fn(),
    next: vi.fn(),
  } as Record<string, unknown>,
}))
vi.mock('../radio/useRadio', () => ({ useRadio: () => mocks.radio }))

beforeEach(() => {
  mocks.radio.isPlaying = true
  mocks.radio.toggle = vi.fn()
  mocks.radio.next = vi.fn()
})

describe('MobileRadioBar', () => {
  it('shows the track and LIVE while playing; toggle and next fire the store', () => {
    render(<MobileRadioBar />)
    expect(screen.getByText('Lavender Town')).toBeTruthy()
    expect(screen.getByText(/ARENA RADIO · LIVE/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Pausar'))
    expect(mocks.radio.toggle).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByLabelText('Siguiente'))
    expect(mocks.radio.next).toHaveBeenCalledTimes(1)
  })

  it('shows PAUSED and the play control while paused', () => {
    mocks.radio.isPlaying = false
    render(<MobileRadioBar />)
    expect(screen.getByText(/ARENA RADIO · PAUSED/)).toBeTruthy()
    expect(screen.getByLabelText('Reproducir')).toBeTruthy()
  })
})
