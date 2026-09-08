import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ isDevnet: false }))
vi.mock('../../../onchain/config', () => ({
  config: { get isDevnet() { return mocks.isDevnet } },
}))

import { ClaimBanner, CLAIM_BANNER_KEY } from './ClaimBanner'

const pintar = () => render(<MemoryRouter><ClaimBanner /></MemoryRouter>)

beforeEach(() => {
  mocks.isDevnet = false
  localStorage.clear()
})

describe('ClaimBanner', () => {
  it('enlaza a /claim', () => {
    pintar()
    const enlace = screen.getByRole('link', { name: /claim/i })
    expect(enlace.getAttribute('href')).toBe('/claim')
  })

  it('en devnet no se pinta: el airdrop solo existe en mainnet', () => {
    mocks.isDevnet = true
    const { container } = pintar()
    expect(container.textContent).toBe('')
  })

  it('al descartarlo desaparece', () => {
    const { container } = pintar()
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(container.textContent).toBe('')
  })

  it('descartado, sigue descartado al volver a montarlo', () => {
    pintar()
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    const segundo = pintar()
    expect(segundo.container.textContent).toBe('')
  })

  it('si localStorage revienta, el banner se pinta igual', () => {
    // Un navegador con el almacenamiento bloqueado no puede costarnos el banner entero.
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado') })
    pintar()
    expect(screen.getByRole('link', { name: /claim/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))   // no revienta
    getItem.mockRestore(); setItem.mockRestore()
  })

  it('la clave de localStorage es estable', () => {
    // Cambiarla resucita el banner a todo el mundo que ya lo había descartado.
    expect(CLAIM_BANNER_KEY).toBe('ba.claimBanner.dismissed')
  })
})
