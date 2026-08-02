import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter } from 'react-router-dom'
import type { RevealVM } from './battleReveal'

// La ceremonia de la carta (StagedCardReveal) termina con un callback de animación que jsdom no
// dispara, así que con reducedMotion={false} el reveal nunca avanzaría y no se llegaría al final
// de la partida, que es justo lo que hay que probar aquí. Se sustituye por una carta que se
// entrega al momento: lo que se está probando es QUÉ pasa al acabar, no cómo se voltea.
vi.mock('./StagedCardReveal', () => ({
  StagedCardReveal: ({ onCardShown, children }: { onCardShown?: () => void; children: React.ReactNode }) => {
    useEffect(() => { onCardShown?.() }, [onCardShown])
    return <>{children}</>
  },
}))

import { PackReveal } from './PackReveal'

const renderR = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

const carta = (wallet: string, valor: number) => ({
  wallet, isMe: false, nftAddress: `nft${wallet}`, rarity: 'Rare', insuredValue: valor,
  autoSold: false, grade: 10, year: '2020', name: `Carta ${wallet}`,
})
const jugador = (wallet: string, valor: number) => ({
  wallet, isMe: wallet === 'B', accumulatedValue: valor, eliminatedRound: null,
  cards: [carta(wallet, valor)], total: valor,
})

function partida(totales: Array<[string, number]>, winner: string): RevealVM {
  return {
    mode: 'pack', status: 'settled', winner, meWallet: 'B',
    players: totales.map(([w, v]) => jugador(w, v)),
    rounds: [], potValue: 600, machines: ['pokemon_50'], buybackTotal: 0, entry: 50,
  }
}

const EMPATADA = partida([['A', 300], ['B', 300]], 'B')
const CLARA = partida([['A', 300], ['B', 10]], 'A')

describe('PackReveal · sorteo cuando se empata al valor más alto', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alias: null }) }))
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  // A pasos, para que React renderice entre timer y timer: los del giro se encadenan y un solo
  // salto grande solo dispararía el primero.
  const correr = (ms: number) => {
    for (let k = 0; k < Math.ceil(ms / 200); k++) act(() => { vi.advanceTimersByTime(200) })
  }

  it('el resultado no se adelanta al sorteo', () => {
    // Era el problema: la partida saltaba a la pantalla de resultado con un ganador ya marcado,
    // sin enseñar por qué ese y no el otro con el que empataba.
    const onComplete = vi.fn()
    renderR(<PackReveal vm={EMPATADA} reducedMotion={false} onComplete={onComplete} />)
    correr(3200)   // pasado el hold de la última carta
    expect(screen.getByText(/TIED FOR FIRST/)).toBeTruthy()
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('aterriza en el ganador que decidió el backend', () => {
    const onComplete = vi.fn()
    renderR(<PackReveal vm={EMPATADA} reducedMotion={false} onComplete={onComplete} />)
    correr(9000)
    expect(screen.getByText('★ WINNER')).toBeTruthy()
    expect(onComplete).toHaveBeenCalled()
  })

  it('sin empate no hay cartel y se pasa al resultado como siempre', () => {
    const onComplete = vi.fn()
    renderR(<PackReveal vm={CLARA} reducedMotion={false} onComplete={onComplete} />)
    correr(3200)
    expect(screen.queryByText(/TIED FOR FIRST/)).toBeNull()
    expect(onComplete).toHaveBeenCalled()
  })

  it('con reduced-motion no hay ceremonia', () => {
    const onComplete = vi.fn()
    renderR(<PackReveal vm={EMPATADA} reducedMotion onComplete={onComplete} />)
    correr(600)
    expect(screen.queryByText(/TIED FOR FIRST/)).toBeNull()
    expect(onComplete).toHaveBeenCalled()
  })
})
