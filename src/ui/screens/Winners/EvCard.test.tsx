import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { EvCard } from './EvCard'
import type { EvRow } from '../../../onchain/gachaClient'

const fila = (over: Partial<EvRow> = {}): EvRow => ({
  machine: 'pokemon_50', name: 'Elite Pokémon Gacha Pack', pack_price: 50, buyback_pct: 0.85,
  realized_n_pulls: 16157, realized_window_hours: 48, window_complete: true, hours_covered: 48,
  gaps: [], realized_edge_pct: -6.21, realized_ci_lo_pct: -8.27, realized_ci_hi_pct: -4.24,
  realized_verdict: 'CONFIDENT -EV', pulls_to_conclude: null, ...over,
})

const agujas = (c: HTMLElement) => c.querySelectorAll('svg line').length

describe('EvCard', () => {
  it('enseña el ratio medido, no el edge, como número principal', () => {
    // 1 + (−6.21/100). Es lo que marca la aguja, y el número grande tiene que coincidir con ella.
    render(<EvCard fila={fila()} />)
    expect(screen.getByText('0.938')).toBeTruthy()
  })

  it('lleva el precio y el buyback en la cabecera', () => {
    render(<EvCard fila={fila()} />)
    expect(screen.getByText(/\$50 · bb 85%/)).toBeTruthy()
  })

  it('un veredicto confirmado se puede vestir de conclusión', () => {
    render(<EvCard fila={fila()} />)
    expect(screen.getByText('CONFIRMED −EV')).toBeTruthy()
    expect(screen.getByText(/95% CI −?-?8.27/)).toBeTruthy()
  })

  it('con la ventana a medias el número NO se pinta de rojo', () => {
    // La regla del diseño: un rojo fuerte sobre seis horas de datos afirma algo que los datos no
    // dicen. El número se enseña igual, en gris, y la etiqueta explica por qué.
    const { container } = render(<EvCard fila={fila({
      realized_verdict: 'BUILDING', window_complete: false, hours_covered: 6,
    })} />)
    expect(screen.getByText(/BUILDING · 6h \/ 48h/)).toBeTruthy()
    expect(screen.getByText(/until the window is full/i)).toBeTruthy()
    expect(container.innerHTML).not.toContain('#ff5e7a')      // la tinta de "malo confirmado"
  })

  it('con un hueco dentro de la ventana tampoco', () => {
    const { container } = render(<EvCard fila={fila({
      realized_verdict: 'GAP IN WINDOW', gaps: [['a', 'b']],
    })} />)
    expect(screen.getByText('GAP IN WINDOW')).toBeTruthy()
    expect(container.innerHTML).not.toContain('#ff5e7a')
  })

  it('sin medición no dibuja aguja', () => {
    // Una aguja en el centro se leería como "paga justo", que es afirmar algo sin datos.
    const { container } = render(<EvCard fila={fila({
      realized_edge_pct: null, realized_ci_lo_pct: null, realized_ci_hi_pct: null,
      realized_verdict: 'NOT ENOUGH DATA', realized_n_pulls: 12,
    })} />)
    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.getByText('NOT ENOUGH DATA')).toBeTruthy()
    expect(screen.getByText(/Only 12 pulls/)).toBeTruthy()
    expect(agujas(container)).toBe(1)     // solo la marca del 1.00, sin aguja
  })

  it('con medición sí dibuja aguja', () => {
    const { container } = render(<EvCard fila={fila()} />)
    expect(agujas(container)).toBe(2)     // la marca del 1.00 y la aguja
  })

  it('una máquina que paga de más se pinta en verde', () => {
    const { container } = render(<EvCard fila={fila({
      realized_edge_pct: 4.2, realized_ci_lo_pct: 2.1, realized_ci_hi_pct: 6.4,
      realized_verdict: 'CONFIDENT +EV',
    })} />)
    expect(screen.getByText('CONFIRMED +EV')).toBeTruthy()
    expect(screen.getByText('1.042')).toBeTruthy()
    expect(container.innerHTML).toContain('#00ffc4')
  })

  it('sin concluir ofrece cuánta muestra faltaría', () => {
    render(<EvCard fila={fila({
      realized_verdict: 'unclear (CI crosses zero)', realized_n_pulls: 543,
      realized_edge_pct: -11.14, realized_ci_lo_pct: -21.63, realized_ci_hi_pct: 0.93,
      pulls_to_conclude: 1400,
    })} />)
    expect(screen.getByText(/UNCLEAR/)).toBeTruthy()
    expect(screen.getByText(/1,400 pulls would settle it/)).toBeTruthy()
  })
})
