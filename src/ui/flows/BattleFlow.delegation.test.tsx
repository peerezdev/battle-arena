import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../onchain/useBattle', () => ({ useBattle: vi.fn() }))
vi.mock('../../wallet/embedded', () => ({ useEmbeddedSolanaAddress: () => 'YO' }))
vi.mock('react-router-dom', () => ({
  useParams: () => ({ battleId: 'b1' }),
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams()],
  // El resultado de royale enlaza a la página de verificación. El doble pinta un <a> de
  // verdad para que un href equivocado siga siendo detectable desde los tests.
  Link: ({ to, children, ...r }: { to: string; children?: unknown }) =>
    <a href={to} {...r}>{children as never}</a>,
}))
vi.mock('@privy-io/react-auth', () => ({ useIdentityToken: () => ({ identityToken: 'tok' }) }))
vi.mock('../emotes/useBattleEmotes', () => ({ useBattleEmotes: vi.fn() }))
vi.mock('../emotes/useEmotes', () => ({
  useEmotes: () => ({ byCode: {}, owned: [], slots: [], loading: false, updateSlots: vi.fn() }),
}))
vi.mock('../useReducedMotion', () => ({ useReducedMotion: () => true }))
vi.mock('../screens/battle/WinningsBuyback', () => ({ WinningsBuyback: () => null }))
vi.mock('../../onchain/packBattleClient', async (orig) => ({
  ...(await orig<typeof import('../../onchain/packBattleClient')>()),
  joinBattle: vi.fn().mockResolvedValue({}),
}))

// El doble del gate: `delegado` decide si deja pasar la acción o la retiene, igual que hace el
// hook real con `useDelegation().delegated`.
const estado = vi.hoisted(() => ({ delegado: true }))
vi.mock('../components/useDelegationGate', () => ({
  useDelegationGate: () => ({
    requireDelegation: (accion: () => void) => { if (estado.delegado) accion() },
    open: !estado.delegado,
  }),
}))
vi.mock('../components/DelegationGate', () => ({ DelegationGate: () => null }))

import { joinBattle } from '../../onchain/packBattleClient'
import { useBattle } from '../../onchain/useBattle'
import { BattleFlow } from './BattleFlow'

const mockUseBattle = useBattle as unknown as ReturnType<typeof vi.fn>
const mockJoin = joinBattle as unknown as ReturnType<typeof vi.fn>

/** Un lobby en el que YO no estoy: el botón de unirse tiene que estar disponible. */
const lobby = (mode: 'pack' | 'royale') => ({
  id: 'b1', mode, machine_code: 'pokemon_25', price: 25_000_000, max_players: 2,
  status: 'lobby', winner: null, creator_wallet: 'OTRO', server_seed_hash: 'h',
  players: [{ wallet: 'OTRO' }], packs: [],
})

async function pulsarUnirse() {
  const btn = await screen.findByRole('button', { name: /join/i })
  fireEvent.click(btn)
}

beforeEach(() => { mockJoin.mockClear(); estado.delegado = true })

describe('BattleFlow · unirse exige delegación', () => {
  // Este camino —llegar a la sala por enlace o desde el lobby de la casa— NO tenía puerta, y
  // ModeHub sí. Un jugador sin delegar entraba, la sala se llenaba y la partida se anulaba para
  // TODOS: pasó en mainnet con una de 250 $, porque el servidor no podía firmar su tirada.
  it.each(['pack', 'royale'] as const)('con delegación, %s se une', async (mode) => {
    mockUseBattle.mockReturnValue({ battle: lobby(mode), error: null })
    render(<BattleFlow />)
    await pulsarUnirse()
    await waitFor(() => expect(mockJoin).toHaveBeenCalledWith('tok', 'b1'))
  })

  it.each(['pack', 'royale'] as const)('SIN delegación, %s no llega a unirse', async (mode) => {
    estado.delegado = false
    mockUseBattle.mockReturnValue({ battle: lobby(mode), error: null })
    render(<BattleFlow />)
    await pulsarUnirse()
    // Ni siquiera se intenta: el jugador ve el diálogo para delegar, y el resto de la sala se
    // libra de que su partida se anule al arrancar.
    await new Promise((r) => setTimeout(r, 50))
    expect(mockJoin).not.toHaveBeenCalled()
  })
})
