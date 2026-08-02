import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { WinnerDrawOverlay } from './WinnerDrawOverlay'
import { spinSequence } from './royaleShared'

const nombre = (w: string) => ({ A: 'alicia', B: 'bruno', C: 'carla', D: 'dani' }[w] ?? w)
const TRES = ['A', 'B', 'C']

describe('WinnerDrawOverlay', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const pinta = (tied: string[], winner: string, reduced = false) =>
    render(<WinnerDrawOverlay tied={tied} winner={winner} value={305} nameOf={nombre} reducedMotion={reduced} />)

  // Cada paso del giro programa el siguiente desde un efecto, así que hay que dejar a React
  // renderizar entre timer y timer: un solo advanceTimersByTime(total) solo avanza uno.
  const girarHastaElFinal = (tied: string[], winner: string) => {
    for (let k = 0; k < spinSequence(tied, winner).length + 2; k++) {
      act(() => { vi.advanceTimersByTime(400) })
    }
  }

  it('arranca girando, no con el resultado puesto', () => {
    pinta(TRES, 'C')
    expect(screen.getByText(/Drawing a winner at random/)).toBeTruthy()
    expect(screen.queryByText('★ WINNER')).toBeNull()
    expect(screen.getByText('3 tied')).toBeTruthy()
  })

  it('aterriza en el ganador, y en nadie más', () => {
    // Lo que hace fiel a la animación: el que sale es el que decidió la semilla del backend.
    pinta(TRES, 'C')
    girarHastaElFinal(TRES, 'C')
    expect(screen.getByText('★ WINNER')).toBeTruthy()
    expect(screen.getByText('carla')).toBeTruthy()
    expect(screen.queryByText('alicia')).toBeNull()
    expect(screen.queryByText('bruno')).toBeNull()
  })

  it('el empate a dos también aterriza donde toca', () => {
    pinta(['A', 'B'], 'A')
    girarHastaElFinal(['A', 'B'], 'A')
    expect(screen.getByText('alicia')).toBeTruthy()
    expect(screen.queryByText('bruno')).toBeNull()
  })

  it('con reduced-motion sale ya resuelto, sin girar', () => {
    pinta(TRES, 'C', true)
    expect(screen.getByText('★ WINNER')).toBeTruthy()
    expect(screen.getByText('carla')).toBeTruthy()
    expect(screen.queryByText(/Drawing a winner/)).toBeNull()
  })

  it('dice a cuánto se empató, que es de dónde viene el sorteo', () => {
    pinta(TRES, 'C')
    expect(screen.getByText(/TIED FOR FIRST · \$305/)).toBeTruthy()
  })
})
