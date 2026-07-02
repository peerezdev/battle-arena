import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QuickMatch } from './QuickMatch'

describe('QuickMatch', () => {
  it('fires stake/create/demo handlers', () => {
    const onStake = vi.fn(), onCreate = vi.fn(), onPlayDemo = vi.fn()
    render(<QuickMatch selectedStake={50} onStake={onStake} onCreate={onCreate} onPlayDemo={onPlayDemo} />)
    fireEvent.click(screen.getByText('$125')); expect(onStake).toHaveBeenCalledWith(125)
    fireEvent.click(screen.getByText(/create battle/i)); expect(onCreate).toHaveBeenCalled()
    fireEvent.click(screen.getByText(/demo/i)); expect(onPlayDemo).toHaveBeenCalled()
  })
})
