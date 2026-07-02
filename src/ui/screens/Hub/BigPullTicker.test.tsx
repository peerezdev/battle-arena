import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const drops = vi.hoisted(() => ({ value: [] as any[] }))
vi.mock('../../drops/useDrops', () => ({ useDrops: () => drops.value }))
vi.mock('../../useReducedMotion', () => ({ useReducedMotion: () => false }))

import { BigPullTicker } from './BigPullTicker'

describe('BigPullTicker', () => {
  it('renders nothing with no drops', () => {
    drops.value = []
    const { container } = render(<BigPullTicker meWallet={null} />)
    expect(container.firstChild).toBeNull()
  })
  it('renders a row per drop', () => {
    drops.value = [
      { id: 'a', name: 'Charizard', valueUsd: 2400, rarity: 'epic', username: 'Kx', wallet: 'Kx', source: 'gacha', ts: 1, image: null },
    ]
    render(<BigPullTicker meWallet={null} />)
    expect(screen.getAllByText(/Charizard/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/\$2\.4k|\$2,400/).length).toBeGreaterThan(0)
  })
})
