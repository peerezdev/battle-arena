import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LastRoyaleCard } from './LastRoyaleCard'
import type { LiveBattle } from './hubMockData'

vi.mock('../../useMachines', () => ({ useMachineList: () => ({ machines: [], loading: false }) }))

const battle: LiveBattle = {
  id: 'b1', mode: 'royale', live: false, title: 'pokemon_250', sub: '',
  players: [], cards: [], costLabel: 'ENTRY', costValue: 1350, action: 'watch',
  entry: 1350, pot: 13500, lootUsd: 14266, slots: '10/10',
  statusText: 'Final', statusColor: '#8b95a3', battleStatus: 'settled',
  winner: 'So1anaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgtm6', settledAt: '2026-07-23T06:00:00Z',
}

describe('LastRoyaleCard', () => {
  it('muestra la entrada y lo que se ganó de verdad, no el bote estimado', () => {
    render(<LastRoyaleCard battle={battle} onOpen={vi.fn()} onReplay={vi.fn()} />)
    expect(screen.getByText('$1,350')).toBeTruthy()
    expect(screen.getByText('$14,266')).toBeTruthy()   // lootUsd, no pot (13.500)
    expect(screen.queryByText('$13,500')).toBeNull()
  })

  it('sin lootUsd cae al bote estimado en vez de no enseñar nada', () => {
    render(<LastRoyaleCard battle={{ ...battle, lootUsd: undefined }} onOpen={vi.fn()} onReplay={vi.fn()} />)
    expect(screen.getByText('$13,500')).toBeTruthy()
  })

  it('Result y Replay son acciones DISTINTAS', () => {
    // Es lo que se puede romper sin que se note: las dos llevan a la misma batalla y solo se
    // diferencian en si el reveal se vuelve a reproducir.
    const onOpen = vi.fn(), onReplay = vi.fn()
    render(<LastRoyaleCard battle={battle} onOpen={onOpen} onReplay={onReplay} />)

    fireEvent.click(screen.getByRole('button', { name: /replay/i }))
    expect(onReplay).toHaveBeenCalledWith(battle)
    expect(onOpen).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /result/i }))
    expect(onOpen).toHaveBeenCalledWith(battle)
    expect(onReplay).toHaveBeenCalledTimes(1)   // el de Replay no se disparó otra vez
  })

  it('pulsar un botón no dispara además el click de la tarjeta', () => {
    const onOpen = vi.fn(), onReplay = vi.fn()
    render(<LastRoyaleCard battle={battle} onOpen={onOpen} onReplay={onReplay} />)
    fireEvent.click(screen.getByRole('button', { name: /replay/i }))
    expect(onOpen).not.toHaveBeenCalled()        // sin stopPropagation saltaría el onOpen del contenedor
  })
})
