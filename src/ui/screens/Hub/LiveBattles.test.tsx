import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LiveBattles } from './LiveBattles'
import type { LiveBattle } from './hubMockData'

const b: LiveBattle = { id: 'b1', mode: 'royale', live: false, title: 'ROYALE', sub: '', players: [{ violet: false }, { violet: true }], cards: [], costLabel: 'ENTRY', costValue: 562, action: 'join', entry: 562, pot: 2300, slots: '2/4', statusText: 'Filling', statusColor: '#f5c542' }

describe('LiveBattles', () => {
  it('renders a card and fires join', () => {
    const onBattleAction = vi.fn()
    render(<LiveBattles battles={[b]} onSelectMode={vi.fn()} onBattleAction={onBattleAction} onOpen={vi.fn()} />)
    expect(screen.getByText(/EST\.? POT/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /join/i }))
    expect(onBattleAction).toHaveBeenCalledWith(b)
  })
})
