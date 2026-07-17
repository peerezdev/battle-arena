import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QuickMatch } from './QuickMatch'

describe('QuickMatch', () => {
  it('fires create/demo handlers', () => {
    const onCreate = vi.fn(), onPlayDemo = vi.fn()
    render(<QuickMatch onCreate={onCreate} onPlayDemo={onPlayDemo} />)
    fireEvent.click(screen.getByText(/create/i)); expect(onCreate).toHaveBeenCalled()
    fireEvent.click(screen.getByText(/demo/i)); expect(onPlayDemo).toHaveBeenCalled()
  })

  it('adapts copy per mode and hides the demo when onPlayDemo is omitted (royale)', () => {
    render(<QuickMatch mode="royale" onCreate={vi.fn()} />)
    expect(screen.getByText('Battle Royale')).toBeTruthy()
    expect(screen.getByText(/create battle royale/i)).toBeTruthy()
    expect(screen.queryByText(/demo/i)).toBeNull()
  })
})

describe('QuickMatch royale create gate', () => {
  it('shows the create CTA by default', () => {
    render(<QuickMatch mode="royale" onCreate={() => {}} />)
    expect(screen.queryByText(/create battle royale/i)).not.toBeNull()
  })

  it('hides the create CTA when canCreate is false', () => {
    render(<QuickMatch mode="royale" onCreate={() => {}} canCreate={false} />)
    expect(screen.queryByText(/create battle royale/i)).toBeNull()
  })
})
