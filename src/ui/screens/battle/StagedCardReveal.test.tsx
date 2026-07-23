import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StagedCardReveal } from './StagedCardReveal'

describe('StagedCardReveal', () => {
  it('reduced-motion jumps straight to the card and fires onCardShown', () => {
    const onCardShown = vi.fn()
    render(
      <StagedCardReveal year="2018" grade={10} rarity="Epic" reduced onCardShown={onCardShown}>
        <div>THE CARD</div>
      </StagedCardReveal>,
    )
    expect(screen.getByText('THE CARD')).toBeTruthy()   // card slot shown immediately
    expect(screen.queryByText('2018')).toBeNull()       // year stage skipped
    expect(onCardShown).toHaveBeenCalled()
  })

  it('non-reduced starts on the first pre-card stage (YEAR)', () => {
    render(
      <StagedCardReveal year="2018" grade={10} rarity="Epic" reduced={false}>
        <div>THE CARD</div>
      </StagedCardReveal>,
    )
    expect(screen.getByText('2018')).toBeTruthy()       // first stage = year
    expect(screen.queryByText('THE CARD')).toBeNull()   // card not yet
  })

  it('sin stacked solo hay UN valor a la vez (lo que usa Pack Battle)', () => {
    render(
      <StagedCardReveal year="2018" grade={10} rarity="Epic" reduced={false}>
        <div>THE CARD</div>
      </StagedCardReveal>,
    )
    expect(screen.getByText('2018')).toBeTruthy()
    expect(screen.queryByText('10')).toBeNull()         // el grado aún no está montado
    expect(screen.queryByText('EPIC')).toBeNull()
  })
})

describe('StagedCardReveal · modo apilado (Battle Royale)', () => {
  it('monta las tres filas desde el principio y las va mostrando', () => {
    // Apiladas quiere decir que conviven: las tres están en el DOM desde el primer momento y lo
    // que cambia es su opacidad, no su existencia. Por eso aquí se comprueban las tres.
    render(
      <StagedCardReveal year="2018" grade="PSA MINT 9" rarity="Epic" reduced={false} stacked>
        <div>THE CARD</div>
      </StagedCardReveal>,
    )
    expect(screen.getByText('2018')).toBeTruthy()
    expect(screen.getByText('PSA MINT 9')).toBeTruthy()
    expect(screen.getByText('EPIC')).toBeTruthy()       // rareza directa, sin ruleta
    expect(screen.getByText('Year')).toBeTruthy()
    expect(screen.getByText('Grade')).toBeTruthy()
    expect(screen.getByText('Rarity')).toBeTruthy()
    expect(screen.queryByText('THE CARD')).toBeNull()   // todavía sin voltear
  })

  it('arranca con las tres filas ocultas y ninguna visible', () => {
    const { container } = render(
      <StagedCardReveal year="2018" grade={10} rarity="Rare" reduced={false} stacked>
        <div>THE CARD</div>
      </StagedCardReveal>,
    )
    const fila = (t: string) => screen.getByText(t).parentElement as HTMLElement
    for (const t of ['2018', '10', 'RARE']) expect(fila(t).style.opacity).toBe('0')
    expect(container).toBeTruthy()
  })

  it('omite las filas que la carta no trae', () => {
    render(
      <StagedCardReveal year={null} grade={null} rarity="Common" reduced={false} stacked>
        <div>THE CARD</div>
      </StagedCardReveal>,
    )
    expect(screen.queryByText('Year')).toBeNull()
    expect(screen.queryByText('Grade')).toBeNull()
    expect(screen.getByText('COMMON')).toBeTruthy()
  })

  it('con reduced-motion entrega la carta sin ceremonia', () => {
    const onCardShown = vi.fn()
    render(
      <StagedCardReveal year="2018" grade={10} rarity="Epic" reduced stacked onCardShown={onCardShown}>
        <div>THE CARD</div>
      </StagedCardReveal>,
    )
    expect(screen.getByText('THE CARD')).toBeTruthy()
    expect(screen.queryByText('2018')).toBeNull()
    expect(onCardShown).toHaveBeenCalled()
  })
})
