import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const DIR = '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gKgBc'
vi.mock('@privy-io/react-auth/solana', () => ({ useWallets: () => ({ wallets: [{ address: DIR }] }) }))
vi.mock('../useReducedMotion', () => ({ useReducedMotion: () => true }))

import { DepositModal } from './DepositModal'

describe('DepositModal', () => {
  const pinta = () => render(<DepositModal open onClose={() => {}} />)

  it('enseña el QR y la dirección con su botón de copiar', () => {
    const { container } = pinta()
    expect(container.querySelector('svg')).toBeTruthy()   // el QR
    expect(screen.getByText(DIR)).toBeTruthy()
    expect(screen.getByText('Copy')).toBeTruthy()
  })

  it('y nada más: ni faucet de devnet ni el fund de Privy', () => {
    // Los dos se retiraron a petición. Este test es lo que impide que vuelvan sin querer.
    pinta()
    expect(screen.queryByText(/get test usdc/i)).toBeNull()
    expect(screen.queryByText(/fund with card/i)).toBeNull()
    expect(screen.queryByText(/devnet/i)).toBeNull()
    expect(screen.queryByText(/mainnet/i)).toBeNull()
  })

  it('cerrado no pinta nada', () => {
    const { container } = render(<DepositModal open={false} onClose={() => {}} />)
    expect(container.firstChild).toBeNull()
  })
})
