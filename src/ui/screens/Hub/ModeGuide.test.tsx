import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ModeGuide } from './ModeGuide'

beforeEach(() => localStorage.clear())

describe('ModeGuide', () => {
  it('Pack Battle son 2–4 jugadores, NO 1v1', () => {
    // Arrastraba "1V1" de cuando pack era solo un duelo. `PLAYER_COUNTS_BY_MODE` permite 2, 3 o 4,
    // y para un recién llegado esto es lo primero que lee: si dice 1v1, empieza equivocado.
    render(<MemoryRouter><ModeGuide /></MemoryRouter>)
    expect(screen.getByText(/2–4 PLAYERS/)).toBeTruthy()
    expect(screen.queryByText(/1V1/i)).toBeNull()
  })

  it('la descripción de pack tampoco habla de "las dos cartas"', () => {
    // Con cuatro jugadores hay cuatro. El mismo error que el tag, en otra frase.
    render(<MemoryRouter><ModeGuide /></MemoryRouter>)
    expect(screen.queryByText(/both cards/i)).toBeNull()
    expect(screen.getByText(/every card on the table/)).toBeTruthy()
  })

  it('plegada deja una forma de volver, no desaparece', () => {
    // Es la diferencia con el aviso de la demo: eso es permanente porque hay un vídeo que repasar;
    // esto es texto, y quien ya lo leyó necesita poder volver, no verlo siempre.
    render(<MemoryRouter><ModeGuide /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /got it/i }))
    expect(screen.getByRole('button', { name: /show/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /show/i }))
    expect(screen.getByText('Pack Battle')).toBeTruthy()
  })

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
