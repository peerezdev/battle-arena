import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../useMachines', () => ({ useMachines: () => ({}) }))
vi.mock('../../useAliases', () => ({ useAliases: () => ({}) }))
vi.mock('../../../wallet/embedded', () => ({ useEmbeddedSolanaAddress: () => 'W1' }))

import { HistoryTab } from './HistoryTab'

const gacha = (over = {}) => ({
  kind: 'gacha' as const, battleId: 'cc-abc-123', memo: 'cc-abc-123', mode: 'gacha',
  machineCode: 'pokemon_50', result: 'gacha' as const, amountUsd: 130, cards: 1,
  opponents: [], ts: 1, pullName: 'Charizard', ...over,
})
const batalla = (over = {}) => ({
  kind: 'battle' as const, battleId: 'b1', mode: 'pack', machineCode: 'pokemon_50',
  result: 'win' as const, amountUsd: 200, cards: 2, opponents: ['W2'], ts: 2, ...over,
})

// El componente se trae su historial solo, así que se dobla el fetch en vez de pasarle filas.
const pintar = async (rows: unknown[]) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => rows }))
  const r = render(<MemoryRouter><HistoryTab /></MemoryRouter>)
  await screen.findByText('ACTIVITY')
  return r
}

afterEach(() => vi.restoreAllMocks())

describe('HistoryTab · replay de tiradas de gacha', () => {
  it('cada tirada de gacha ofrece repetirse', async () => {
    // El historial del perfil ES el registro de sobres abiertos: es donde el jugador va a buscar
    // una tirada suya para volver a verla o enseñarla.
    await pintar([gacha()])
    const link = screen.getByRole('link', { name: /REPLAY/i })
    expect(link.getAttribute('href')).toBe('/play/gacha?replay=cc-abc-123')
  })

  it('las batallas no lo llevan aunque traigan memo', async () => {
    // Con memo A PROPÓSITO. Hoy el backend solo lo manda en gacha, así que sin él este test
    // pasaría por no tener memo y no por la comprobación de tipo — y el día que alguien añada
    // el memo a las batallas, el botón aparecería enlazando el replay de UNA tirada como si
    // fuera la partida entera. Una batalla se repite desde su página de verificación, donde
    // están todas sus tiradas.
    await pintar([batalla({ memo: 'cc-de-una-tirada' })])
    expect(screen.queryByRole('link', { name: /REPLAY/i })).toBeNull()
  })

  it('sin memo no se pinta un enlace roto', async () => {
    // Las tiradas anteriores al registro pueden no traerlo; un replay sin memo no lleva a nada.
    await pintar([gacha({ memo: null })])
    expect(screen.queryByRole('link', { name: /REPLAY/i })).toBeNull()
  })

  it('sigue enseñando lo que ya enseñaba', async () => {
    // El botón se metió en la misma columna que el importe; que no se haya llevado nada por delante.
    await pintar([gacha()])
    expect(screen.getByText(/Pulled Charizard/)).toBeTruthy()
    expect(screen.getByText('GACHA')).toBeTruthy()
  })
})
