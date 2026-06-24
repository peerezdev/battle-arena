import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RevealCard, rarityColor } from './RevealCard'
import { RARITY, COLORS } from '../../theme'

const card = {
  wallet: 'A', isMe: true, nftAddress: 'nftA', rarity: 'Epic', insuredValue: 120, autoSold: false,
  grade: 10, year: '2018', name: 'Charizard',
}

describe('RevealCard', () => {
  it('shows a face-down opening state when the pull is pending', () => {
    render(<RevealCard card={{ ...card, nftAddress: null }} reducedMotion />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText(/opening/i)).toBeTruthy()
  })

  it('shows the card image (by mint) once resolved', () => {
    render(<RevealCard card={card} reducedMotion />)
    const img = screen.getByRole('img') as HTMLImageElement
    expect(img.src).toBe('https://nft-dev.collectorcrypt.com/front/nftA')
    expect(screen.getByText('$120')).toBeTruthy()
  })

  it('marks auto-sold cards', () => {
    render(<RevealCard card={{ ...card, autoSold: true }} reducedMotion />)
    expect(screen.getByText('⚡')).toBeTruthy()
  })

  it('renders bigger at size="lg" (default sm)', () => {
    const { container: sm } = render(<RevealCard card={card} reducedMotion />)
    expect((sm.firstChild as HTMLElement).style.width).toBe('92px')
    const { container: lg } = render(<RevealCard card={card} reducedMotion size="lg" />)
    expect((lg.firstChild as HTMLElement).style.width).toBe('180px')
  })

  it('maps rarity case-insensitively, unknown → muted', () => {
    expect(rarityColor('Epic')).toBe(RARITY.epic)
    expect(rarityColor('common')).toBe(RARITY.common)
    expect(rarityColor(null)).toBe(COLORS.muted)
  })
})
