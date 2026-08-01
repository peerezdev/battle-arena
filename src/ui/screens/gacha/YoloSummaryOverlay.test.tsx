import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// El módulo entero arrastra Privy, wallet y router; aquí solo interesa el resumen de la tirada.
vi.mock('@privy-io/react-auth', () => ({ useIdentityToken: () => ({ identityToken: 'tok' }) }))
vi.mock('../../../wallet/useWallet', () => ({ useWallet: () => ({ signTransactionBase64: vi.fn() }) }))
vi.mock('../../../wallet/useUsdcBalance', () => ({ useUsdcBalance: () => ({ usdc: 100, refresh: vi.fn() }) }))
vi.mock('react-router-dom', () => ({ useLocation: () => ({ search: '' }), useNavigate: () => vi.fn() }))

import { YoloSummaryOverlay } from './GachaVault'

const carta = (i: number, over = {}) => ({
  pending: false, nft_address: `mint${i}`, name: `Carta ${i}`, rarity: 'Rare',
  image: null, images: [], insured_value: 50, auto_sold: false, buyback_amount: null,
  grade: null, year: null, grading_company: null, grading_id: null, authenticated: null,
  ...over,
})

const pintar = (n = 12) =>
  render(
    <YoloSummaryOverlay
      results={Array.from({ length: n }, (_, i) => carta(i)) as never}
      machineCodes={Array.from({ length: n }, () => 'pokemon_50')}
      buybackPct={85}
      onClose={vi.fn()}
    />,
  )

describe('YoloSummaryOverlay · qué scrollea', () => {
  it('solo la rejilla de cartas tiene scroll', () => {
    pintar()
    const rejilla = screen.getByTestId('gacha-summary-cards')
    expect(rejilla.style.overflowY).toBe('auto')
    // minHeight:0 es lo que permite a un hijo flex encoger; sin él la rejilla empuja el panel
    // y vuelve a scrollear todo.
    expect(rejilla.style.minHeight).toBe('0px')
  })

  it('Keep all y Sell all quedan FUERA de lo que scrollea', () => {
    pintar()
    const rejilla = screen.getByTestId('gacha-summary-cards')
    for (const nombre of ['Keep all', 'Sell all']) {
      const btn = screen.getByRole('button', { name: nombre })
      expect(rejilla.contains(btn)).toBe(false)
    }
  })

  it('el botón de cobrar también queda fuera', () => {
    pintar()
    const rejilla = screen.getByTestId('gacha-summary-cards')
    const claim = screen.getByRole('button', { name: /keep all & continue|claim|continue|done/i })
    expect(rejilla.contains(claim)).toBe(false)
  })

  it('el panel no scrollea por su cuenta: si lo hiciera, arrastraría los controles', () => {
    const { container } = pintar()
    const panel = screen.getByTestId('gacha-summary-cards').parentElement as HTMLElement
    expect(panel.style.overflowY).not.toBe('auto')
    expect(panel.style.display).toBe('flex')
    expect(panel.style.flexDirection).toBe('column')
    expect(container).toBeTruthy()
  })

  it('las cartas se siguen pintando', () => {
    pintar(3)
    expect(screen.getByText('Carta 0')).toBeTruthy()
    expect(screen.getByText('Carta 2')).toBeTruthy()
  })
})
