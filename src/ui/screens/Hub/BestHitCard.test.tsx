import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const drops = vi.hoisted(() => ({ value: [] as any[] }))
vi.mock('../../drops/useDrops', () => ({ useDrops: () => drops.value }))

import { BestHitCard } from './BestHitCard'

describe('BestHitCard', () => {
  it('renders nothing with no drops', () => {
    drops.value = []
    const { container } = render(<BestHitCard meWallet={null} />)
    expect(container.firstChild).toBeNull()
  })
  it('shows the highest-value drop', () => {
    drops.value = [
      { id: 'a', name: 'Low', valueUsd: 50, rarity: 'common', username: 'x', wallet: 'x', image: null, ts: 2 },
      { id: 'b', name: 'Charizard', valueUsd: 2400, rarity: 'epic', username: 'Kx', wallet: 'Kx', image: null, ts: 1 },
    ]
    render(<BestHitCard meWallet={null} />)
    expect(screen.getByText('Charizard')).toBeTruthy()
    expect(screen.getByText(/Kx/)).toBeTruthy()
  })
})
