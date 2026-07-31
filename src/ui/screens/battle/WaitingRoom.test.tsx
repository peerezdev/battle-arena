import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { MachineCard } from '../../../onchain/gachaClient'
import type { Battle } from '../../../onchain/packBattleClient'

const red = vi.hoisted(() => ({ isDevnet: true }))
vi.mock('../../../onchain/config', () => ({ config: red }))
vi.mock('../../useIsWide', () => ({ useIsWide: () => true }))
vi.mock('../../useMachines', () => ({
  useMachineList: () => ({ machines: [{ code: 'pokemon_50', name: 'Elite Pokémon', price: 50, odds: {} }], loading: false }),
}))
const fetchMachineCards = vi.hoisted(() => vi.fn())
vi.mock('../../../onchain/gachaClient', async (orig) => ({
  ...(await orig<typeof import('../../../onchain/gachaClient')>()),
  fetchMachineCards,
}))

import { WaitingRoom } from './WaitingRoom'

const card = (n: number): MachineCard => ({
  nft_address: `mint${n}`, name: `Card ${n}`, image: null, rarity: 'Common', insured_value: 10,
  grade: null, images: [], grading_company: null, grading_id: null, the_grade: null,
  generic_grade: null, authenticated: null, year: '2020',
})
const page = (from: number, count: number) => Array.from({ length: count }, (_, i) => card(from + i))

const battle: Battle = {
  id: 'b1', mode: 'royale', machine_code: 'pokemon_50', price: 50_000_000, max_players: 10,
  status: 'lobby', winner: null, creator_wallet: 'A', players: [], rounds: [],
  server_seed_hash: 'h', buyin: 50_000_000,
}

function renderRoom() {
  return render(
    <WaitingRoom
      battle={battle} meWallet="A"
      onJoinSelf={vi.fn()} onJoinBot={vi.fn()} onJoinAllBots={vi.fn()}
      onCancel={vi.fn()} onExit={vi.fn()} onBack={vi.fn()}
      joiningSelf={false} joiningBot={false} joiningAll={false}
      botError={null} cancelError={null}
    />,
  )
}
const openPool = async () => {
  fireEvent.click(screen.getByRole('button', { name: /view card pool/i }))
  await waitFor(() => expect(fetchMachineCards).toHaveBeenCalled())
}

beforeEach(() => fetchMachineCards.mockReset())

describe('WaitingRoom · pool de cartas', () => {
  it('pide 100 por página, no un puñado', async () => {
    // Los pools reales tienen cientos de cartas (pokemon_50 son 730); pedir 24 enseñaba un 3%.
    fetchMachineCards.mockResolvedValue(page(1, 100))
    renderRoom()
    await openPool()
    expect(fetchMachineCards).toHaveBeenCalledWith('pokemon_50', { page: 1, limit: 100 })
  })

  it('"Load more" trae la página siguiente y la añade a lo que ya había', async () => {
    fetchMachineCards.mockResolvedValueOnce(page(1, 100)).mockResolvedValueOnce(page(101, 100))
    renderRoom()
    await openPool()
    await waitFor(() => expect(screen.getByText(/100\+ CARDS/)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /load more/i }))
    await waitFor(() => expect(screen.getByText(/200\+ CARDS/)).toBeTruthy())
    expect(fetchMachineCards).toHaveBeenLastCalledWith('pokemon_50', { page: 2, limit: 100 })
  })

  it('una página corta significa fin del pool: se va el botón y el "+"', async () => {
    // No hay total en la respuesta, así que el final se deduce de que la página venga incompleta.
    fetchMachineCards.mockResolvedValueOnce(page(1, 100)).mockResolvedValueOnce(page(101, 30))
    renderRoom()
    await openPool()
    fireEvent.click(await screen.findByRole('button', { name: /load more/i }))

    await waitFor(() => expect(screen.getByText(/130 CARDS/)).toBeTruthy())
    expect(screen.queryByText(/130\+/)).toBeNull()
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull()
  })

  it('no cuenta dos veces una carta repetida entre páginas', async () => {
    // El upstream puede devolver el mismo mint en dos páginas; contarlo dos veces inflaría el
    // total y chocaría con la key del grid.
    fetchMachineCards.mockResolvedValueOnce(page(1, 100)).mockResolvedValueOnce(page(91, 100))
    renderRoom()
    await openPool()
    fireEvent.click(await screen.findByRole('button', { name: /load more/i }))
    // 100 + 100 con 10 repetidos = 190, no 200
    await waitFor(() => expect(screen.getByText(/190\+ CARDS/)).toBeTruthy())
  })

  it('si falla la carga de más páginas, lo ya cargado se queda en pantalla', async () => {
    fetchMachineCards.mockResolvedValueOnce(page(1, 100)).mockRejectedValueOnce(new Error('boom'))
    renderRoom()
    await openPool()
    fireEvent.click(await screen.findByRole('button', { name: /load more/i }))
    await waitFor(() => expect(screen.getByText(/Couldn't load more cards/)).toBeTruthy())
    expect(screen.getByText(/100\+ CARDS/)).toBeTruthy()   // no se pierde lo anterior
  })
})


// ── el botón de bots es solo de devnet ────────────────────────────────────────
// Rellenar una sala con bots es una herramienta de pruebas. En mainnet completaría una partida de
// dinero real con rivales que no existen, así que no puede ni verse.

describe('WaitingRoom · rellenar con bots', () => {
  const boton = () => screen.queryByRole('button', { name: /fill with bots/i })

  it('en devnet se ofrece', () => {
    red.isDevnet = true
    renderRoom()
    expect(boton()).toBeTruthy()
  })

  it('en mainnet no aparece', () => {
    red.isDevnet = false
    renderRoom()
    expect(boton()).toBeNull()
  })

  it('en mainnet siguen estando los demás botones de la sala', () => {
    // La condición es del botón de bots, no de la columna entera.
    red.isDevnet = false
    renderRoom()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy()
  })
})
