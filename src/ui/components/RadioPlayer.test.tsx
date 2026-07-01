import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const { actions, state } = vi.hoisted(() => ({
  actions: {
    play: vi.fn(), pause: vi.fn(), toggle: vi.fn(), next: vi.fn(), prev: vi.fn(),
    select: vi.fn(), setVolume: vi.fn(), toggleShuffle: vi.fn(), tryAutoplay: vi.fn(),
  },
  state: { isPlaying: false },
}))

vi.mock('../useIsWide', () => ({ useIsWide: () => true }))
vi.mock('../radio/useRadio', () => ({
  useRadio: () => ({
    index: 0,
    isPlaying: state.isPlaying,
    volume: 0.6,
    shuffle: false,
    currentTime: 0,
    duration: 0,
    tracks: [
      { id: 'a', title: 'Track A', artist: 'x', url: 'ua' },
      { id: 'b', title: 'Track B', artist: 'y', url: 'ub' },
    ],
    track: { id: 'a', title: 'Track A', artist: 'x', url: 'ua' },
    ...actions,
  }),
}))

import { RadioPlayer } from './RadioPlayer'

describe('RadioPlayer', () => {
  beforeEach(() => {
    Object.values(actions).forEach((fn) => fn.mockClear())
    state.isPlaying = false
  })

  it('does NOT autoplay on mount (starts paused by default)', () => {
    render(<RadioPlayer />)
    expect(actions.tryAutoplay).not.toHaveBeenCalled()
  })

  it('shows the current track title', () => {
    render(<RadioPlayer />)
    expect(screen.getByText('Track A')).toBeTruthy()
  })

  it('prev / play-pause / next call the store', () => {
    render(<RadioPlayer />)
    fireEvent.click(screen.getByLabelText('Anterior'))
    expect(actions.prev).toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('Reproducir'))
    expect(actions.toggle).toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('Siguiente'))
    expect(actions.next).toHaveBeenCalled()
  })

  it('opens the panel and selecting a track plays it', () => {
    render(<RadioPlayer />)
    fireEvent.click(screen.getByLabelText('Cambiar emisora'))
    const entry = screen.getByRole('button', { name: /Track B/ })
    fireEvent.click(entry)
    expect(actions.select).toHaveBeenCalledWith(1)
  })

  it('volume popover slider calls setVolume', () => {
    render(<RadioPlayer />)
    fireEvent.click(screen.getByLabelText('Volumen'))                 // open the popover
    fireEvent.change(screen.getByLabelText('Nivel de volumen'), { target: { value: '40' } })
    expect(actions.setVolume).toHaveBeenCalledWith(0.4)               // 0–100 slider → 0–1 store
  })

  it('shuffle toggle calls toggleShuffle', () => {
    render(<RadioPlayer />)
    fireEvent.click(screen.getByLabelText('Cambiar emisora'))
    fireEvent.click(screen.getByLabelText('Mezclar'))
    expect(actions.toggleShuffle).toHaveBeenCalled()
  })
})
