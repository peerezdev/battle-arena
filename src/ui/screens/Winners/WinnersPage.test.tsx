import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { GachaWinner } from '../../../onchain/gachaClient'

const mocks = vi.hoisted(() => ({
  fetchWinners: vi.fn(), fetchGaps: vi.fn(),
  fetchEv: vi.fn().mockResolvedValue({ rows: [], updated_at: 0 }),
}))
vi.mock('../../../onchain/gachaClient', () => ({
  fetchGachaWinners: mocks.fetchWinners,
  fetchRarityGaps: mocks.fetchGaps,
  // El panel del EV tracker vive en esta misma pantalla. Aquí se dobla vacío a propósito: estos
  // tests son del feed de ganadores, y el panel tiene los suyos en EvCard.test.tsx.
  fetchEvRows: mocks.fetchEv,
}))
vi.mock('../../useMachines', () => ({
  useMachineList: () => ({ machines: [{ code: 'pokemon_50', name: 'Elite Pokémon', shortName: 'PKMN 50', price: 50 }] }),
}))
vi.mock('../../useAliases', () => ({ useAliases: () => ({ ALICE: 'alicia' }) }))

import { WinnersPage } from './WinnersPage'

function ganador(over: Partial<GachaWinner> = {}): GachaWinner {
  return {
    wallet: 'Wq11111111111111111111111111111111111111111',
    nft_address: `M${Math.random()}`, name: 'Charizard PSA 10', images: ['https://x/c.png'],
    insured_value: 140, machine: 'pokemon_50', rarity: 'Rare',
    at: new Date().toISOString(), slug: 'cc', ...over,
  }
}

beforeEach(() => {
  mocks.fetchWinners.mockReset(); mocks.fetchWinners.mockResolvedValue([ganador()])
  mocks.fetchGaps.mockReset()
  mocks.fetchGaps.mockResolvedValue({ machine: 'pokemon_50', sampled: 200,
    gaps: { Common: 0, Uncommon: 1, Rare: 33, Epic: null } })
})

describe('WinnersPage', () => {
  it('pide las últimas 10 de todas las máquinas al entrar', async () => {
    render(<WinnersPage />)
    await waitFor(() => expect(mocks.fetchWinners).toHaveBeenCalled())
    expect(mocks.fetchWinners).toHaveBeenCalledWith({ machine: undefined, rarity: undefined, count: 10 })
  })

  it('enseña la carta Y quién la sacó', async () => {
    mocks.fetchWinners.mockResolvedValue([ganador({ wallet: 'ALICE', name: 'Pikachu PSA 9' })])
    render(<WinnersPage />)
    expect(await screen.findByText('Pikachu PSA 9')).toBeTruthy()
    // Si el wallet es de un jugador nuestro se enseña su nombre, no la dirección.
    expect(screen.getByText(/alicia/)).toBeTruthy()
  })

  it('cae a la dirección abreviada cuando no conocemos al jugador', async () => {
    mocks.fetchWinners.mockResolvedValue([ganador({ wallet: 'ABCD000000000000000000000000000000000WXYZ' })])
    render(<WinnersPage />)
    expect(await screen.findByText(/ABCD…WXYZ/)).toBeTruthy()
  })

  it('el filtro de cantidad llega a la petición', async () => {
    render(<WinnersPage />)
    await waitFor(() => expect(mocks.fetchWinners).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Last 200' }))
    await waitFor(() =>
      expect(mocks.fetchWinners).toHaveBeenLastCalledWith(expect.objectContaining({ count: 200 })))
  })

  it('no se ofrecen 500: la API de CC corta en 200', () => {
    render(<WinnersPage />)
    expect(screen.queryByRole('button', { name: /Last 500/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Last 200' })).toBeTruthy()
  })

  it('el filtro de rareza llega a la petición', async () => {
    render(<WinnersPage />)
    await waitFor(() => expect(mocks.fetchWinners).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Epic' }))
    await waitFor(() =>
      expect(mocks.fetchWinners).toHaveBeenLastCalledWith(expect.objectContaining({ rarity: 'Epic' })))
  })

  it('el filtro de máquina llega a la petición', async () => {
    render(<WinnersPage />)
    await waitFor(() => expect(mocks.fetchWinners).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Machine'), { target: { value: 'pokemon_50' } })
    await waitFor(() =>
      expect(mocks.fetchWinners).toHaveBeenLastCalledWith(expect.objectContaining({ machine: 'pokemon_50' })))
  })

  it('avisa cuando una rareza no-Epic devuelve menos de lo pedido', async () => {
    // CC solo filtra Epic upstream; el resto se recorta después, así que salen menos. Decirlo
    // evita que parezca que faltan datos.
    mocks.fetchWinners.mockResolvedValue([ganador({ rarity: 'Rare' })])
    render(<WinnersPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Rare' }))
    expect(await screen.findByText(/only filters Epic upstream/i)).toBeTruthy()
  })

  it('con Epic no avisa: ahí el filtro sí es de CC', async () => {
    mocks.fetchWinners.mockResolvedValue([ganador({ rarity: 'Epic' })])
    render(<WinnersPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Epic' }))
    await waitFor(() => expect(mocks.fetchWinners).toHaveBeenLastCalledWith(expect.objectContaining({ rarity: 'Epic' })))
    expect(screen.queryByText(/only filters Epic upstream/i)).toBeNull()
  })

  it('si la petición falla lo dice y no se rompe', async () => {
    mocks.fetchWinners.mockRejectedValue(new Error('boom'))
    render(<WinnersPage />)
    expect(await screen.findByText(/couldn’t load winners/i)).toBeTruthy()
  })
})


describe('WinnersPage · packs sin salir por rareza', () => {
  const elegirMaquina = async () => {
    fireEvent.change(screen.getByLabelText('Machine'), { target: { value: 'pokemon_50' } })
    await waitFor(() => expect(mocks.fetchGaps).toHaveBeenCalledWith('pokemon_50'))
  }

  it('no aparece con "All machines": mezclando máquinas el hueco no significa nada', async () => {
    render(<WinnersPage />)
    await waitFor(() => expect(mocks.fetchWinners).toHaveBeenCalled())
    expect(screen.queryByText(/PACKS SINCE LAST/i)).toBeNull()
    expect(mocks.fetchGaps).not.toHaveBeenCalled()
  })

  it('aparece al elegir una máquina, con el hueco de cada rareza', async () => {
    render(<WinnersPage />)
    await elegirMaquina()
    expect(await screen.findByText(/PACKS SINCE LAST/i)).toBeTruthy()
    const tira = screen.getByText(/PACKS SINCE LAST/i).parentElement as HTMLElement
    expect(tira.textContent).toContain('Rare33')
    expect(tira.textContent).toContain('Common0')
  })

  it('una rareza que no salió en la muestra se marca con "+" y no con el tamaño', async () => {
    // Sería dar por medido algo que solo se sabe que es mayor que la muestra.
    render(<WinnersPage />)
    await elegirMaquina()
    const tira = (await screen.findByText(/PACKS SINCE LAST/i)).parentElement as HTMLElement
    expect(tira.textContent).toContain('Epic200+')
  })

  it('vuelve a ocultarse si se quita el filtro de máquina', async () => {
    render(<WinnersPage />)
    await elegirMaquina()
    await screen.findByText(/PACKS SINCE LAST/i)
    fireEvent.change(screen.getByLabelText('Machine'), { target: { value: '' } })
    await waitFor(() => expect(screen.queryByText(/PACKS SINCE LAST/i)).toBeNull())
  })

  it('si falla, la pantalla sigue funcionando: es un extra', async () => {
    mocks.fetchGaps.mockRejectedValue(new Error('boom'))
    render(<WinnersPage />)
    await elegirMaquina()
    expect(screen.queryByText(/PACKS SINCE LAST/i)).toBeNull()
    expect(await screen.findByText('Charizard PSA 10')).toBeTruthy()
  })
})
