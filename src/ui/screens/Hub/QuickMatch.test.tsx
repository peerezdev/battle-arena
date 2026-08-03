import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QuickMatch } from './QuickMatch'

describe('QuickMatch', () => {
  it('fires create/demo handlers', () => {
    const onCreate = vi.fn(), onPlayDemo = vi.fn()
    render(<QuickMatch onCreate={onCreate} onPlayDemo={onPlayDemo} />)
    fireEvent.click(screen.getByText(/create/i)); expect(onCreate).toHaveBeenCalled()
    fireEvent.click(screen.getByText(/demo/i)); expect(onPlayDemo).toHaveBeenCalled()
  })

  it('adapts copy per mode and hides the demo when onPlayDemo is omitted (royale)', () => {
    render(<QuickMatch mode="royale" onCreate={vi.fn()} />)
    expect(screen.getByText('Battle Royale')).toBeTruthy()
    expect(screen.getByText(/create battle royale/i)).toBeTruthy()
    expect(screen.queryByText(/demo/i)).toBeNull()
  })
})

describe('QuickMatch royale create gate', () => {
  it('shows the create CTA by default', () => {
    render(<QuickMatch mode="royale" onCreate={() => {}} />)
    expect(screen.queryByText(/create battle royale/i)).not.toBeNull()
  })

  it('hides the create CTA when canCreate is false', () => {
    render(<QuickMatch mode="royale" onCreate={() => {}} canCreate={false} />)
    expect(screen.queryByText(/create battle royale/i)).toBeNull()
  })
})


describe('QuickMatch · qué texto lleva cada modo', () => {
  it('royale: solo el titular, y dice "the next"', () => {
    // Encima de este bloque va RoyaleDemoNotice, que ya presenta el modo entero. El rótulo
    // "Quick match" y la descripción repetían lo mismo en la misma pantalla.
    render(<QuickMatch mode="royale" onCreate={vi.fn()} />)
    expect(screen.getByRole('heading').textContent).toBe('Jump into the next Battle Royale')
    expect(screen.queryByText('Quick match')).toBeNull()
    expect(screen.queryByText(/lowest value drops each round/i)).toBeNull()
  })

  it('pack conserva rótulo, titular y descripción', () => {
    // Ahí no hay nada encima que lo explique, así que el texto sigue haciendo falta.
    render(<QuickMatch mode="pack" onCreate={vi.fn()} />)
    expect(screen.getByRole('heading').textContent).toBe('Jump into a Pack Battle')
    expect(screen.getByText('Quick match')).toBeTruthy()
    expect(screen.getByText(/highest total takes them all/i)).toBeTruthy()
  })

  it('la descripción de pack no lo llama 1v1', () => {
    // Una Pack Battle admite de 2 a 4 jugadores. Llamarla 1v1 describía mal el modo y hacía
    // pensar que solo se juega en pareja.
    render(<QuickMatch mode="pack" onCreate={vi.fn()} />)
    const desc = screen.getByText(/highest total takes them all/i).textContent ?? ''
    expect(desc).not.toMatch(/1v1|head-to-head/i)
    expect(desc).toMatch(/two to four/i)     // cuántos caben
    expect(desc).toMatch(/one or more/i)     // uno o varios sobres
    expect(desc).toMatch(/adds to your total/i)   // se acumula, no es una sola carta
  })
})
