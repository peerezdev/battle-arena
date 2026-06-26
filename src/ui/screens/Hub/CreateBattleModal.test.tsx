import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@privy-io/react-auth', () => ({ useIdentityToken: () => ({ identityToken: 'tok' }) }))
vi.mock('../../components/useDelegationGate', () => ({
  useDelegationGate: () => ({ requireDelegation: (fn: () => void) => fn(), open: false, busy: false, error: null, confirm: () => {}, cancel: () => {} }),
}))
vi.mock('../../components/DelegationGate', () => ({ DelegationGate: () => null }))
vi.mock('../../../onchain/gachaClient', () => ({
  fetchMachines: vi.fn().mockResolvedValue([
    { code: 'm25', name: 'PKMN 25', price: 25, odds: {}, stock: {}, ev: null, image: null, available: true },
    { code: 'm50', name: 'PKMN 50', price: 50, odds: {}, stock: {}, ev: null, image: null, available: true },
  ]),
}))
vi.mock('../../../onchain/packBattleClient', () => ({ createBattle: vi.fn().mockResolvedValue({ id: 'b1' }) }))
import { createBattle } from '../../../onchain/packBattleClient'
import { CreateBattleModal } from './CreateBattleModal'

const plusButtons = () => screen.getAllByRole('button', { name: '+' })

describe('CreateBattleModal multi-pack', () => {
  beforeEach(() => (createBattle as unknown as ReturnType<typeof vi.fn>).mockClear())

  it('builds a bundle with steppers and submits packs', async () => {
    render(<CreateBattleModal onClose={() => {}} onCreated={() => {}} />)
    await screen.findByText('PKMN 25')
    // Create is disabled with 0 boxes
    expect((screen.getByRole('button', { name: 'Create battle' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(plusButtons()[0])   // m25 → 1
    fireEvent.click(plusButtons()[0])   // m25 → 2
    fireEvent.click(plusButtons()[1])   // m50 → 1
    expect(screen.getByText(/3\/10 packs/)).toBeTruthy()
    const create = screen.getByRole('button', { name: 'Create battle' }) as HTMLButtonElement
    expect(create.disabled).toBe(false)
    fireEvent.click(create)
    expect(createBattle).toHaveBeenCalledWith('tok', {
      packs: [{ machine_code: 'm25', count: 2 }, { machine_code: 'm50', count: 1 }],
      max_players: 4, mode: 'pack',
    })
  })

  it('caps the bundle at 10 boxes (+ disabled)', async () => {
    render(<CreateBattleModal onClose={() => {}} onCreated={() => {}} />)
    await screen.findByText('PKMN 25')
    for (let i = 0; i < 10; i++) fireEvent.click(plusButtons()[0])   // m25 → 10
    expect(screen.getByText(/10\/10 packs/)).toBeTruthy()
    expect(plusButtons().every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
  })
})
