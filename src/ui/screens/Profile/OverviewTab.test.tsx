import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { UserStats } from '../../../hooks/useUserStats'

vi.mock('../../useMachines', () => ({ useMachines: () => ({ pokemon_50: { name: 'Elite Pokémon' } }) }))
vi.mock('../../useAliases', () => ({ useAliases: () => ({}) }))
vi.mock('../../../onchain/gachaClient', () => ({ ccCardImageUrl: (m: string) => `https://img/${m}.png` }))
vi.mock('./DelegationPanel', () => ({ DelegationPanel: () => null }))
vi.mock('./ReferrerPanel', () => ({ ReferrerPanel: () => null }))

import { OverviewTab } from './OverviewTab'

const stats = (over: Partial<UserStats> = {}): UserStats => ({
  battles: 3, wins: 1, winRate: 0.33, totalWageredUsd: 150,
  bestHit: null, bestVictory: null, ...over,
})

const carta = (over = {}) => ({
  name: 'Charizard', grade: 10, rarity: 'Epic', year: '2021',
  valueUsd: 300, nftAddress: 'n1', ...over,
})

describe('OverviewTab · Best Victory', () => {
  it('enseña la mejor carta de esa partida, no un trofeo genérico', () => {
    render(<OverviewTab stats={stats({
      bestVictory: {
        amountUsd: 450, mode: 'pack', machineCode: 'pokemon_50', opponents: ['W2'],
        bestCard: carta({ name: 'La buena', valueUsd: 300 }),
      },
    })} />)
    expect(screen.getByText(/Best card:/)).toBeTruthy()
    expect(screen.getByText('La buena')).toBeTruthy()
    // Y sobre todo: la MINIATURA es la de esa carta, no el trofeo. Sin esto el test pasaba
    // igual con el trofeo puesto, porque el texto de abajo se pinta en los dos casos.
    const img = screen.getByAltText('Best hit') as HTMLImageElement
    expect(img.src).toContain('n1')
    // El botín total sigue estando: son dos datos distintos.
    expect(screen.getByText('+$450')).toBeTruthy()
  })

  it('sin cartas en la partida no inventa una', () => {
    render(<OverviewTab stats={stats({
      bestVictory: { amountUsd: 0, mode: 'pack', machineCode: 'pokemon_50', opponents: [], bestCard: null },
    })} />)
    expect(screen.queryByText(/Best card:/)).toBeNull()
    expect(screen.queryByAltText('Best hit')).toBeNull()   // cae al trofeo
  })
})

describe('OverviewTab · Best Hit', () => {
  it('enseña la mejor carta venga de donde venga', () => {
    render(<OverviewTab stats={stats({ bestHit: carta({ name: 'Gacha grande', valueUsd: 900, source: 'gacha' }) })} />)
    expect(screen.getByText('Gacha grande')).toBeTruthy()
    expect(screen.getByText('$900')).toBeTruthy()
  })

  it('una carta de gacha sin grade ni year no rompe la tarjeta', () => {
    // El gacha no guarda esos dos campos; la tarjeta tiene que omitirlos en vez de pintar huecos.
    render(<OverviewTab stats={stats({
      bestHit: { name: 'Sin datos', grade: null, rarity: 'Epic', year: null, valueUsd: 500, nftAddress: 'n9', source: 'gacha' },
    })} />)
    expect(screen.getByText('Sin datos')).toBeTruthy()
    expect(screen.getByText('$500')).toBeTruthy()
  })

  it('sin nada invita a abrir un sobre', () => {
    render(<OverviewTab stats={stats()} />)
    expect(screen.getByText(/open a pack to set your best hit/i)).toBeTruthy()
  })
})
