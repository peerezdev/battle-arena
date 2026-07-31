import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { OpenBattle } from '../../../onchain/packBattleClient'

// La pantalla tira de media docena de hooks; se sustituyen para poder probar SOLO lo que compone.
const mocks = vi.hoisted(() => ({ battles: [] as OpenBattle[] }))
vi.mock('../../../onchain/useBattles', () => ({ useBattles: () => ({ battles: mocks.battles }) }))
vi.mock('@privy-io/react-auth', () => ({ useIdentityToken: () => ({ identityToken: 'tok' }) }))
vi.mock('../../../wallet/embedded', () => ({ useEmbeddedSolanaAddress: () => 'ME' }))
vi.mock('../../useMachines', () => ({
  useMachineList: () => ({ machines: [] }),
  loadMachineList: () => Promise.resolve([]),
}))
vi.mock('../../components/useDelegationGate', () => ({ useDelegationGate: () => ({ open: false }) }))
vi.mock('../../components/DelegationGate', () => ({ DelegationGate: () => null }))
vi.mock('./RoyaleDemoNotice', () => ({ RoyaleDemoNotice: () => null }))

import { ModeHub } from './ModeHub'

/** Sin catálogo de máquinas, la card titula con el código en mayúsculas: sirve de anclaje. */
function battle(over: Partial<OpenBattle>): OpenBattle {
  return {
    id: 'b', mode: 'royale', machine_code: 'maquina_a', price: 50_000_000, buyin: 10_000_000,
    max_players: 5, players: [], status: 'settled', created_at: '2026-07-01T10:00:00Z',
    ...over,
  } as unknown as OpenBattle
}

const pintar = (mode: 'pack' | 'royale' = 'royale') =>
  render(<MemoryRouter><ModeHub mode={mode} /></MemoryRouter>)

beforeEach(() => { mocks.battles = [] })

describe('ModeHub · royale', () => {
  it('sin partidas terminadas no enseña la sección Recent', () => {
    mocks.battles = [battle({ id: 'viva', status: 'lobby' })]
    pintar()
    expect(screen.queryByText('RECENT')).toBeNull()
  })

  it('acumula las terminadas bajo los lobbies, de más nueva a más vieja', () => {
    mocks.battles = [
      battle({ id: '1', machine_code: 'vieja', settled_at: '2026-07-01T10:00:00Z' }),
      battle({ id: '2', machine_code: 'nueva', settled_at: '2026-07-03T10:00:00Z' }),
      battle({ id: '3', machine_code: 'media', settled_at: '2026-07-02T10:00:00Z' }),
    ]
    const { container } = pintar()
    expect(screen.getByText('RECENT')).toBeTruthy()

    // El orden se comprueba por la posición en el DOM, que es lo que ve el jugador.
    const txt = container.textContent ?? ''
    expect(txt.indexOf('NUEVA')).toBeGreaterThan(-1)
    expect(txt.indexOf('NUEVA')).toBeLessThan(txt.indexOf('MEDIA'))
    expect(txt.indexOf('MEDIA')).toBeLessThan(txt.indexOf('VIEJA'))
  })

  it('la sección Recent va DESPUÉS de los lobbies', () => {
    mocks.battles = [
      battle({ id: 'abierta', machine_code: 'lobby_viva', status: 'lobby' }),
      battle({ id: 'fin', machine_code: 'ya_jugada', settled_at: '2026-07-03T10:00:00Z' }),
    ]
    const { container } = pintar()
    const txt = container.textContent ?? ''
    expect(txt.indexOf('LOBBY_VIVA')).toBeLessThan(txt.indexOf('RECENT'))
    expect(txt.indexOf('RECENT')).toBeLessThan(txt.indexOf('YA_JUGADA'))
  })

  it('una partida terminada no aparece además como lobby', () => {
    // Las dos listas se reparten por estado, así que no puede salir en ambas: sería la misma
    // partida ofreciéndose para entrar y dándose por terminada a la vez.
    mocks.battles = [battle({ id: 'unica', machine_code: 'solo_una', settled_at: '2026-07-03T10:00:00Z' })]
    const { container } = pintar()
    expect((container.textContent ?? '').split('SOLO_UNA').length - 1).toBe(1)
    expect(screen.getByText('No open Battle Royale lobbies right now.')).toBeTruthy()
  })

  it('en Pack Battle no hay sección Recent: esa pantalla usa Live Games', () => {
    mocks.battles = [battle({ id: 'p', mode: 'pack' })]
    pintar('pack')
    expect(screen.queryByText('RECENT')).toBeNull()
  })
})
