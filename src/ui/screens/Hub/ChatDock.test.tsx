import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Mock the chat hook so ChatDock doesn't open a real WebSocket. `chatState.messages` is
// mutable so individual tests can inject system announcements.
const { chatState } = vi.hoisted(() => ({ chatState: { messages: [] as any[] } }))
vi.mock('../../../hooks/useChat', () => ({
  useChat: () => ({ messages: chatState.messages, send: vi.fn(), canPost: false, online: 0 }),
}))

import { ChatDock } from './ChatDock'
import { addDrop } from '../../drops/dropsStore'

// ChatDock uses useNavigate (system-announcement buttons), so it needs a Router.
const renderDock = () => render(<MemoryRouter><ChatDock /></MemoryRouter>)

beforeEach(() => {
  localStorage.clear()
  chatState.messages = []
})

describe('ChatDock live drops', () => {
  // Recent Drops is hidden for now (kept in the code for future reuse) — the render-drops
  // tests below are skipped until it's re-enabled in ChatDock.
  it.skip('renders a drop row with the opener username', () => {
    addDrop({
      id: 'mint-1', name: 'Pikachu', valueUsd: 123.5, rarity: 'Rare',
      image: null, source: 'gacha', wallet: 'WalletABCDEF1234', username: 'neo',
      ts: Date.now(),
    })
    renderDock()
    expect(screen.getByText('Pikachu')).toBeTruthy()
    expect(screen.getByText('neo')).toBeTruthy()
  })

  it.skip('falls back to a short wallet when username is null', () => {
    addDrop({
      id: 'mint-2', name: 'Charizard', valueUsd: 999, rarity: 'Epic',
      image: null, source: 'gacha', wallet: 'So1anaAAAAAAAAAAAAAAZZZZ', username: null,
      ts: Date.now(),
    })
    renderDock()
    expect(screen.getByText('Charizard')).toBeTruthy()
    expect(screen.getByText('So1a…ZZZZ')).toBeTruthy()
  })

  // Regression: a drop with ts in epoch SECONDS (backend / legacy cache) must render
  // a sane relative time, not "~20608d ago" from treating seconds as milliseconds.
  it.skip('renders a seconds-epoch ts as a recent time, not decades ago', () => {
    addDrop({
      id: 'mint-secs', name: 'Mew', valueUsd: 50, rarity: 'Rare',
      image: null, source: 'gacha', wallet: 'WalletABCDEF1234', username: 'kai',
      ts: Math.floor(Date.now() / 1000), // seconds, like the backend emits
    })
    renderDock()
    expect(screen.getByText('Mew')).toBeTruthy()
    // no drop should render a decades-old age from misreading seconds as ms
    expect(screen.queryByText(/\d{3,}d ago/)).toBeNull()
  })

  // Regression: drops persisted before the global-drops change lack wallet/username.
  // ChatDock must render them (as 'anon') instead of crashing on userColor(undefined).
  it.skip('renders a legacy drop without wallet/username without crashing', () => {
    addDrop({
      id: 'mint-legacy', name: 'Squirtle', valueUsd: 10, rarity: 'Common',
      image: null, source: 'gacha', ts: Date.now(),
    } as any)
    renderDock()
    expect(screen.getByText('Squirtle')).toBeTruthy()
    expect(screen.getByText('anon')).toBeTruthy()
  })

  // Lobby v2: an Epic drop gets a "BIG PULL" badge next to its name — the badge is
  // driven by rarity, not value, so a low-value Epic still earns it.
  it.skip('shows a BIG PULL badge for an Epic drop (rarity-driven, not value)', () => {
    addDrop({
      id: 'mint-bigpull', name: 'Mewtwo', valueUsd: 200, rarity: 'Epic',
      image: null, source: 'gacha', wallet: 'WalletABCDEF1234', username: 'ash',
      ts: Date.now(),
    })
    renderDock()
    expect(screen.getByText('Mewtwo')).toBeTruthy()
    // The dropsStore accumulates in-memory across tests, so earlier Epics may also
    // carry the badge — assert at least one is present.
    expect(screen.getAllByText('BIG PULL').length).toBeGreaterThanOrEqual(1)
  })

  // System announcements (battle created / big hit / winner) render as a highlighted row,
  // and carry their action button when present.
  it('renders a system announcement with its action button', () => {
    chatState.messages = [{
      user: '📢 Arena', text: 'Nueva Pack Battle · entrada $50 USDC', ts: Date.now(),
      kind: 'system', action: { label: 'Unirse', battleId: 'b1', mode: 'pack' },
    }]
    renderDock()
    expect(screen.getByText('Nueva Pack Battle · entrada $50 USDC')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Unirse' })).toBeTruthy()
  })

  it('renders a battle-created event as "{creator} created a Pack Battle $50" + Join', () => {
    chatState.messages = [{
      user: 'prueba2', text: 'created a Pack Battle', ts: Date.now(),
      kind: 'system', event: 'created', amountUsd: 250, mode: 'pack',   // 250 → unique vs test drops
      action: { label: 'Join', battleId: 'b7', mode: 'pack' },
    }]
    renderDock()
    expect(screen.getByText('prueba2')).toBeTruthy()
    expect(screen.getByText(/created a Pack Battle/)).toBeTruthy()
    expect(screen.getByText('$250')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Join' })).toBeTruthy()
  })

  it('renders a system announcement without an action (no button)', () => {
    chatState.messages = [{
      user: '📢 Arena', text: '🔥 neo sacó Charizard · $300 (x6.0 la tirada)', ts: Date.now(),
      kind: 'system',
    }]
    renderDock()
    expect(screen.getByText(/neo sacó Charizard/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Unirse' })).toBeNull()
  })

  it('renders a big-hit event like created: player + name + gold value, no button', () => {
    chatState.messages = [{
      user: 'neo', text: 'sacó Charizard', ts: Date.now(),
      kind: 'system', event: 'hit', amountUsd: 320,
    }]
    renderDock()
    expect(screen.getByText('neo')).toBeTruthy()
    expect(screen.getByText(/sacó Charizard/)).toBeTruthy()
    expect(screen.getByText('$320')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Ver|Join|Unirse/ })).toBeNull()   // hits carry no action button
  })

  it('renders a winner event like created: player + mode + gold value + Ver button', () => {
    chatState.messages = [{
      user: 'mole', text: 'ganó Pack Battle', ts: Date.now(),
      kind: 'system', event: 'winner', amountUsd: 1200, mode: 'pack',
      action: { label: 'Ver', battleId: 'b9', mode: 'pack' },
    }]
    renderDock()
    expect(screen.getByText('mole')).toBeTruthy()
    expect(screen.getByText(/ganó Pack Battle/)).toBeTruthy()
    expect(screen.getByText('$1.2k')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ver' })).toBeTruthy()
  })
})
