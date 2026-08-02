import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { OpenBattle } from '../../../onchain/packBattleClient'

// La pantalla tira de media docena de hooks; se sustituyen para poder probar SOLO lo que compone.
const mocks = vi.hoisted(() => ({ battles: [] as OpenBattle[], nav: vi.fn(), wide: false }))
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
// jsdom no trae matchMedia, así que sin esto TODO se probaría contra la maqueta estrecha —
// y la cabecera con los rótulos solo existe en la ancha.
vi.mock('../../useIsWide', () => ({ useIsWide: () => mocks.wide }))
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.nav,
}))

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

beforeEach(() => { mocks.battles = []; mocks.nav.mockReset(); mocks.wide = false })

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


describe('ModeHub · partidas terminadas: Result y Replay', () => {
  const terminada = () => {
    mocks.battles = [battle({ id: 'terminada', status: 'settled', winner: 'ME' } as Partial<OpenBattle>)]
    pintar()
  }

  it('Result entra por el marcador, no por la primera carta', () => {
    // Era el fallo: el botón decía "Result" y llevaba al principio del reveal, obligando a ver
    // la partida entera otra vez. Solo el modal de "While you were away" pasaba ?view=result.
    terminada()
    fireEvent.click(screen.getByRole('button', { name: 'Result' }))
    expect(mocks.nav).toHaveBeenCalledWith('/play/battle/terminada?view=result')
  })

  it('Replay revive el reveal', () => {
    // Al arreglar lo anterior el reveal se quedó sin puerta: TODO enlace a una partida terminada
    // llevaba al marcador. Las dos salidas tienen que convivir.
    terminada()
    fireEvent.click(screen.getByRole('button', { name: /Replay/ }))
    expect(mocks.nav).toHaveBeenCalledWith('/play/battle/terminada')
  })

  it('en Pack Battle también salen las dos', () => {
    // Son listas distintas —LiveBattles en pack, la rejilla Recent en royale— y se pidieron las
    // dos, así que se comprueban las dos.
    mocks.battles = [battle({ id: 'pb', mode: 'pack', status: 'settled', winner: 'ME' } as Partial<OpenBattle>)]
    pintar('pack')
    // En pack las terminadas viven bajo el filtro "Recent"; el de por defecto solo enseña las
    // que siguen en juego.
    fireEvent.click(screen.getByText('Recent'))   // el filtro es un span, no un botón
    expect(screen.getByRole('button', { name: 'Result' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Replay/ }))
    expect(mocks.nav).toHaveBeenCalledWith('/play/battle/pb')
  })

  it('una partida en juego NO ofrece Replay: aún no hay nada que revivir', () => {
    // En pack a propósito: en royale una partida viva la pinta otra card distinta, así que ahí
    // este test pasaría sin llegar a mirar la rama.
    mocks.battles = [battle({ id: 'viva', mode: 'pack', status: 'running' } as Partial<OpenBattle>)]
    pintar('pack')
    expect(screen.getByRole('button', { name: 'Watch' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Replay/ })).toBeNull()
  })
})


describe('ModeHub · lo que enseña la card de una partida terminada', () => {
  const recientePack = (over: Partial<OpenBattle> = {}) => {
    // `players` es el número de apuntados; una partida terminada está llena.
    mocks.battles = [battle({ id: 'x', mode: 'pack', status: 'settled', winner: 'ME',
                              players: 2, max_players: 2, ...over } as unknown as Partial<OpenBattle>)]
    pintar('pack')
    fireEvent.click(screen.getByText('Recent'))
  }

  it('el bote es el real y el ×N sale de ese número (maqueta ancha)', () => {
    mocks.wide = true
    // buy-in 10 USDC (buyin va en base units) y botín real 40 → ×4, no el ×2 de la estimación.
    recientePack({ buyin: 10_000_000, price: 50_000_000, loot_usd: 40 } as unknown as Partial<OpenBattle>)
    expect(screen.getByText('TOTAL POT')).toBeTruthy()
    expect(screen.getByText('$40')).toBeTruthy()
    expect(screen.getByText('×4')).toBeTruthy()
  })

  it('cada rótulo va encima de su número', () => {
    recientePack({ loot_usd: 40 } as unknown as Partial<OpenBattle>)
    expect(screen.getByText('BUY-IN')).toBeTruthy()
    expect(screen.getByText('TOTAL POT')).toBeTruthy()
    expect(screen.queryByText(/ESTIMATED POT/)).toBeNull()
    expect(screen.queryByText(/BUY-IN → /)).toBeNull()   // ya no van juntos en una línea
  })

  it('el rótulo va centrado sobre su número, no colgando a un lado', () => {
    mocks.wide = true   // la cabecera con los rótulos es de la maqueta ancha
    recientePack({ loot_usd: 40 } as unknown as Partial<OpenBattle>)
    for (const t of ['BUY-IN', 'TOTAL POT']) {
      const columna = screen.getByText(t).parentElement as HTMLElement
      expect(columna.style.textAlign).toBe('center')
    }
  })

  it('ya no queda el "+N" que contaba los círculos', () => {
    // `extra` era "+6" = los jugadores que no cabían como avatar. Sin avatares, junto a
    // "10 players" se leía como un número suelto sin sentido.
    recientePack({ players: 10, max_players: 10, loot_usd: 40 } as unknown as Partial<OpenBattle>)
    expect(screen.getByText('10 players')).toBeTruthy()
    expect(screen.queryByText(/^\+\d+$/)).toBeNull()
  })

  it('en vez de "2/2" dice cuántos jugaron, y no quedan círculos', () => {
    // Los círculos empujaban los botones fuera de la card en cuanto había varios asientos.
    recientePack({ players: 4, max_players: 4, loot_usd: 40 } as unknown as Partial<OpenBattle>)
    expect(screen.getByText('4 players')).toBeTruthy()
    expect(screen.queryByText('4/4')).toBeNull()
  })
})
