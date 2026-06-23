import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StagedCardReveal } from './StagedCardReveal'

describe('StagedCardReveal', () => {
  it('reduced-motion jumps straight to the card and fires onCardShown', () => {
    const onCardShown = vi.fn()
    render(
      <StagedCardReveal year="2018" grade={10} rarity="Epic" reduced onCardShown={onCardShown}>
        <div>THE CARD</div>
      </StagedCardReveal>,
    )
    expect(screen.getByText('THE CARD')).toBeTruthy()   // card slot shown immediately
    expect(screen.queryByText('2018')).toBeNull()       // year stage skipped
    expect(onCardShown).toHaveBeenCalled()
  })

  it('non-reduced starts on the first pre-card stage (YEAR)', () => {
    render(
      <StagedCardReveal year="2018" grade={10} rarity="Epic" reduced={false}>
        <div>THE CARD</div>
      </StagedCardReveal>,
    )
    expect(screen.getByText('2018')).toBeTruthy()       // first stage = year
    expect(screen.queryByText('THE CARD')).toBeNull()   // card not yet
  })
})
