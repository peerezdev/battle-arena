import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BattleResult } from './BattleResult'
import type { RevealVM } from './battleReveal'

// jsdom has no matchMedia (useIsWide → false = the mobile layout); pin it per test.
// The desktop result also mounts NextBattlePanel, so stub its lobby/machine sources.
const mocks = vi.hoisted(() => ({ wide: false, open: [] as Record<string, unknown>[] }))
vi.mock('../../useIsWide', () => ({ useIsWide: () => mocks.wide }))
vi.mock('../../../onchain/useOpenBattles', () => ({ useOpenBattles: () => ({ battles: mocks.open, loading: false, error: null }) }))
vi.mock('../../useMachines', () => ({ useMachines: () => ({}), useMachineList: () => ({ machines: [], loading: false }) }))

const mkCard = (nft: string, val: number) => ({
  wallet: '', isMe: false, nftAddress: nft, rarity: 'Rare', insuredValue: val, autoSold: false,
  grade: 10, year: '2019', name: 'Card',
})

const baseVm: RevealVM = {
  mode: 'pack', status: 'settled', winner: 'A', meWallet: 'A',
  players: [
    { wallet: 'A', isMe: true, accumulatedValue: 160, eliminatedRound: null, cards: [mkCard('nA', 160)], total: 160 },
    { wallet: 'B', isMe: false, accumulatedValue: 40, eliminatedRound: null, cards: [mkCard('nB', 40)], total: 40 },
  ],
  rounds: [], potValue: 200, machines: ['m'], buybackTotal: 0, entry: 0,
}

describe('BattleResult', () => {
  beforeEach(() => {
    mocks.wide = false
    mocks.open = []
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alias: null }) }))
  })
  afterEach(() => vi.restoreAllMocks())

  it('celebrates when I am the winner and shows the winner total', () => {
    render(<MemoryRouter><BattleResult vm={baseVm} battleId="b1" onExit={() => {}} /></MemoryRouter>)
    expect(screen.getByText(/you won/i)).toBeTruthy()
    expect(screen.getAllByText('$160').length).toBeGreaterThan(0)   // winner total
  })

  it('says you lost (and Volver works) when the winner is not me', () => {
    const onExit = vi.fn()
    render(<MemoryRouter><BattleResult vm={{ ...baseVm, meWallet: 'B' }} battleId="b1" onExit={onExit} /></MemoryRouter>)
    expect(screen.queryByText(/you won/i)).toBeNull()
    expect(screen.getByText(/you lost/i)).toBeTruthy()
    fireEvent.click(screen.getByText('Lobby'))   // mobile hero: the exit button is "Lobby"
    expect(onExit).toHaveBeenCalled()
  })

  // The loss hero is the red mirror of the green winner hero. The box is border + background, so
  // assert the red tint lands on both — and does NOT on a win.
  // The eyebrow sits at different depths on mobile vs desktop; climb to the box (the gradient div).
  const heroBox = () => {
    let el: HTMLElement | null = screen.getByText('PACK BATTLE · RESULT')
    while (el && !el.style.background.includes('radial-gradient')) el = el.parentElement
    return el as HTMLElement
  }
  // The loss hero wears the Next-Battle magenta (#ff2e7e). Green stays the winner colour.
  const RED = '255, 46, 126', GREEN = '60, 232, 168'

  it('el recuadro de "you lost" es rojo (la antítesis del verde de "you won")', () => {
    render(<MemoryRouter><BattleResult vm={{ ...baseVm, meWallet: 'B' }} battleId="b1" onExit={() => {}} /></MemoryRouter>)
    const box = heroBox()
    expect(box.style.background).toContain(RED)
    expect(box.style.border).toContain(RED)
    expect(box.style.background).not.toContain(GREEN)
  })

  it('el recuadro de "you won" es verde, no rojo', () => {
    render(<MemoryRouter><BattleResult vm={baseVm} battleId="b1" onExit={() => {}} /></MemoryRouter>)
    const box = heroBox()
    expect(box.style.background).toContain(GREEN)
    expect(box.style.background).not.toContain(RED)
  })

  it('un espectador ("Battle over") deja el recuadro neutro, ni rojo ni verde', () => {
    // Ningún jugador soy yo (isMe todo false) → no es derrota, es "Battle over" de espectador.
    const spectator: RevealVM = {
      ...baseVm, meWallet: 'Z', winner: 'A',
      players: baseVm.players.map((p) => ({ ...p, isMe: false })),
    }
    render(<MemoryRouter><BattleResult vm={spectator} battleId="b1" onExit={() => {}} /></MemoryRouter>)
    expect(screen.getByText(/battle over/i)).toBeTruthy()
    const box = heroBox()
    expect(box.style.background).not.toContain(RED)
    expect(box.style.background).not.toContain(GREEN)
  })

  it('desktop: shows the ×N return and suggests the fullest open lobby', () => {
    mocks.wide = true
    mocks.open = [
      // roomier lobby — should lose to the one closest to starting
      { id: 'x1', mode: 'pack', machine_code: 'm', price: 5e7, max_players: 4, players: 1, buyin: 5e7, creator_wallet: 'C', player_wallets: ['C'] },
      { id: 'x2', mode: 'pack', machine_code: 'm', price: 5e7, max_players: 4, players: 3, buyin: 5e7, creator_wallet: 'D', player_wallets: ['D', 'E', 'F'] },
    ]
    render(<MemoryRouter><BattleResult vm={{ ...baseVm, entry: 50 }} battleId="b1" onExit={() => {}} /></MemoryRouter>)
    expect(screen.getByText('FINAL STANDINGS')).toBeTruthy()
    expect(screen.getByText(/×4\.0 return/)).toBeTruthy()        // loot 200 / entry 50
    // La fila de MARGIN ("+$120 over #2") se quitó del panel: ya no se afirma.
    expect(screen.getByText('3/4')).toBeTruthy()                 // fewest free seats wins
    // La tarjeta del ganador también rotula ENTRY, así que se descuenta: lo que se comprueba
    // aquí son las pastillas del panel de siguiente partida, no las suyas.
    const tarjeta = screen.getByTestId('pnl-card')
    expect(screen.getAllByText('ENTRY').filter((el) => !tarjeta.contains(el))).toHaveLength(1)
    expect(screen.getByText('EST. POT')).toBeTruthy()
  })

  it('desktop: excludes lobbies I am already sitting in', () => {
    mocks.wide = true
    mocks.open = [{ id: 'x1', mode: 'pack', machine_code: 'm', price: 5e7, max_players: 4, players: 2, buyin: 5e7, creator_wallet: 'A', player_wallets: ['A', 'Z'] }]
    render(<MemoryRouter><BattleResult vm={{ ...baseVm, entry: 50 }} battleId="b1" onExit={() => {}} /></MemoryRouter>)
    expect(screen.getByText(/No lobbies are filling right now/i)).toBeTruthy()
  })
})


describe('BattleResult · tarjeta del ganador', () => {
  beforeEach(() => {
    mocks.wide = false
    mocks.open = []
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alias: null }) }))
  })
  afterEach(() => vi.restoreAllMocks())

  const pinta = (vm: RevealVM) =>
    render(<MemoryRouter><BattleResult vm={vm} battleId="b1" onExit={() => {}} /></MemoryRouter>)

  const GANADA = { ...baseVm, entry: 50 }

  it('al ganador se le enseña la tarjeta y el botón de compartir', () => {
    pinta(GANADA)
    expect(screen.getByTestId('pnl-card')).toBeTruthy()
    expect(screen.getByText('Share on X')).toBeTruthy()
  })

  it('a quien pierde NO se le ofrece presumir', () => {
    pinta({ ...GANADA, winner: 'B' })
    expect(screen.queryByTestId('pnl-card')).toBeNull()
    expect(screen.queryByText('Share on X')).toBeNull()
  })

  it('a un espectador tampoco', () => {
    pinta({ ...GANADA, meWallet: null })
    expect(screen.queryByTestId('pnl-card')).toBeNull()
  })

  it('también está en escritorio, que es donde viven las standings', () => {
    mocks.wide = true
    pinta(GANADA)
    expect(screen.getByTestId('pnl-card')).toBeTruthy()
    expect(screen.getByText('FINAL STANDINGS')).toBeTruthy()
  })

  it('el botón abre X con el tuit escrito', () => {
    pinta(GANADA)
    const a = screen.getByText('Share on X').closest('a') as HTMLAnchorElement
    const u = new URL(a.href)
    expect(u.hostname).toBe('x.com')
    expect(u.searchParams.get('text')).toContain('$150 profit')   // botín 200 − entrada 50
    expect(a.target).toBe('_blank')
    expect(a.rel).toContain('noopener')
  })
})
