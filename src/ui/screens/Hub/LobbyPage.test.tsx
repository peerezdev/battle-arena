import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
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
vi.mock('./RoyaleDemoNotice', () => ({
  RoyaleDemoNotice: () => <div data-testid="royale-demo" />,
}))
// jsdom no trae matchMedia, así que sin esto TODO se probaría contra la maqueta estrecha —
// y la cabecera con los rótulos solo existe en la ancha.
vi.mock('../../useIsWide', () => ({ useIsWide: () => mocks.wide }))
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.nav,
}))

import { LobbyPage } from './LobbyPage'

/** Sin catálogo de máquinas, la card titula con el código en mayúsculas: sirve de anclaje. */
function battle(over: Partial<OpenBattle>): OpenBattle {
  return {
    id: 'b', mode: 'royale', machine_code: 'maquina_a', price: 50_000_000, buyin: 10_000_000,
    max_players: 5, players: [], status: 'settled', created_at: '2026-07-01T10:00:00Z',
    ...over,
  } as unknown as OpenBattle
}

/** El modo ya no es un prop: viaja en la URL, que es lo que permite enlazarlo y volver a él. */
const pintar = (mode: 'all' | 'pack' | 'royale' | 'none' = 'royale') =>
  render(
    <MemoryRouter initialEntries={[mode === 'all' ? '/play/lobby' : `/play/lobby?mode=${mode}`]}>
      <LobbyPage />
    </MemoryRouter>,
  )

beforeEach(() => { mocks.battles = []; mocks.nav.mockReset(); mocks.wide = false })

/** Las terminadas viven bajo la pestaña "Recent" del segmentado de Live games. */
const verRecent = () => fireEvent.click(screen.getByText('Recent'))

describe('Lobby · las terminadas van en la pestaña Recent de Live games', () => {
  it('por defecto NO se ven: la vista de entrada es la de partidas vivas', () => {
    mocks.battles = [battle({ id: 'fin', machine_code: 'ya_jugada', settled_at: '2026-07-03T10:00:00Z' })]
    const { container } = pintar()
    expect(container.textContent).not.toContain('YA_JUGADA')
    expect(screen.getByText('No live games right now.')).toBeTruthy()
  })

  it('al pulsar Recent salen, de más nueva a más vieja', () => {
    mocks.battles = [
      battle({ id: '1', machine_code: 'vieja', settled_at: '2026-07-01T10:00:00Z' }),
      battle({ id: '2', machine_code: 'nueva', settled_at: '2026-07-03T10:00:00Z' }),
      battle({ id: '3', machine_code: 'media', settled_at: '2026-07-02T10:00:00Z' }),
    ]
    const { container } = pintar()
    verRecent()
    // El orden se comprueba por la posición en el DOM, que es lo que ve el jugador.
    const txt = container.textContent ?? ''
    expect(txt.indexOf('NUEVA')).toBeGreaterThan(-1)
    expect(txt.indexOf('NUEVA')).toBeLessThan(txt.indexOf('MEDIA'))
    expect(txt.indexOf('MEDIA')).toBeLessThan(txt.indexOf('VIEJA'))
  })

  it('NO hay una segunda lista de terminadas debajo', () => {
    // Live games ya tiene su pestaña Recent, y de cualquier modo. Una sección propia debajo era la
    // misma lista repetida dos veces en la misma pantalla, y obligaba a bajar para nada.
    mocks.battles = [battle({ id: 'fin', machine_code: 'ya_jugada', settled_at: '2026-07-03T10:00:00Z' })]
    const { container } = pintar()
    verRecent()
    expect((container.textContent ?? '').split('YA_JUGADA').length - 1).toBe(1)
  })

  it('una terminada no aparece además como lobby', () => {
    // Las dos vistas se reparten por estado: sería la misma partida ofreciéndose para entrar y
    // dándose por terminada a la vez.
    mocks.battles = [battle({ id: 'unica', machine_code: 'solo_una', settled_at: '2026-07-03T10:00:00Z' })]
    const { container } = pintar()
    expect(container.textContent).not.toContain('SOLO_UNA')
    verRecent()
    expect((container.textContent ?? '').split('SOLO_UNA').length - 1).toBe(1)
  })

  it('las terminadas de los DOS modos caen en la misma pestaña', () => {
    // Es lo que hace innecesaria la sección aparte: Recent nunca fue solo de royale.
    mocks.battles = [
      battle({ id: 'r', mode: 'royale', machine_code: 'royale_fin', settled_at: '2026-07-03T10:00:00Z' }),
      battle({ id: 'p', mode: 'pack', machine_code: 'pack_fin', settled_at: '2026-07-02T10:00:00Z' }),
    ]
    const { container } = pintar('all')
    verRecent()
    expect(container.textContent).toContain('ROYALE_FIN')
    expect(container.textContent).toContain('PACK_FIN')
  })
})

describe('Lobby · partidas terminadas: Result y Replay', () => {
  const terminada = () => {
    mocks.battles = [battle({ id: 'terminada', status: 'settled', winner: 'ME' } as Partial<OpenBattle>)]
    pintar()
    verRecent()          // las terminadas viven en esa pestaña de Live games
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


describe('Lobby · lo que enseña la card de una partida terminada', () => {
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
    // Rejilla de dos filas, como en RoyaleBattleWide: el rótulo y su cifra comparten columna,
    // así que centrarlos no depende de que dos cajas sueltas midan lo mismo.
    const rejilla = screen.getByText('BUY-IN').parentElement as HTMLElement
    expect(rejilla.style.display).toBe('grid')
    expect(rejilla.style.gridTemplateColumns).toBe('auto 1fr auto')
    // Los cuatro —los dos rótulos y las dos cifras— centrados en su celda.
    for (const t of ['BUY-IN', 'TOTAL POT', '$10', '$40']) {
      expect((screen.getByText(t) as HTMLElement).style.textAlign).toBe('center')
    }
    // Y todos en la MISMA rejilla, que es lo que hace que compartan columna.
    for (const t of ['TOTAL POT', '$10', '$40']) {
      expect(rejilla.contains(screen.getByText(t))).toBe(true)
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

// ── el Lobby unificado ───────────────────────────────────────────────────────

describe('Lobby · los dos modos en la MISMA lista', () => {
  const dos = () => {
    mocks.battles = [
      battle({ id: 'r', mode: 'royale', status: 'lobby', machine_code: 'maq_royale' }),
      battle({ id: 'p', mode: 'pack', status: 'lobby', machine_code: 'maq_pack' }),
    ]
  }

  it('sin filtro salen las dos, con la misma tarjeta', () => {
    // La razón de juntarlas: partir la lista en dos alturas obligaba a bajar para ver la otra
    // mitad, y con pocos jugadores cada mitad parecía un lobby muerto.
    dos()
    const { container } = pintar('all')
    expect(container.textContent).toContain('MAQ_ROYALE')
    expect(container.textContent).toContain('MAQ_PACK')
  })

  it('el botón del desplegable dice qué se está mirando', () => {
    dos()
    pintar('all')
    expect(screen.getByRole('button', { name: /All games/ })).toBeTruthy()
    cleanup()
    dos()
    pintar('royale')
    expect(screen.getByRole('button', { name: /Battle Royale/ })).toBeTruthy()
  })

  it('el desplegable trae una casilla por modo, con su cuenta', () => {
    dos()
    pintar('all')
    fireEvent.click(screen.getByRole('button', { name: /All games/ }))
    expect(screen.getByRole('checkbox', { name: /Pack Battle/ })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: /Battle Royale/ })).toBeTruthy()
    // La cuenta va también en cero: distingue "no hay nadie" de "no ha cargado". Se mira en el
    // texto de la etiqueta y no en el nombre accesible, que no la incluye.
    const fila = screen.getByRole('checkbox', { name: /Pack Battle/ }).closest('label')
    expect(fila?.textContent).toContain('1')
  })

  it('desmarcar un modo lo saca de la lista', () => {
    dos()
    const { container } = pintar('pack')
    expect(container.textContent).toContain('MAQ_PACK')
    expect(container.textContent).not.toContain('MAQ_ROYALE')
  })

  it('sin ningún modo se explica, en vez de dejar la pantalla en blanco', () => {
    // Una lista vacía sin motivo se lee como "no hay partidas" cuando sí las hay.
    dos()
    pintar('none')
    expect(screen.getByText(/No modes selected/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Show all games/ })).toBeTruthy()
  })
})

// ── el aviso de la demo de Battle Royale ─────────────────────────────────────
//
// Vivía en la página de Royale, arriba del todo, para llegar antes que el precio y el botón de
// unirse. En el Lobby unificado hay que decidir cuándo aparece, y eso lo decide esta pantalla.

describe('Lobby · el aviso de la demo', () => {
  it.each(['all', 'pack', 'royale', 'none'] as const)(
    'sale con el filtro en %s: el vídeo tiene que estar localizable siempre', (filtro) => {
      // Incluso filtrando solo Pack Battle. Esconderlo ahí ahorraría una fila y a cambio obligaría
      // a cambiar de filtro para encontrar el vídeo, que es justo lo que no se quiere.
      mocks.battles = [battle({ id: 'r', mode: 'royale', status: 'lobby' })]
      pintar(filtro)
      expect(screen.getByTestId('royale-demo')).toBeTruthy()
    })

  it('la guía de los tres modos está en el Lobby, y arriba del aviso', () => {
    // Contesta "¿qué es esto?", y esa pregunta llega antes que "no pagues sin ver el vídeo".
    mocks.battles = []
    pintar('all')
    const guia = screen.getByText(/How each mode works/i)
    const demo = screen.getByTestId('royale-demo')
    // Por posición en el DOM y no por índice en el texto: el aviso está doblado y no aporta texto,
    // así que comparar cadenas daba una aserción que se cumplía sola.
    expect(guia.compareDocumentPosition(demo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('sale incluso sin ninguna partida abierta', () => {
    // Es cuando más falta hace: no hay nada que mirar, así que el vídeo es lo único que explica a
    // qué se juega.
    mocks.battles = []
    pintar('all')
    expect(screen.getByTestId('royale-demo')).toBeTruthy()
  })
})
