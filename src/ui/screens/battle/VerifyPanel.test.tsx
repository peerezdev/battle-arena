import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../onchain/packBattleClient', () => ({ verifyBattle: vi.fn() }))
import { verifyBattle } from '../../../onchain/packBattleClient'
import { VerifyPanel } from './VerifyPanel'

const mockVerify = verifyBattle as unknown as ReturnType<typeof vi.fn>
const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

describe('VerifyPanel', () => {
  beforeEach(() => mockVerify.mockReset())

  it('shows "commit verificado" when the revealed seed hashes to the committed hash', async () => {
    mockVerify.mockResolvedValue({ mode: 'pack', server_seed_hash: ABC, server_seed: 'abc', commit_ok: true, client_seed: 'cs', tie_break_index: null })
    render(<VerifyPanel battleId="b1" onClose={() => {}} />)
    expect(await screen.findByText(/commit verificado/i)).toBeTruthy()
    expect(mockVerify).toHaveBeenCalledWith('b1')
  })

  it('shows "no coincide" when the seed does not hash to the committed hash', async () => {
    mockVerify.mockResolvedValue({ mode: 'pack', server_seed_hash: 'deadbeef', server_seed: 'abc', commit_ok: false })
    render(<VerifyPanel battleId="b1" onClose={() => {}} />)
    expect(await screen.findByText(/no coincide/i)).toBeTruthy()
  })

  it('shows the seed-revealed-at-end state pre-settle', async () => {
    mockVerify.mockResolvedValue({ mode: 'pack', server_seed_hash: ABC, server_seed: null, commit_ok: null })
    render(<VerifyPanel battleId="b1" onClose={() => {}} />)
    expect(await screen.findByText(/se revela al terminar/i)).toBeTruthy()
  })

  it('renders royale rounds', async () => {
    mockVerify.mockResolvedValue({ mode: 'royale', server_seed_hash: ABC, server_seed: 'abc', commit_ok: true,
      rounds: [{ round_number: 1, client_seed: 'cs1', eliminated_wallet: 'WALLETabcdwxyz', tie_break_index: null }] })
    render(<VerifyPanel battleId="b1" onClose={() => {}} />)
    expect(await screen.findByText(/Ronda 1/i)).toBeTruthy()
  })

  it('shows an error when verifyBattle rejects', async () => {
    mockVerify.mockRejectedValue(new Error('boom'))
    render(<VerifyPanel battleId="b1" onClose={() => {}} />)
    expect(await screen.findByText(/no se pudo cargar/i)).toBeTruthy()
  })
})
