import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CardPoolGrid } from './CardPoolGrid'
import type { MachineCard } from '../../../onchain/gachaClient'

vi.mock('../../useIsWide', () => ({ useIsWide: () => true }))
vi.mock('../../useReducedMotion', () => ({ useReducedMotion: () => true }))

const card = (n: number): MachineCard => ({
  nft_address: `mint${n}`, name: `Card ${n}`, image: null, rarity: 'Common', insured_value: 10,
  grade: null, images: [], grading_company: null, grading_id: null, the_grade: null,
  generic_grade: null, authenticated: null, year: '2020',
})
const cards = (n: number) => Array.from({ length: n }, (_, i) => card(i))

const base = { loading: false, machineCode: 'm1' }

describe('CardPoolGrid · paginación', () => {
  it('sin onLoadMore no hay pie: quien no pagina no ve controles', () => {
    render(<CardPoolGrid {...base} cards={cards(3)} />)
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull()
  })

  it('dice cuántas se ven del total mientras falten páginas', () => {
    // El total pelado se leía como "y aquí están las cartas", que es justo el fallo original.
    render(<CardPoolGrid {...base} cards={cards(100)} liveCount={733} onLoadMore={vi.fn()} hasMore />)
    expect(screen.getByText(/100 OF 733 CARDS SHOWN/)).toBeTruthy()
  })

  it('con el pool entero cargado vuelve al total a secas y esconde el botón', () => {
    render(<CardPoolGrid {...base} cards={cards(118)} liveCount={118} onLoadMore={vi.fn()} hasMore={false} />)
    expect(screen.getByText(/118 - CARDS IN THIS MACHINE/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull()
  })

  it('Load more avisa al padre', () => {
    const onLoadMore = vi.fn()
    render(<CardPoolGrid {...base} cards={cards(100)} onLoadMore={onLoadMore} hasMore />)
    fireEvent.click(screen.getByRole('button', { name: /load more/i }))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('mientras carga, el botón queda deshabilitado para no encadenar páginas', () => {
    const onLoadMore = vi.fn()
    render(<CardPoolGrid {...base} cards={cards(100)} onLoadMore={onLoadMore} hasMore loadingMore />)
    const btn = screen.getByRole('button', { name: /loading/i })
    fireEvent.click(btn)
    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('si falla una página, se ofrece reintentar sin perder lo cargado', () => {
    render(<CardPoolGrid {...base} cards={cards(100)} onLoadMore={vi.fn()} hasMore={false} loadMoreError />)
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy()
    expect(screen.getByText(/Couldn't load more cards/)).toBeTruthy()
    expect(screen.getByText('Card 0')).toBeTruthy()      // lo ya cargado sigue ahí
  })
})
