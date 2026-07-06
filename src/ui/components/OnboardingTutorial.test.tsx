import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OnboardingTutorial } from './OnboardingTutorial'

describe('OnboardingTutorial', () => {
  it('opens on the welcome step showing 1 / 4', () => {
    render(<OnboardingTutorial onClose={vi.fn()} />)
    expect(screen.getByText('Welcome to Collector Arena')).toBeTruthy()
    expect(screen.getByText('1 / 4')).toBeTruthy()
  })

  it('Next advances through the steps and the final button reads "Let\'s go"', () => {
    render(<OnboardingTutorial onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByText('Open real graded packs')).toBeTruthy()   // step 2
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByText('Battle head-to-head')).toBeTruthy()      // step 3
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByText('Climb the Ranking')).toBeTruthy()        // step 4
    expect(screen.getByText("Let's go")).toBeTruthy()                 // last step CTA
    expect(screen.queryByText('Next')).toBeNull()
  })

  it('the last-step CTA closes the tour', () => {
    const onClose = vi.fn()
    render(<OnboardingTutorial onClose={onClose} />)
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText("Let's go"))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('SKIP TOUR closes the tour immediately', () => {
    const onClose = vi.fn()
    render(<OnboardingTutorial onClose={onClose} />)
    fireEvent.click(screen.getByText('SKIP TOUR'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
