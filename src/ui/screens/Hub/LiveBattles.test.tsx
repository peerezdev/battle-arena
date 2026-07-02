import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LiveBattles } from './LiveBattles'
import type { LiveBattle } from './hubMockData'

const b: LiveBattle = { id: 'b1', mode: 'royale', live: false, title: 'ROYALE', sub: '', players: [{ violet: false }, { violet: true }], cards: [], costLabel: 'ENTRY', costValue: 562, action: 'join', entry: 562, pot: 2300, slots: '2/4', statusText: 'Filling', statusColor: '#f5c542' }

describe('LiveBattles', () => {
  it('renders a card and fires join', () => {
    const onBattleAction = vi.fn()
    render(<LiveBattles battles={[b]} onBattleAction={onBattleAction} onOpen={vi.fn()} />)
    expect(screen.getByText(/EST\.? POT/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /join/i }))
    expect(onBattleAction).toHaveBeenCalledWith(b)
  })

  it('shows the seats-left note whenever seats are open (not only "Filling")', () => {
    // a 2-player pack lobby with 1/2 is "Waiting for opponent" — must still show the note
    const pack: LiveBattle = { ...b, mode: 'pack', slots: '1/2', statusText: 'Waiting for opponent', statusColor: '#00ffc4' }
    render(<LiveBattles battles={[pack]} onBattleAction={vi.fn()} onOpen={vi.fn()} />)
    expect(screen.getByText(/1 seat left · starts when full/i)).toBeTruthy()
  })

  it('hides the seats-left note when the lobby is full', () => {
    const full: LiveBattle = { ...b, slots: '4/4', statusText: 'Live', statusColor: '#ff5e7a', action: 'watch' }
    render(<LiveBattles battles={[full]} onBattleAction={vi.fn()} onOpen={vi.fn()} />)
    expect(screen.queryByText(/seats? left/i)).toBeNull()
  })
})
