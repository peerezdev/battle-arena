import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// El módulo entero arrastra Privy, wallet y router; aquí solo interesa el reveal de una tirada.
vi.mock('@privy-io/react-auth', () => ({ useIdentityToken: () => ({ identityToken: 'tok' }) }))
vi.mock('../../../wallet/useWallet', () => ({ useWallet: () => ({ signTransactionBase64: vi.fn() }) }))
vi.mock('../../../wallet/useUsdcBalance', () => ({ useUsdcBalance: () => ({ usdc: 100, refresh: vi.fn() }) }))
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ search: '' }), useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams()],
}))

import { ResultadoConSkip } from './GachaVault'

const carta = {
  pending: false as const, nft_address: 'mint1', name: 'Charizard', rarity: 'Epic',
  image: null, images: [], insured_value: 500, auto_sold: false, buyback_amount: null,
  year: '2018', grade: '10', grading_company: 'PSA', grading_id: 'x', authenticated: true,
}

const pintar = (props = {}) =>
  render(<ResultadoConSkip result={carta as never} reduced={false} buybackPct={85}
    onClose={() => {}} {...props} />)

describe('ResultadoConSkip', () => {
  it('ofrece saltarse la ceremonia', () => {
    // Faltaba en las tiradas sueltas: solo lo tenía la secuencia de varios sobres. Se nota sobre
    // todo en el replay, donde quien abre el enlace ya sabe lo que salió.
    pintar()
    expect(screen.getByRole('button', { name: /Skip/i })).toBeTruthy()
  })

  it('al pulsarlo se va a la carta y el botón desaparece', () => {
    // Desaparece porque en el detalle no queda nada que saltar, y ocupaba el hueco que la ficha
    // necesita para llegar abajo.
    pintar()
    fireEvent.click(screen.getByRole('button', { name: /Skip/i }))
    expect(screen.queryByRole('button', { name: /Skip/i })).toBeNull()
    expect(screen.getByText('Charizard')).toBeTruthy()
  })

  it('con animaciones reducidas no se ofrece: ya se ve la carta', () => {
    pintar({ reduced: true })
    expect(screen.queryByRole('button', { name: /Skip/i })).toBeNull()
  })
})
