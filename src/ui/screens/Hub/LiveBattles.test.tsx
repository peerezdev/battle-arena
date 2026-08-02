import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LiveBattles } from './LiveBattles'
import type { LiveBattle } from './hubMockData'

// jsdom has no matchMedia, so useIsWide would always report narrow — pin it per test.
const mocks = vi.hoisted(() => ({ wide: true }))
vi.mock('../../useIsWide', () => ({ useIsWide: () => mocks.wide }))

const b: LiveBattle = { id: 'b1', mode: 'royale', live: false, title: 'ROYALE', sub: '', players: [{ violet: false }, { violet: true }], cards: [], costLabel: 'ENTRY', costValue: 562, action: 'join', entry: 562, pot: 2300, slots: '2/4', statusText: 'Filling', statusColor: '#f5c542' }

beforeEach(() => { mocks.wide = true })

describe('LiveBattles', () => {
  it('renders a card and fires join', () => {
    const onBattleAction = vi.fn()
    render(<LiveBattles battles={[b]} onBattleAction={onBattleAction} onOpen={vi.fn()} />)
    // Cada rótulo va encima de SU número; antes iban juntos en "ENTRY → ESTIMATED POT".
    expect(screen.getByText('ENTRY')).toBeTruthy()
    expect(screen.getByText('ESTIMATED POT')).toBeTruthy()               // en juego: solo se estima
    expect(screen.getByText('×4.1')).toBeTruthy()                        // pot/entry multiplier pill
    fireEvent.click(screen.getByRole('button', { name: /join/i }))
    expect(onBattleAction).toHaveBeenCalledWith(b)
  })

  it('shows the seats-left note whenever seats are open (not only "Filling")', () => {
    // a 2-player pack lobby with 1/2 is "Waiting for opponent" — must still show the note
    const pack: LiveBattle = { ...b, mode: 'pack', slots: '1/2', statusText: 'Waiting for opponent', statusColor: '#00ffc4' }
    render(<LiveBattles battles={[pack]} onBattleAction={vi.fn()} onOpen={vi.fn()} />)
    expect(screen.getByText(/1 seat left/i)).toBeTruthy()
  })

  it('hides the seats-left note when the lobby is full', () => {
    const full: LiveBattle = { ...b, slots: '4/4', statusText: 'Live', statusColor: '#ff5e7a', action: 'watch' }
    render(<LiveBattles battles={[full]} onBattleAction={vi.fn()} onOpen={vi.fn()} />)
    expect(screen.queryByText(/seats? left/i)).toBeNull()
  })

  it('mobile: compact card shows the pot box and the seats line instead of the header pot row', () => {
    mocks.wide = false
    render(<LiveBattles battles={[b]} onBattleAction={vi.fn()} onOpen={vi.fn()} />)
    expect(screen.getByText('EST. POT')).toBeTruthy()                    // pot box
    // El pie ya no lleva "2/4 · 2 left": los círculos se fueron y queda una sola línea.
    expect(screen.getByText('2 seats left')).toBeTruthy()
    expect(screen.queryByText('2/4')).toBeNull()
    expect(screen.queryByText('ESTIMATED POT')).toBeNull()               // rótulo solo de escritorio
  })

  it('the segmented filters actually filter (All / Ready to join / Mine / Recent)', () => {
    const lobby: LiveBattle = { ...b, id: 'lobby1', battleStatus: 'lobby', slots: '1/4', action: 'join', creatorWallet: 'ME' }
    const running: LiveBattle = { ...b, id: 'run1', battleStatus: 'running', slots: '4/4', action: 'watch', statusText: 'Live' }
    // A finished game I created — must appear in Recent but NOT in Mine (Mine = my active games).
    const done: LiveBattle = { ...b, id: 'done1', battleStatus: 'settled', slots: '4/4', action: 'watch', statusText: 'Final', creatorWallet: 'ME', settledAt: '2026-07-10T00:00:00Z' }
    render(<LiveBattles battles={[lobby, running, done]} meWallet="ME" onBattleAction={vi.fn()} onOpen={vi.fn()} />)

    // All (default): active games only (lobby + running); the settled one is hidden.
    expect(screen.getByText('2 live')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Join' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Result' })).toBeNull()

    // Recent → only the finished game (shows a "Result" button, no "Join").
    fireEvent.click(screen.getByText('Recent'))
    expect(screen.getByRole('button', { name: 'Result' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull()

    // Mine → only my games that haven't finished (the lobby). The settled game I created is excluded.
    fireEvent.click(screen.getByText('Mine'))
    expect(screen.getByRole('button', { name: 'Join' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Result' })).toBeNull()   // my settled game is NOT here

    // Ready to join → joinable open lobbies not already joined.
    fireEvent.click(screen.getByText('Ready to join'))
    expect(screen.getByRole('button', { name: 'Join' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Watch' })).toBeNull()
  })

  it('shows an empty-state message when a filter matches nothing', () => {
    const lobby: LiveBattle = { ...b, id: 'lobby1', battleStatus: 'lobby', slots: '1/4', action: 'join' }
    render(<LiveBattles battles={[lobby]} onBattleAction={vi.fn()} onOpen={vi.fn()} />)
    fireEvent.click(screen.getByText('Recent'))          // no settled games
    expect(screen.getByText(/No finished games yet/i)).toBeTruthy()
  })
})
