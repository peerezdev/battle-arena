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
