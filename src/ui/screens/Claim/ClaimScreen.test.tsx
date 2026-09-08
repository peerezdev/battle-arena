import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ fetchAirdrop: vi.fn(), claimAirdrop: vi.fn(), isDevnet: false }))
vi.mock('../../../onchain/airdropClient', async () => {
  const real = await vi.importActual<typeof import('../../../onchain/airdropClient')>(
    '../../../onchain/airdropClient')
  return { ...real, fetchAirdrop: mocks.fetchAirdrop, claimAirdrop: mocks.claimAirdrop }
})
vi.mock('../../../onchain/config', () => ({ config: { get isDevnet() { return mocks.isDevnet } } }))
vi.mock('@privy-io/react-auth', () => ({ useIdentityToken: () => ({ identityToken: 'tok' }) }))

import { ClaimScreen } from './ClaimScreen'

beforeEach(() => {
  mocks.fetchAirdrop.mockReset(); mocks.claimAirdrop.mockReset(); mocks.isDevnet = false
})

describe('ClaimScreen', () => {
  it('en devnet avisa y no llama al backend', async () => {
    mocks.isDevnet = true
    render(<ClaimScreen />)
    expect(screen.getByText(/only exists on mainnet/i)).toBeTruthy()
    expect(mocks.fetchAirdrop).not.toHaveBeenCalled()
  })

  it('enseña la cantidad cuando es elegible', async () => {
    mocks.fetchAirdrop.mockResolvedValue(
      { eligible: true, amount: 1483000000, claimed: false, signature: null })
    render(<ClaimScreen />)
    expect(await screen.findByText('1,483')).toBeTruthy()
    const btn = screen.getByRole('button', { name: /claim/i })
    expect(btn).toHaveProperty('disabled', false)
  })

  it('dice que no es elegible sin ofrecer botón', async () => {
    mocks.fetchAirdrop.mockResolvedValue({ eligible: false, amount: 0, claimed: false, signature: null })
    render(<ClaimScreen />)
    expect(await screen.findByText(/not eligible/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /claim/i })).toBeNull()
  })

  it('al reclamar enseña la firma', async () => {
    mocks.fetchAirdrop.mockResolvedValue(
      { eligible: true, amount: 1483000000, claimed: false, signature: null })
    mocks.claimAirdrop.mockResolvedValue({ signature: 'sig-abc', amount: 1483000000 })
    render(<ClaimScreen />)
    fireEvent.click(await screen.findByRole('button', { name: /claim/i }))
    await waitFor(() => expect(screen.getByText(/sig-abc/)).toBeTruthy())
  })

  it('una firma sin confirmar en la cadena no bloquea el botón de reclamar', async () => {
    // El backend escribe la fila (con firma) al mandar la transacción, ANTES de que
    // confirme. `claimed` lo decide solo la cadena, así que una firma sola —sin
    // `claimed: true`— no puede convertirse en "ya reclamado": eso dejaría al jugador sin
    // botón para siempre, mirando un enlace a una transacción que quizá nunca cuajó.
    mocks.fetchAirdrop.mockResolvedValue(
      { eligible: true, amount: 1483000000, claimed: false, signature: 'sig-sin-confirmar' })
    render(<ClaimScreen />)
    expect(await screen.findByRole('button', { name: /claim/i })).toBeTruthy()
    expect(screen.queryByText(/already claimed/i)).toBeNull()
  })

  it('si ya estaba reclamado no ofrece reclamar otra vez', async () => {
    mocks.fetchAirdrop.mockResolvedValue(
      { eligible: true, amount: 1483000000, claimed: true, signature: 'sig-vieja' })
    render(<ClaimScreen />)
    expect(await screen.findByText(/already claimed/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^claim/i })).toBeNull()
  })

  it('un fallo de cadena se lee como reintentable y no como no elegible', async () => {
    const { AirdropError } = await import('../../../onchain/airdropClient')
    mocks.fetchAirdrop.mockRejectedValue(new AirdropError('chain'))
    render(<ClaimScreen />)
    expect(await screen.findByRole('button', { name: /try again/i })).toBeTruthy()
    expect(screen.queryByText(/not eligible/i)).toBeNull()
  })

  it('si falta firma delegada lo dice y no lo confunde con ya reclamado', async () => {
    const { AirdropError } = await import('../../../onchain/airdropClient')
    mocks.fetchAirdrop.mockResolvedValue(
      { eligible: true, amount: 1483000000, claimed: false, signature: null })
    mocks.claimAirdrop.mockRejectedValue(new AirdropError('needs_delegation'))
    render(<ClaimScreen />)
    fireEvent.click(await screen.findByRole('button', { name: /claim/i }))
    expect(await screen.findByText(/signing access/i)).toBeTruthy()
    expect(screen.queryByText(/already claimed/i)).toBeNull()
  })

  it('un fallo al reclamar deja el botón activo para reintentar', async () => {
    const { AirdropError } = await import('../../../onchain/airdropClient')
    mocks.fetchAirdrop.mockResolvedValue(
      { eligible: true, amount: 1483000000, claimed: false, signature: null })
    mocks.claimAirdrop.mockRejectedValue(new AirdropError('failed'))
    render(<ClaimScreen />)
    fireEvent.click(await screen.findByRole('button', { name: /claim/i }))
    expect(await screen.findByText(/try again in a moment/i)).toBeTruthy()
    const btn = screen.getByRole('button', { name: /claim/i })
    expect(btn).toHaveProperty('disabled', false)
  })

  it('si otra pestaña ya reclamó, pasa a la vista de ya reclamado en vez de dejar Claim activo', async () => {
    const { AirdropError } = await import('../../../onchain/airdropClient')
    mocks.fetchAirdrop.mockResolvedValue(
      { eligible: true, amount: 1483000000, claimed: false, signature: null })
    mocks.claimAirdrop.mockRejectedValue(new AirdropError('already_claimed'))
    render(<ClaimScreen />)
    fireEvent.click(await screen.findByRole('button', { name: /claim/i }))
    expect(await screen.findByText(/already claimed/i)).toBeTruthy()
    expect(screen.queryByText(/could not be completed/i)).toBeNull()
    // No debe quedar un botón Claim activo: la pantalla no puede decir "ya reclamado" y
    // debajo invitar a reclamar otra vez.
    expect(screen.queryByRole('button', { name: /^claim/i })).toBeNull()
  })

  it('tras un fallo de la carga inicial, reintentar vuelve a llamar y enseña la cantidad', async () => {
    const { AirdropError } = await import('../../../onchain/airdropClient')
    mocks.fetchAirdrop
      .mockRejectedValueOnce(new AirdropError('chain'))
      .mockResolvedValueOnce({ eligible: true, amount: 1483000000, claimed: false, signature: null })
    render(<ClaimScreen />)
    fireEvent.click(await screen.findByRole('button', { name: /try again/i }))
    expect(await screen.findByText('1,483')).toBeTruthy()
    expect(mocks.fetchAirdrop).toHaveBeenCalledTimes(2)
  })

  it('el botón de reintentar se deshabilita mientras la llamada está en curso', async () => {
    const { AirdropError } = await import('../../../onchain/airdropClient')
    mocks.fetchAirdrop.mockRejectedValueOnce(new AirdropError('chain'))
    let resolver: ((s: { eligible: boolean; amount: number; claimed: boolean; signature: string | null }) => void) | undefined
    mocks.fetchAirdrop.mockImplementationOnce(() => new Promise((resolve) => { resolver = resolve }))
    render(<ClaimScreen />)
    fireEvent.click(await screen.findByRole('button', { name: /try again/i }))
    const btn = await screen.findByRole('button', { name: /retrying/i })
    expect(btn).toHaveProperty('disabled', true)
    resolver?.({ eligible: true, amount: 1483000000, claimed: false, signature: null })
    expect(await screen.findByText('1,483')).toBeTruthy()
  })
})
