import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { PotGain, POT_GAIN_MS } from './PotGain'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('PotGain', () => {
  it('no enseña nada en el primer render: aún no ha subido nada', () => {
    render(<PotGain pot={100} />)
    expect(screen.queryByText(/^\+/)).toBeNull()
  })

  it('al subir el bote muestra el incremento, no el total', () => {
    const { rerender } = render(<PotGain pot={100} />)
    rerender(<PotGain pot={220} />)
    expect(screen.getByText('+$120')).toBeTruthy()
    expect(screen.queryByText('+$220')).toBeNull()
  })

  it('se desvanece solo tras POT_GAIN_MS', () => {
    const { rerender } = render(<PotGain pot={0} />)
    rerender(<PotGain pot={50} />)
    expect(screen.getByText('+$50')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(POT_GAIN_MS + 10) })
    expect(screen.queryByText('+$50')).toBeNull()
  })

  it('dos cartas seguidas reinician el aviso con el nuevo importe', () => {
    const { rerender } = render(<PotGain pot={0} />)
    rerender(<PotGain pot={50} />)
    act(() => { vi.advanceTimersByTime(POT_GAIN_MS / 2) })
    rerender(<PotGain pot={130} />)
    expect(screen.getByText('+$80')).toBeTruthy()      // el delta, no el acumulado
    expect(screen.queryByText('+$50')).toBeNull()
    // y el temporizador arranca de cero, no hereda lo consumido
    act(() => { vi.advanceTimersByTime(POT_GAIN_MS / 2 + 10) })
    expect(screen.getByText('+$80')).toBeTruthy()
  })

  it('un bote que no cambia no dispara nada', () => {
    const { rerender } = render(<PotGain pot={100} />)
    rerender(<PotGain pot={100} />)
    expect(screen.queryByText(/^\+/)).toBeNull()
  })

  it('un bote que baja no enseña un incremento negativo', () => {
    // Pasa al reiniciar el reveal (volver a ver la batalla): la proyección vuelve a cero.
    const { rerender } = render(<PotGain pot={300} />)
    rerender(<PotGain pot={0} />)
    expect(screen.queryByText(/^\+/)).toBeNull()
  })
})
