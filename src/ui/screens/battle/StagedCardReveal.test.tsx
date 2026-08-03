import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
const playEpicSpin = vi.fn()
const playFlipThump = vi.fn()
const stopReveal = vi.fn()
vi.mock('../../sfx', () => ({
  playEpicSpin: () => playEpicSpin(),
  playFlipThump: () => playFlipThump(),
  stopReveal: () => stopReveal(),
}))
import { StagedCardReveal } from './StagedCardReveal'
import { PHASE, PACK_PHASE, buildTimeline } from './revealTiming'

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
    vi.useFakeTimers()
    render(
      <StagedCardReveal year="2018" grade={10} rarity="Epic" reduced={false}>
        <div>THE CARD</div>
      </StagedCardReveal>,
    )
    // Con el modelo de duraciones, `year: 500` es lo que DURA la fila, no lo que espera: entra
    // en el ms 0 y se va cuando entra el grado.
    act(() => { vi.advanceTimersByTime(0) })
    expect(screen.getByText('2018')).toBeTruthy()       // first stage = year
    expect(screen.queryByText('THE CARD')).toBeNull()   // card not yet
    act(() => { vi.advanceTimersByTime(PHASE.year) })
    expect(screen.getByText('10')).toBeTruthy()         // ahora el grado
    vi.useRealTimers()
  })

  it('sin stacked solo hay UN valor a la vez', () => {
    vi.useFakeTimers()
    render(
      <StagedCardReveal year="2018" grade={10} rarity="Epic" reduced={false}>
        <div>THE CARD</div>
      </StagedCardReveal>,
    )
    act(() => { vi.advanceTimersByTime(0) })
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
  const TL = (r: string) => buildTimeline(['Year', 'Grade', 'Rarity'], r)

  it('las duraciones se encadenan: cada fase empieza donde acaba la anterior', () => {
    // A propósito NO se fijan números: PHASE está para tocarlo. Lo que no puede cambiar es el
    // encadenado, que es lo que hace que mover una fase desplace sola a las de después.
    const e = TL('Epic'), r = TL('Rare'), c = TL('Common')

    expect(e.rowAt).toEqual([0, PHASE.year, PHASE.year + PHASE.grade])
    const finFilas = PHASE.year + PHASE.grade + PHASE.rarity
    expect(e.bandAt).toBe(finFilas)
    expect(e.turnAt).toBe(finFilas + PHASE.band + PHASE.epicWait)
    expect(e.faceUpAt).toBe(e.turnAt + PHASE.epicTurn)

    expect(r.bandAt).toBe(finFilas)
    expect(r.turnAt).toBe(finFilas + PHASE.band)      // Rare no espera: voltea tras la franja
    expect(r.faceUpAt).toBe(r.turnAt + PHASE.rareTurn)

    expect(c.bandAt).toBeNull()                       // Common no lleva franja
    expect(c.turnAt).toBe(finFilas)
    expect(c.faceUpAt).toBe(finFilas + PHASE.plainTurn)
  })

  it('una carta sin año sube todo en bloque, sin hueco muerto', () => {
    const sinAnio = buildTimeline(['Grade', 'Rarity'], 'Epic')
    expect(sinAnio.rowAt).toEqual([0, PHASE.grade])
    expect(sinAnio.bandAt).toBe(PHASE.grade + PHASE.rarity)
  })

  it('en Rare la franja sale a los 2100 y se va con el volteo', () => {
    renderStacked('Rare')
    // La fila de la carta YA escribe "RARE" en mayúsculas, así que la franja se cuenta, no se
    // busca: una aparición es solo la fila; dos, la fila más la franja.
    act(() => { vi.advanceTimersByTime(TL('Rare').bandAt! - 1) })
    expect(screen.getAllByText('RARE')).toHaveLength(1)

    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.getAllByText('RARE')).toHaveLength(2)   // franja dentro

    act(() => { vi.advanceTimersByTime(TL('Rare').faceUpAt - TL('Rare').bandAt!) })
    expect(screen.getByText('THE CARD')).toBeTruthy() // volteo
  })

  it('Common y Uncommon no montan franja en ningún momento', () => {
    renderStacked('Common')
    // En el instante en que una Rare ya tendría franja, aquí sigue habiendo una sola aparición:
    // la fila de la carta. Se mira ANTES del volteo, que desmonta el dorso y con él la fila.
    act(() => { vi.advanceTimersByTime(TL('Common').turnAt - 50) })
    expect(screen.getAllByText('COMMON')).toHaveLength(1)

    act(() => { vi.advanceTimersByTime(6000) })
    expect(screen.getByText('THE CARD')).toBeTruthy()
  })
})

describe('StagedCardReveal · sonido de Epic', () => {
  beforeEach(() => { vi.useFakeTimers(); playEpicSpin.mockClear(); playFlipThump.mockClear(); stopReveal.mockClear() })
  afterEach(() => vi.useRealTimers())

  const play = (rarity: string) => render(
    <StagedCardReveal year="2010" grade="PSA 10" rarity={rarity} reduced={false} stacked>
      <div>THE CARD</div>
    </StagedCardReveal>,
  )
  const TL = (r: string) => buildTimeline(['Year', 'Grade', 'Rarity'], r)

  it('suena CON la rareza, no con la franja', () => {
    play('Epic')
    act(() => { vi.advanceTimersByTime(TL('Epic').rowAt[2] - 1) })
    expect(playEpicSpin).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(1) })
    expect(playEpicSpin).toHaveBeenCalledTimes(1)   // en la rareza (1750), antes de la franja (2100)
  })

  it('solo Epic: ninguna otra rareza lo dispara', () => {
    for (const r of ['Rare', 'Uncommon', 'Common']) {
      playEpicSpin.mockClear()
      play(r)
      act(() => { vi.advanceTimersByTime(8000) })
      expect(playEpicSpin, r).not.toHaveBeenCalled()
    }
  })

  it('con reduced motion no suena: quien pide menos movimiento no quiere la ceremonia', () => {
    render(
      <StagedCardReveal year="2010" grade="PSA 10" rarity="Epic" reduced stacked>
        <div>THE CARD</div>
      </StagedCardReveal>,
    )
    act(() => { vi.advanceTimersByTime(8000) })
    expect(playEpicSpin).not.toHaveBeenCalled()
  })
})

describe('StagedCardReveal · golpe del volteo y corte al cambiar de carta', () => {
  beforeEach(() => { vi.useFakeTimers(); playFlipThump.mockClear(); stopReveal.mockClear() })
  afterEach(() => vi.useRealTimers())

  const mount = (rarity: string) => render(
    <StagedCardReveal year="2010" grade="PSA 10" rarity={rarity} reduced={false} stacked>
      <div>THE CARD</div>
    </StagedCardReveal>,
  )
  const TL = (r: string) => buildTimeline(['Year', 'Grade', 'Rarity'], r)

  it('el golpe suena cuando la carta queda DE CARA, no al empezar a girar', () => {
    mount('Epic')
    act(() => { vi.advanceTimersByTime(TL('Epic').turnAt + 50) })
    expect(playFlipThump).not.toHaveBeenCalled()   // ya está girando, pero aún no de cara

    act(() => { vi.advanceTimersByTime(TL('Epic').faceUpAt - TL('Epic').turnAt) })
    expect(playFlipThump).toHaveBeenCalledTimes(1)
  })

  it('en Rare suena con su volteo', () => {
    mount('Rare')
    act(() => { vi.advanceTimersByTime(TL('Rare').faceUpAt) })
    expect(playFlipThump).toHaveBeenCalledTimes(1)
  })

  it('Common y Uncommon voltean en silencio', () => {
    for (const r of ['Common', 'Uncommon']) {
      playFlipThump.mockClear()
      mount(r)
      act(() => { vi.advanceTimersByTime(8000) })
      expect(playFlipThump, r).not.toHaveBeenCalled()
    }
  })

  it('al cambiar de carta se corta lo que esté sonando', () => {
    // Era el problema: el sonido de una épica seguía sonando encima de la tirada siguiente.
    const { unmount } = mount('Epic')
    act(() => { vi.advanceTimersByTime(TL('Epic').rowAt[2] + 100) })
    expect(stopReveal).not.toHaveBeenCalled()
    unmount()
    expect(stopReveal).toHaveBeenCalled()
  })
})


describe('revealTiming · Pack Battle va a su ritmo', () => {
  it('las tres filas duran el DOBLE que en royale', () => {
    expect(PACK_PHASE.year).toBe(PHASE.year * 2)
    expect(PACK_PHASE.grade).toBe(PHASE.grade * 2)
    expect(PACK_PHASE.rarity).toBe(PHASE.rarity * 2)
  })

  it('y solo esas tres: el giro y el hold son los mismos', () => {
    // Lo que se pidió fue alargar la lectura, no la ceremonia entera.
    for (const k of ['band', 'epicWait', 'epicTurn', 'rareTurn', 'plainTurn', 'hold'] as const) {
      expect(PACK_PHASE[k]).toBe(PHASE[k])
    }
  })

  it('el royale no se entera: sin `fases`, la línea de tiempos es la de siempre', () => {
    const filas = ['Year', 'Grade', 'Rarity']
    expect(buildTimeline(filas, 'common').rowAt).toEqual([0, PHASE.year, PHASE.year + PHASE.grade])
  })

  it('con PACK_PHASE cada fila entra al doble de tarde', () => {
    const filas = ['Year', 'Grade', 'Rarity']
    const pack = buildTimeline(filas, 'common', PACK_PHASE)
    expect(pack.rowAt).toEqual([0, PHASE.year * 2, (PHASE.year + PHASE.grade) * 2])
    // Y la carta tarda en quedar de cara exactamente lo que se ha alargado la lectura.
    const royale = buildTimeline(filas, 'common')
    expect(pack.faceUpAt - royale.faceUpAt).toBe(PHASE.year + PHASE.grade + PHASE.rarity)
  })
})
