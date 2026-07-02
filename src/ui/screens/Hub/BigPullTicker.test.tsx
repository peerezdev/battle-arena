import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const drops = vi.hoisted(() => ({ value: [] as any[] }))
const reduced = vi.hoisted(() => ({ value: false }))
vi.mock('../../drops/useDrops', () => ({ useDrops: () => drops.value }))
vi.mock('../../useReducedMotion', () => ({ useReducedMotion: () => reduced.value }))

import { BigPullTicker } from './BigPullTicker'
import { COLORS } from '../../theme'

describe('BigPullTicker', () => {
  beforeEach(() => {
    reduced.value = false
  })

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

  it('drops duplicated marquee row set under reduced motion', () => {
    reduced.value = true
    drops.value = [
      { id: 'a', name: 'Charizard', valueUsd: 2400, rarity: 'epic', username: 'Kx', wallet: 'Kx', source: 'gacha', ts: 1, image: null },
    ]
    render(<BigPullTicker meWallet={null} />)
    // With reduced motion, each drop's name should render exactly once (no duplicate)
    expect(screen.getAllByText(/Charizard/).length).toBe(1)
  })

  it('renders own drop username in green', () => {
    drops.value = [
      { id: 'a', name: 'Charizard', valueUsd: 2400, rarity: 'epic', username: 'me', wallet: 'me', source: 'gacha', ts: 1, image: null },
    ]
    render(<BigPullTicker meWallet={'me'} />)
    const usernameElements = screen.getAllByText(/^me$/)
    expect(usernameElements.length).toBeGreaterThan(0)
    // Check that the username has the green color applied (COLORS.green = '#00ffc4')
    const computedStyle = window.getComputedStyle(usernameElements[0])
    expect(computedStyle.color).toBe('rgb(0, 255, 196)')
  })

  it('renders row with common rarity using green fallback glow', () => {
    drops.value = [
      { id: 'a', name: 'Pidgeot', valueUsd: 50, rarity: 'common', username: 'Alex', wallet: 'Alex', source: 'gacha', ts: 1, image: null },
    ]
    render(<BigPullTicker meWallet={null} />)
    // Should render without crashing, exercising the rarityGlow null fallback
    // Each drop is rendered twice (duplicate row set), so use getAllByText
    expect(screen.getAllByText(/Pidgeot/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Alex/).length).toBeGreaterThan(0)
  })
})
