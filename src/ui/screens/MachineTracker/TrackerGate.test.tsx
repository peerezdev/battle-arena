import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import { TrackerGate } from './TrackerGate'
import type { TrackerAccess } from '../../../onchain/gachaClient'

const acceso = (over: Partial<TrackerAccess> = {}): TrackerAccess => ({
  allowed: false, wagered_usd: 60, required_usd: 100, missing_usd: 40, window_days: 7, ...over,
})

describe('el aviso del Machine Tracker', () => {
  it('lo primero que dice es cuánto falta', () => {
    // Es el número con el que el jugador decide. El motivo de la puerta va después: nadie lee la
    // justificación antes de saber si le afecta.
    render(<TrackerGate acceso={acceso()} />)
    expect(screen.getByText('$40 to go')).toBeTruthy()
  })

  it('dice sobre cuánto y en cuántos días', () => {
    render(<TrackerGate acceso={acceso()} />)
    expect(screen.getByText(/\$100 in Pack Battles or Battle Royale over the last 7 days/)).toBeTruthy()
  })

  it('dice explícitamente que el gacha NO cuenta', () => {
    // Sin esto, alguien abriría sobres esperando avanzar y no avanzaría.
    render(<TrackerGate acceso={acceso()} />)
    expect(screen.getByText(/Gacha pulls do not count/)).toBeTruthy()
  })

  it('explica que la ventana es RODANTE', () => {
    // La alternativa —creer que es un acceso que se gana una vez— lleva a perderlo sin haber hecho
    // nada y no entender por qué.
    render(<TrackerGate acceso={acceso()} />)
    expect(screen.getByText(/Rolling 7-day window/)).toBeTruthy()
    expect(screen.getByText(/anything older drops off/)).toBeTruthy()
  })

  it('enseña lo que ya lleva apostado, no solo lo que falta', () => {
    // "Voy por 60 de 100" motiva; "te faltan 40" a secas no dice si estás cerca de empezar o de
    // terminar.
    render(<TrackerGate acceso={acceso()} />)
    expect(screen.getByText('$60 wagered')).toBeTruthy()
  })

  it('con cero apostado no revienta ni pinta una barra rara', () => {
    const { container } = render(
      <TrackerGate acceso={acceso({ wagered_usd: 0, missing_usd: 100 })} />)
    expect(screen.getByText('$100 to go')).toBeTruthy()
    expect(container.innerHTML).toContain('width: 0%')
  })

  it('la barra no se pasa del 100% si se apostó de más', () => {
    const { container } = render(
      <TrackerGate acceso={acceso({ wagered_usd: 250, missing_usd: 0 })} />)
    expect(container.innerHTML).toContain('width: 100%')
  })

  it('usa los valores que trae el backend, no constantes propias', () => {
    // Si el mínimo o la ventana cambian en el servidor, el aviso tiene que seguirlos sin tocar
    // esta pantalla; dos sitios con el mismo número se desincronizan.
    render(<TrackerGate acceso={acceso({ required_usd: 250, window_days: 14, missing_usd: 190,
                                        wagered_usd: 60 })} />)
    expect(screen.getByText(/\$250 in Pack Battles/)).toBeTruthy()
    expect(screen.getByText(/Rolling 14-day window/)).toBeTruthy()
    expect(screen.getByText('$190 to go')).toBeTruthy()
  })
})

// ── la página: qué se enseña y cuándo ────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  fetchAcceso: vi.fn(),
  fetchEv: vi.fn().mockResolvedValue({ rows: [], updated_at: 0 }),
  fetchEvLive: vi.fn().mockResolvedValue({ rows: [], updated_at: 0 }),
}))
vi.mock('../../../onchain/gachaClient', () => ({
  fetchTrackerAccess: mocks.fetchAcceso,
  fetchEvRows: mocks.fetchEv,
  fetchEvLive: mocks.fetchEvLive,
}))
vi.mock('@privy-io/react-auth', () => ({ useIdentityToken: () => ({ identityToken: 'tok' }) }))

const { MachineTrackerPage } = await import('./MachineTrackerPage')

/** Dos vueltas: una para el acceso y otra para lo que el panel pide DESPUÉS de montarse. Con una
 *  sola, el panel existe pero todavía no ha pintado sus datos. */
const FILA = {
  machine: 'pokemon_50', name: 'Elite Pokémon', pack_price: 50, buyback_pct: 0.85,
  realized_n_pulls: 3068, realized_window_hours: 48, window_complete: true, hours_covered: 48,
  gaps: [], realized_edge_pct: 6.65, realized_ci_lo_pct: 3.29, realized_ci_hi_pct: 10.14,
  realized_verdict: 'CONFIDENT +EV', pulls_to_conclude: null, tiers: [],
  model_ev: null, model_ratio: null, model_edge_pct: null,
}

const dejarResolver = async () => {
  for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve() })
}

beforeEach(() => { localStorage.clear(); vi.clearAllMocks() })

describe('MachineTrackerPage', () => {
  it('con acceso enseña el panel y NO el aviso', async () => {
    mocks.fetchAcceso.mockResolvedValue(acceso({ allowed: true, missing_usd: 0 }))
    mocks.fetchEv.mockResolvedValue({ rows: [FILA], updated_at: 0 })
    render(<MachineTrackerPage />)
    await dejarResolver()
    expect(screen.queryByText(/to go/)).toBeNull()
    // Y el panel está de verdad ahí: se comprueba por su interruptor de valoración, no solo por
    // la ausencia del aviso. Sin esto el test pasaría con la pantalla en blanco.
    expect(mocks.fetchEv).toHaveBeenCalled()
    expect(screen.getByText('if you sell back')).toBeTruthy()
  })

  it('sin acceso enseña el aviso y NO pide los datos del tracker', async () => {
    // Pedirlos daría igual para la seguridad —el endpoint es público— pero sería trabajo tirado:
    // el bootstrap de 48 máquinas para no enseñar nada.
    mocks.fetchAcceso.mockResolvedValue(acceso())
    render(<MachineTrackerPage />)
    await dejarResolver()
    expect(screen.getByText('$40 to go')).toBeTruthy()
    expect(mocks.fetchEv).not.toHaveBeenCalled()
  })

  it('mientras no se sabe, no se enseña ninguna de las dos cosas', async () => {
    // Enseñar el panel y quitarlo medio segundo después es peor que esperar; y enseñar el aviso a
    // quien sí tiene acceso es acusarle de algo que no es verdad.
    mocks.fetchAcceso.mockReturnValue(new Promise(() => {}))
    render(<MachineTrackerPage />)
    expect(screen.queryByText(/to go/)).toBeNull()
    expect(mocks.fetchEv).not.toHaveBeenCalled()
  })

  it('el explicador está CON acceso y SIN él', async () => {
    // Quien todavía no puede entrar merece saber qué es lo que le estamos pidiendo que se gane.
    mocks.fetchAcceso.mockResolvedValue(acceso())
    render(<MachineTrackerPage />)
    await dejarResolver()
    expect(screen.getByRole('button', { name: /How to read a card/i })).toBeTruthy()
    cleanup()
    mocks.fetchAcceso.mockResolvedValue(acceso({ allowed: true, missing_usd: 0 }))
    mocks.fetchEv.mockResolvedValue({ rows: [FILA], updated_at: 0 })
    render(<MachineTrackerPage />)
    await dejarResolver()
    expect(screen.getByRole('button', { name: /How to read a card/i })).toBeTruthy()
  })

  it('si no se puede preguntar, la puerta se queda CERRADA', async () => {
    // Una puerta que se cae abierta ante un fallo de red no es una puerta.
    mocks.fetchAcceso.mockRejectedValue(new Error('sin red'))
    render(<MachineTrackerPage />)
    await dejarResolver()
    expect(screen.getByText('$100 to go')).toBeTruthy()
    expect(mocks.fetchEv).not.toHaveBeenCalled()
  })
})
