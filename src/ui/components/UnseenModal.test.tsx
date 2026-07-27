import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { UnseenModal } from './UnseenModal'
import type { UnseenBattle } from '../../onchain/packBattleClient'
import type { PendingPack } from '../../onchain/gachaClient'

const battle = (over: Partial<UnseenBattle> = {}): UnseenBattle => ({
  battle_id: 'b1', mode: 'pack', machine_code: 'pokemon_50', status: 'settled',
  won: true, amount_usd: 160, settled_at: '2026-07-27T09:00:00Z', ...over,
})
const pack = (memo: string): PendingPack =>
  ({ memo, pack_type: 'pokemon_50', submitted_at: '2026-07-27T09:00:00Z' } as PendingPack)

function renderModal(over: Partial<Parameters<typeof UnseenModal>[0]> = {}) {
  const props = {
    packs: [] as PendingPack[], battles: [battle()], busy: false,
    onOpenPack: vi.fn(), onOpenAllPacks: vi.fn(), onSkipPacks: vi.fn(),
    onWatchBattle: vi.fn(), onResultBattle: vi.fn(), onSeeAllBattles: vi.fn(),
    ...over,
  }
  render(<UnseenModal {...props} />)
  return props
}

describe('UnseenModal · salida en bloque de las batallas', () => {
  it('con varias batallas jugadas ofrece "Resolve all N"', () => {
    renderModal({ battles: [battle({ battle_id: 'b1' }), battle({ battle_id: 'b2', won: false, amount_usd: -50 })] })
    expect(screen.getByRole('button', { name: 'Resolve all 2' })).toBeTruthy()
  })

  it('con una sola batalla jugada dice "Resolve", no "Resolve all 1"', () => {
    renderModal()
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Resolve all/ })).toBeNull()
  })

  it('si TODAS son reembolsos (cancelada/anulada) la salida es "Continue"', () => {
    // No hay resultado que asumir: nadie jugó nada, solo se devolvió la entrada.
    renderModal({ battles: [battle({ status: 'cancelled', won: false }), battle({ battle_id: 'b2', status: 'voided', won: false })] })
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Resolve/ })).toBeNull()
  })

  it('basta UNA jugada entre reembolsos para que deje de ser "Continue"', () => {
    renderModal({ battles: [battle({ status: 'cancelled', won: false }), battle({ battle_id: 'b2', status: 'settled' })] })
    expect(screen.getByRole('button', { name: 'Resolve all 2' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
  })

  it('pulsarlo avisa al padre (que es quien las marca vistas)', () => {
    const props = renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))
    expect(props.onSeeAllBattles).toHaveBeenCalledTimes(1)
  })

  it('mientras está ocupado no se puede pulsar', () => {
    const props = renderModal({ busy: true })
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))
    expect(props.onSeeAllBattles).not.toHaveBeenCalled()
  })

  it('sin batallas no hay salida en bloque (solo la sección de sobres)', () => {
    renderModal({ battles: [], packs: [pack('m1')] })
    expect(screen.queryByRole('button', { name: /Resolve|Continue/ })).toBeNull()
    expect(screen.getByText(/Skip/)).toBeTruthy()
  })

  it('cada batalla mantiene su acción individual: jugada Watch+Result, reembolso solo View', () => {
    renderModal({ battles: [battle()] })
    expect(screen.getByRole('button', { name: 'Watch' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Result' })).toBeTruthy()
  })
})
