import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock the chat hook so ChatDock doesn't open a real WebSocket.
vi.mock('../../../hooks/useChat', () => ({
  useChat: () => ({ messages: [], send: vi.fn(), canPost: false, online: 0 }),
}))

import { ChatDock } from './ChatDock'
import { addDrop } from '../../drops/dropsStore'

beforeEach(() => {
  localStorage.clear()
})

describe('ChatDock live drops', () => {
  it('renders a drop row with the opener username', () => {
    addDrop({
      id: 'mint-1', name: 'Pikachu', valueUsd: 123.5, rarity: 'Rare',
      image: null, source: 'gacha', wallet: 'WalletABCDEF1234', username: 'neo',
      ts: Date.now(),
    })
    render(<ChatDock />)
    expect(screen.getByText('Pikachu')).toBeTruthy()
    expect(screen.getByText('neo')).toBeTruthy()
  })

  it('falls back to a short wallet when username is null', () => {
    addDrop({
      id: 'mint-2', name: 'Charizard', valueUsd: 999, rarity: 'Epic',
      image: null, source: 'gacha', wallet: 'So1anaAAAAAAAAAAAAAAZZZZ', username: null,
      ts: Date.now(),
    })
    render(<ChatDock />)
    expect(screen.getByText('Charizard')).toBeTruthy()
    expect(screen.getByText('So1a…ZZZZ')).toBeTruthy()
  })

  // Regression: a drop with ts in epoch SECONDS (backend / legacy cache) must render
  // a sane relative time, not "~20608d ago" from treating seconds as milliseconds.
  it('renders a seconds-epoch ts as a recent time, not decades ago', () => {
    addDrop({
      id: 'mint-secs', name: 'Mew', valueUsd: 50, rarity: 'Rare',
      image: null, source: 'gacha', wallet: 'WalletABCDEF1234', username: 'kai',
      ts: Math.floor(Date.now() / 1000), // seconds, like the backend emits
    })
    render(<ChatDock />)
    expect(screen.getByText('Mew')).toBeTruthy()
    // no drop should render a decades-old age from misreading seconds as ms
    expect(screen.queryByText(/\d{3,}d ago/)).toBeNull()
  })

  // Regression: drops persisted before the global-drops change lack wallet/username.
  // ChatDock must render them (as 'anon') instead of crashing on userColor(undefined).
  it('renders a legacy drop without wallet/username without crashing', () => {
    addDrop({
      id: 'mint-legacy', name: 'Squirtle', valueUsd: 10, rarity: 'Common',
      image: null, source: 'gacha', ts: Date.now(),
    } as any)
    render(<ChatDock />)
    expect(screen.getByText('Squirtle')).toBeTruthy()
    expect(screen.getByText('anon')).toBeTruthy()
  })
})
