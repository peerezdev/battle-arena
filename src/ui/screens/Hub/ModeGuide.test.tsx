import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ModeGuide } from './ModeGuide'

beforeEach(() => localStorage.clear())

describe('ModeGuide', () => {
  it('Pack Battle son 2-4 jugadores, NO 1v1', () => {
    // Arrastraba "1V1" de cuando pack era solo un duelo. `PLAYER_COUNTS_BY_MODE` permite 2, 3 o 4,
    // y para un recién llegado esto es lo primero que lee: si dice 1v1, empieza equivocado.
    render(<MemoryRouter><ModeGuide /></MemoryRouter>)
    expect(screen.getByText(/2-4 PLAYERS/)).toBeTruthy()
    expect(screen.queryByText(/1V1/i)).toBeNull()
  })

  it('Battle Royale son de 5 a 10 jugadores, no "hasta 10"', () => {
    // `PLAYER_COUNTS_BY_MODE` da royale [5..10]: no se puede crear una de dos, así que "2-10" o
    // "up to 10" mandaban a intentar algo imposible.
    render(<MemoryRouter><ModeGuide /></MemoryRouter>)
    expect(screen.getByText(/5-10 PLAYERS/)).toBeTruthy()
    expect(screen.getByText(/Five to ten players/)).toBeTruthy()
    expect(screen.queryByText(/Up to 10 players/i)).toBeNull()
  })

  it('ninguna descripción usa guion largo', () => {
    // Los guiones largos en copy se leen como texto hecho por una máquina.
    const { container } = render(<MemoryRouter><ModeGuide /></MemoryRouter>)
    expect(container.textContent).not.toContain('—')
  })

  it('la descripción de pack tampoco habla de "las dos cartas"', () => {
    // Con cuatro jugadores hay cuatro. El mismo error que el tag, en otra frase.
    render(<MemoryRouter><ModeGuide /></MemoryRouter>)
    expect(screen.queryByText(/both cards/i)).toBeNull()
    expect(screen.getByText(/every card on the table/)).toBeTruthy()
  })

  it('el rótulo dice qué es la caja, y no "Get Started"', () => {
    render(<MemoryRouter><ModeGuide /></MemoryRouter>)
    // En mayúsculas, como el resto de los rótulos de la app.
    expect(screen.getByRole('heading', { name: 'HOW EACH MODE WORKS' })).toBeTruthy()
    expect(screen.queryByText(/get started/i)).toBeNull()
  })

  it('no repite en prosa lo que ya dicen las tarjetas', () => {
    // Se quitaron el titular y el párrafo de introducción: las tres tarjetas explican los modos, y
    // contarlo antes en texto era decir dos veces lo mismo antes de que se leyera una.
    render(<MemoryRouter><ModeGuide /></MemoryRouter>)
    expect(screen.queryByText(/New here/i)).toBeNull()
    expect(screen.queryByText(/Three ways to play/i)).toBeNull()
  })

  it('los botones van arriba, junto al rótulo', () => {
    // "Got it" tiene que estar donde se mira al llegar, no al final de un bloque que ya se decidió
    // no leer.
    render(<MemoryRouter><ModeGuide /></MemoryRouter>)
    const rotulo = screen.getByRole('heading', { name: 'HOW EACH MODE WORKS' })
    const gotIt = screen.getByRole('button', { name: /got it/i })
    const primeraTarjeta = screen.getByText('Pack Battle')
    // Por posición en el DOM: el botón va antes que las tarjetas.
    expect(gotIt.compareDocumentPosition(primeraTarjeta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Y comparte fila con el rótulo.
    expect(rotulo.parentElement).toBe(gotIt.parentElement?.parentElement)
  })

  it('plegada tampoco dice "New here"', () => {
    render(<MemoryRouter><ModeGuide /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /got it/i }))
    expect(screen.getByText('How each mode works')).toBeTruthy()
    expect(screen.queryByText(/New here/i)).toBeNull()
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
