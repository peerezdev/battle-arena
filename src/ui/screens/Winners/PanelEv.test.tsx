import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  fetchWinners: vi.fn().mockResolvedValue([]),
  fetchGaps: vi.fn().mockResolvedValue({ gaps: {}, sampled: 0 }),
  fetchEv: vi.fn(),
}))
vi.mock('../../../onchain/gachaClient', () => ({
  fetchGachaWinners: mocks.fetchWinners,
  fetchRarityGaps: mocks.fetchGaps,
  fetchEvRows: mocks.fetchEv,
}))
vi.mock('../../useMachines', () => ({ useMachineList: () => ({ machines: [] }) }))
vi.mock('../../useAliases', () => ({ useAliases: () => ({}) }))

import { WinnersPage } from './WinnersPage'

const fila = (machine: string, name: string) => ({
  machine, name, pack_price: 50, buyback_pct: 0.85, realized_n_pulls: 300,
  realized_window_hours: 48, window_complete: true, hours_covered: 48, gaps: [],
  realized_edge_pct: -6, realized_ci_lo_pct: -8, realized_ci_hi_pct: -4,
  realized_verdict: 'CONFIDENT -EV', pulls_to_conclude: null, tiers: [],
})

beforeEach(() => {
  localStorage.clear()
  mocks.fetchEv.mockResolvedValue({
    rows: [fila('pokemon_50', 'Elite Pokémon'), fila('anime_75', 'Anime Pop')],
    updated_at: 0,
  })
})

const abrirSelector = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /machines/i }))
}

describe('PanelEv · elegir qué máquinas ver', () => {
  it('al entrar se ven todas', async () => {
    render(<WinnersPage />)
    expect(await screen.findByRole('button', { name: /2 of 2 machines/i })).toBeTruthy()
  })

  it('ocultar una la quita de la rejilla y lo recuerda', async () => {
    const { unmount } = render(<WinnersPage />)
    await abrirSelector()
    fireEvent.click(screen.getByRole('checkbox', { name: /Anime Pop/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /1 of 2 machines/i })).toBeTruthy())

    // Y sobrevive a recargar: es el sentido de guardarla.
    unmount()
    render(<WinnersPage />)
    expect(await screen.findByRole('button', { name: /1 of 2 machines/i })).toBeTruthy()
  })

  it('una máquina NUEVA aparece aunque haya preferencia guardada', async () => {
    // Se guardan las ocultas, no las visibles, justo para esto.
    localStorage.setItem('ba.evTracker.hiddenMachines', '["anime_75"]')
    mocks.fetchEv.mockResolvedValue({
      rows: [fila('pokemon_50', 'Elite Pokémon'), fila('anime_75', 'Anime Pop'),
             fila('nueva_500', 'Recién llegada')],
      updated_at: 0,
    })
    render(<WinnersPage />)
    expect(await screen.findByRole('button', { name: /2 of 3 machines/i })).toBeTruthy()
  })

  it('ocultarlas todas lo dice en vez de dejar el hueco vacío', async () => {
    render(<WinnersPage />)
    await abrirSelector()
    fireEvent.click(screen.getByRole('button', { name: /Hide all/i }))
    expect(await screen.findByText(/All machines hidden/i)).toBeTruthy()
  })

  it('"Show all" las devuelve', async () => {
    localStorage.setItem('ba.evTracker.hiddenMachines', '["anime_75","pokemon_50"]')
    render(<WinnersPage />)
    await abrirSelector()
    fireEvent.click(screen.getByRole('button', { name: /Show all/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /2 of 2 machines/i })).toBeTruthy())
  })
})
