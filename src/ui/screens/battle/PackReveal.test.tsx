import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PackReveal } from './PackReveal'
import type { RevealVM } from './battleReveal'
import { PHASE, PACK_PHASE } from './revealTiming'

const renderR = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

const cardA = { wallet: 'A', isMe: false, nftAddress: 'nftA', rarity: 'Rare', insuredValue: 300, autoSold: false, grade: 10, year: '2020', name: 'Blastoise' }
const cardB = { wallet: 'B', isMe: true, nftAddress: 'nftB', rarity: 'common', insuredValue: 10, autoSold: false, grade: 8, year: '2001', name: 'Rattata' }

const settled: RevealVM = {
  mode: 'pack', status: 'settled', winner: 'A', meWallet: 'B',
  players: [
    { wallet: 'A', isMe: false, accumulatedValue: 300, eliminatedRound: null, cards: [cardA], total: 300 },
    { wallet: 'B', isMe: true, accumulatedValue: 10, eliminatedRound: null, cards: [cardB], total: 10 },
  ],
  rounds: [],
  potValue: 310,
  machines: ['pokemon_50'],
  buybackTotal: 0, entry: 0,
}

describe('PackReveal', () => {
  // Stub the alias/machine fetches so the hooks resolve without real network.
  afterEach(() => vi.restoreAllMocks())

  it('reveals both big cards and highlights the winner once the round is shown + settled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alias: null }) }))
    // reduced-motion → the staged reveal jumps straight to the card, so both images render
    renderR(<PackReveal vm={settled} reducedMotion />)
    expect(screen.getAllByRole('img')).toHaveLength(2)
    expect(screen.getByText('You')).toBeTruthy()             // self shown as "You" (no alias)
    expect(await screen.findByText(/winner/i)).toBeTruthy()  // winner badge appears after the reveal completes
  })

  it('shows the card back (opening…) while a round’s pulls are unresolved', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alias: null }) }))
    const pending: RevealVM = {
      ...settled, status: 'running', winner: null,
      players: [
        { ...settled.players[0], cards: [{ ...cardA, nftAddress: null }], total: 0 },
        { ...settled.players[1], cards: [{ ...cardB, nftAddress: null }], total: 0 },
      ],
    }
    renderR(<PackReveal vm={pending} reducedMotion />)
    expect(screen.queryAllByRole('img')).toHaveLength(0)     // no card fronts until the pulls resolve
    expect(screen.getAllByText(/opening/i).length).toBeGreaterThan(0)
  })

  it('enseña año, grado y rareza a la vez, como en Battle Royale', () => {
    // Antes iban de uno en uno y cada dato borraba al anterior: al llegar la rareza ya no se veía
    // de qué año era la carta. Apilados conviven, que es como se lee el royale.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alias: null }) }))
    renderR(<PackReveal vm={settled} reducedMotion={false} />)
    expect(screen.getByText('2020')).toBeTruthy()
    expect(screen.getByText('10')).toBeTruthy()
    expect(screen.getByText('RARE')).toBeTruthy()
    expect(screen.getAllByText('Year').length).toBeGreaterThan(0)   // las etiquetas del apilado
  })
})


describe('PackReveal · va al ritmo de Pack Battle, no al del royale', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  /** En apilado las tres filas están en el DOM desde el principio; lo que cambia es la opacidad. */
  const opacidadDe = (texto: string) =>
    (screen.getAllByText(texto)[0]!.parentElement as HTMLElement).style.opacity

  it('el grado tarda el doble en aparecer que en un royale', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alias: null }) }))
    renderR(<PackReveal vm={settled} reducedMotion={false} />)

    // A la altura en que el royale ya habría sacado el grado, aquí todavía no.
    act(() => { vi.advanceTimersByTime(PHASE.year + 10) })
    expect(opacidadDe('10')).toBe('0')

    // Y sale al doble de tarde, que es lo que se pidió.
    act(() => { vi.advanceTimersByTime(PACK_PHASE.year - PHASE.year) })
    expect(opacidadDe('10')).toBe('1')
  })
})
