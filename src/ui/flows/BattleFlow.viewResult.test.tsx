import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// `?view=result` es el contrato entre quien enlaza (el modal de "While you were away", los
// botones de Result de las listas) y esta pantalla: sin él se revive el reveal desde la primera
// carta. Aquí se fija que con él se entra directo al resultado.
vi.mock('../../onchain/useBattle', () => ({ useBattle: vi.fn() }))
vi.mock('../../wallet/embedded', () => ({ useEmbeddedSolanaAddress: () => 'A' }))
const nav = vi.hoisted(() => vi.fn())
const params = vi.hoisted(() => ({ query: 'view=result' }))
vi.mock('react-router-dom', () => ({
  useParams: () => ({ battleId: 'b1' }),
  useNavigate: () => nav,
  useSearchParams: () => [new URLSearchParams(params.query)],
  // El resultado de royale enlaza a la página de verificación. El doble pinta un <a> de
  // verdad para que un href equivocado siga siendo detectable desde los tests.
  Link: ({ to, children, ...r }: { to: string; children?: unknown }) =>
    <a href={to} {...r}>{children as never}</a>,
}))
vi.mock('@privy-io/react-auth', () => ({ useIdentityToken: () => ({ identityToken: 'tok' }) }))
// La sala de espera pide la delegación antes de unirse (BattleFlow.onJoinSelf). Sin estos
// dobles, el hook real tiraría de usePrivy/useSigners, que el mock de arriba no expone.
vi.mock('../components/useDelegationGate', () => ({
  useDelegationGate: () => ({ requireDelegation: (f: () => void) => f(), open: false }),
}))
vi.mock('../components/DelegationGate', () => ({ DelegationGate: () => null }))
vi.mock('../screens/battle/WinningsBuyback', () => ({ WinningsBuyback: () => null }))
vi.mock('../emotes/useBattleEmotes', () => ({ useBattleEmotes: vi.fn() }))
vi.mock('../emotes/useEmotes', () => ({ useEmotes: () => ({ byCode: {}, owned: [], slots: [], loading: false, updateSlots: vi.fn() }) }))
vi.mock('../useReducedMotion', () => ({ useReducedMotion: () => true }))
vi.mock('../../onchain/useOpenBattles', () => ({ useOpenBattles: () => ({ battles: [], loading: false, error: null }) }))
vi.mock('../useMachines', () => ({ useMachines: () => ({}), useMachineList: () => ({ machines: [], loading: false }) }))

import { useBattle } from '../../onchain/useBattle'
import { BattleFlow } from './BattleFlow'

const mockUseBattle = useBattle as unknown as ReturnType<typeof vi.fn>

const packSettled = {
  id: 'b1', mode: 'pack', machine_code: 'm', price: 50, max_players: 2, status: 'settled',
  winner: 'A', creator_wallet: 'A', server_seed_hash: 'h', buyin: 5e7,
  players: [
    { wallet: 'A', eliminated_round: null, accumulated_value: 160 },
    { wallet: 'B', eliminated_round: null, accumulated_value: 40 },
  ],
  rounds: [],
  pulls: [
    { player_wallet: 'A', round_number: 1, nft_address: 'nA', rarity: 'Rare', insured_value: 160, auto_sold: false, grade: 10, year: '2019', name: 'Card A' },
    { player_wallet: 'B', round_number: 1, nft_address: 'nB', rarity: 'Common', insured_value: 40, auto_sold: false, grade: 9, year: '2018', name: 'Card B' },
  ],
  packs: [{ machine_code: 'm', sequence: 0, price: 50 }],
}

describe('BattleFlow · ?view=result', () => {
  beforeEach(() => {
    params.query = 'view=result'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alias: null }) }))
    mockUseBattle.mockReturnValue({ battle: packSettled, loading: false, error: null })
  })

  it('con view=result entra en el resultado, sin revivir el reveal', () => {
    render(<BattleFlow />)
    // jsdom no trae matchMedia, así que sale la maqueta MÓVIL: su cabecera de standings
    // es 'RESULTS · N PLAYERS', no el 'FINAL STANDINGS' de escritorio.
    expect(screen.getByText(/RESULTS · 2 PLAYERS/)).toBeTruthy()
  })

  it('sin el parámetro se revive la partida desde el principio', () => {
    // Es la otra mitad del contrato: el enlace de "Replay" quita el parámetro a propósito.
    params.query = ''
    render(<BattleFlow />)
    expect(screen.queryByText(/RESULTS · 2 PLAYERS/)).toBeNull()
  })
})
