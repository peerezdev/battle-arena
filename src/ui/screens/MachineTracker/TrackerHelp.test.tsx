import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TrackerHelp } from './TrackerHelp'

const abrir = () => fireEvent.click(screen.getByRole('button', { name: /How to read a card/i }))

describe('el explicador del tracker', () => {
  it('va CERRADO al entrar', () => {
    // Es una pantalla a la que se vuelve: abierto empujaría la rejilla hacia abajo cada vez, y el
    // trabajo aquí es comparar máquinas, no leer.
    render(<TrackerHelp />)
    expect(screen.queryByText(/per dollar/)).toBeNull()
    expect(screen.getByRole('button', { name: /How to read a card/i }).getAttribute('aria-expanded'))
      .toBe('false')
  })

  it('se abre y se cierra', () => {
    render(<TrackerHelp />)
    abrir()
    expect(screen.getByText(/per dollar/)).toBeTruthy()
    abrir()
    expect(screen.queryByText(/per dollar/)).toBeNull()
  })

  it('explica el número grande con un ejemplo, no con una definición', () => {
    // "cuánto devuelve por dólar" es abstracto; "0.94 son 94 céntimos" se entiende sin releer.
    render(<TrackerHelp />)
    abrir()
    expect(screen.getByText(/94 cents back/)).toBeTruthy()
  })

  it('distingue lo medido de lo esperado, que es la pregunta de la tarjeta', () => {
    render(<TrackerHelp />)
    abrir()
    expect(screen.getByText(/actually/)).toBeTruthy()
    expect(screen.getByText(/should/)).toBeTruthy()
  })

  it('explica UNCLEAR por el margen de error y no como un fallo', () => {
    // Sin esto se lee como que la pantalla no funciona, cuando es la pantalla negándose a afirmar
    // lo que no puede.
    render(<TrackerHelp />)
    abrir()
    expect(screen.getByText(/margin of error/)).toBeTruthy()
    expect(screen.getByText(/instead of picking a side/)).toBeTruthy()
  })

  it('AVISA de que una racha larga NO hace la rareza más probable', () => {
    // Es la frase que no puede faltar. Sin ella el tracker se convierte en una herramienta para
    // perseguir rachas, que es lo contrario de para lo que existe.
    render(<TrackerHelp />)
    abrir()
    expect(screen.getByText(/VRF and every pull is independent/)).toBeTruthy()
    // El "not" va en negrita, así que el texto está partido: se busca la mitad que lo sigue.
    expect(screen.getByText(/make it more likely/)).toBeTruthy()
  })

  it('dice que los cuatro GROSS suman el modelo', () => {
    // Es lo que permite comprobar la tarjeta con una calculadora, y lo que había roto el
    // interruptor de valoración.
    render(<TrackerHelp />)
    abrir()
    expect(screen.getByText(/add up to the model/)).toBeTruthy()
  })

  it('explica el interruptor diciendo que las DOS lecturas son ciertas', () => {
    render(<TrackerHelp />)
    abrir()
    expect(screen.getByText(/Both are true/)).toBeTruthy()
  })

  it('usa las mismas palabras que la tarjeta', () => {
    // Un explicador con su propio vocabulario obliga a traducir dos veces.
    render(<TrackerHelp />)
    abrir()
    for (const t of ['P', 'VALUE', 'GROSS', 'GAP', 'AVG']) {
      expect(screen.getAllByText(t).length).toBeGreaterThan(0)
    }
    expect(screen.getByRole('heading', { name: /UNCLEAR/i })).toBeTruthy()
  })
})
