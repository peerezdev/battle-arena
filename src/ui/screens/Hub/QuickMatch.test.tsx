import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QuickMatch } from './QuickMatch'

describe('QuickMatch', () => {
  it('fires stake/create/demo handlers', () => {
    const onStake = vi.fn(), onCreate = vi.fn(), onPlayDemo = vi.fn()
    render(<QuickMatch selectedStake={50} onStake={onStake} onCreate={onCreate} onPlayDemo={onPlayDemo} />)
    fireEvent.click(screen.getByText('$125')); expect(onStake).toHaveBeenCalledWith(125)
    fireEvent.click(screen.getByText(/create/i)); expect(onCreate).toHaveBeenCalled()
    fireEvent.click(screen.getByText(/demo/i)); expect(onPlayDemo).toHaveBeenCalled()
  })

  it('adapts copy per mode and hides the demo when onPlayDemo is omitted (royale)', () => {
    render(<QuickMatch mode="royale" selectedStake={50} onStake={vi.fn()} onCreate={vi.fn()} />)
    expect(screen.getByText('Battle Royale')).toBeTruthy()
    expect(screen.getByText(/create battle royale/i)).toBeTruthy()
    expect(screen.queryByText(/demo/i)).toBeNull()
  })
})
