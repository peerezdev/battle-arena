import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { StagedCardReveal } from './StagedCardReveal'
import { STACK_T, BAND_T } from './revealTiming'

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

  it('non-reduced starts on the first pre-card stage (YEAR), y no antes de su turno', () => {
    vi.useFakeTimers()
    render(
      <StagedCardReveal year="2018" grade={10} rarity="Epic" reduced={false}>
        <div>THE CARD</div>
      </StagedCardReveal>,
    )
    // El año ya no se pinta en el ms 0: espera su turno igual que en el modo apilado, que es
    // lo que hace que las dos ceremonias suenen iguales.
    expect(screen.queryByText('2018')).toBeNull()
    act(() => { vi.advanceTimersByTime(STACK_T.first) })
    expect(screen.getByText('2018')).toBeTruthy()       // first stage = year
    expect(screen.queryByText('THE CARD')).toBeNull()   // card not yet
    vi.useRealTimers()
  })

  it('sin stacked solo hay UN valor a la vez (lo que usa Pack Battle)', () => {
    vi.useFakeTimers()
    render(
      <StagedCardReveal year="2018" grade={10} rarity="Epic" reduced={false}>
        <div>THE CARD</div>
      </StagedCardReveal>,
    )
    act(() => { vi.advanceTimersByTime(STACK_T.first) })
    expect(screen.getByText('2018')).toBeTruthy()
    expect(screen.queryByText('10')).toBeNull()         // el grado aún no está montado
    expect(screen.queryByText('EPIC')).toBeNull()
    vi.useRealTimers()
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

describe('StagedCardReveal · franja de rareza', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const renderStacked = (rarity: string) => render(
    <StagedCardReveal year="2010" grade="PSA 10" rarity={rarity} reduced={false} stacked>
      <div>THE CARD</div>
    </StagedCardReveal>,
  )
  // Con las tres filas, la rareza cae a los 1750 ms: 500 + 2×500 + 250 de propina.
  const RARITY_AT = STACK_T.first + 2 * STACK_T.step + STACK_T.rarityExtra

  it('la rareza aterriza a los 1750 ms, que es de donde cuelga todo lo demás', () => {
    expect(RARITY_AT).toBe(1750)
    expect(RARITY_AT + BAND_T.band).toBe(2100)        // franja
    expect(RARITY_AT + BAND_T.epicSpin).toBe(2700)    // giro de Epic
    expect(RARITY_AT + BAND_T.epicLand).toBe(4500)    // Epic de cara
    expect(RARITY_AT + BAND_T.rareFlip).toBe(3500)    // Rare de cara
  })

  it('en Rare la franja sale a los 2100 y se va con el volteo', () => {
    renderStacked('Rare')
    // La fila de la carta YA escribe "RARE" en mayúsculas, así que la franja se cuenta, no se
    // busca: una aparición es solo la fila; dos, la fila más la franja.
    act(() => { vi.advanceTimersByTime(RARITY_AT + BAND_T.band - 1) })
    expect(screen.getAllByText('RARE')).toHaveLength(1)

    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.getAllByText('RARE')).toHaveLength(2)   // franja dentro

    act(() => { vi.advanceTimersByTime(BAND_T.rareFlip - BAND_T.band) })
    expect(screen.getByText('THE CARD')).toBeTruthy() // volteo
  })

  it('Common y Uncommon no montan franja en ningún momento', () => {
    renderStacked('Common')
    // En el instante en que una Rare ya tendría franja, aquí sigue habiendo una sola aparición:
    // la fila de la carta. Se mira ANTES del volteo, que desmonta el dorso y con él la fila.
    act(() => { vi.advanceTimersByTime(RARITY_AT + BAND_T.band + 100) })
    expect(screen.getAllByText('COMMON')).toHaveLength(1)

    act(() => { vi.advanceTimersByTime(6000) })
    expect(screen.getByText('THE CARD')).toBeTruthy()
  })
})
