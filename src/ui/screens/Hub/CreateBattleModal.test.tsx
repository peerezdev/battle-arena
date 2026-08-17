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
      max_players: 2, mode: 'pack',   // pack default is now 2 (head-to-head)
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

// ── Battle Royale todavía no se puede crear ──────────────────────────────────

describe('CreateBattleModal · la opción Royale', () => {
  const abrir = (props = {}) =>
    render(<CreateBattleModal onClose={() => {}} onCreated={() => {}} {...props} />)

  it('sale con etiqueta SOON y no se puede pulsar', () => {
    // Se enseña para que se sepa que el modo existe, pero deshabilitada: enseñarla clicable y
    // fallar después es peor que decirlo antes.
    abrir()
    const royale = screen.getByRole('button', { name: /Royale/ })
    expect(royale.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('SOON')).toBeTruthy()
  })

  it('pulsarla NO cambia el modo', () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: /Royale/ }))
    // Sigue en pack: los recuentos de jugadores de pack son 2, 3 y 4.
    expect(screen.getByRole('button', { name: '4' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '10' })).toBeNull()
  })

  it('Pack sí se puede pulsar', () => {
    abrir()
    expect(screen.getByRole('button', { name: /Pack/ }).hasAttribute('disabled')).toBe(false)
  })

  it('con permiso, Royale se comporta normal y sin etiqueta', () => {
    // La lista de permitidos (`canCreateRoyale`) sigue existiendo: quien está en ella la crea.
    abrir({ royaleDisponible: true })
    const royale = screen.getByRole('button', { name: /Royale/ })
    expect(royale.hasAttribute('disabled')).toBe(false)
    expect(screen.queryByText('SOON')).toBeNull()
    fireEvent.click(royale)
    expect(screen.getByRole('button', { name: '10' })).toBeTruthy()
  })

  it('si llega bloqueado a royale SIN permiso, abre en pack', () => {
    // Abrir el modal en un callejón sin salida es peor que abrirlo en algo que sí se puede hacer.
    abrir({ lockedMode: 'royale' })
    expect(screen.getByRole('button', { name: '4' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '10' })).toBeNull()
  })
})
