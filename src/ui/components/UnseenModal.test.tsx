import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { UnseenModal } from './UnseenModal'
import type { UnseenBattle } from '../../onchain/packBattleClient'
import type { PendingPack } from '../../onchain/gachaClient'

const battle = (over: Partial<UnseenBattle> = {}): UnseenBattle => ({
  battle_id: 'b1', mode: 'pack', machine_code: 'pokemon_50', status: 'settled',
  won: true, amount_usd: 160, settled_at: '2026-07-27T09:00:00Z', ...over,
})
const pack = (memo: string, type = 'pokemon_250'): PendingPack =>
  ({ memo, pack_type: type, submitted_at: '2026-07-27T09:00:00Z' } as PendingPack)

function renderModal(over: Partial<Parameters<typeof UnseenModal>[0]> = {}) {
  const props = {
    packs: [] as PendingPack[], battles: [battle()], busy: false,
    onOpenAllPacks: vi.fn(), onSkipPacks: vi.fn(),
    onWatchBattle: vi.fn(), onResultBattle: vi.fn(), onSeeAllBattles: vi.fn(),
    ...over,
  }
  render(<UnseenModal {...props} />)
  return props
}

describe('UnseenModal · batallas', () => {
  it('una batalla jugada NO destripa el resultado: dice "Finished — result unseen"', () => {
    renderModal({ battles: [battle({ won: true, amount_usd: 160 })] })
    expect(screen.getByText(/Finished — result unseen/)).toBeTruthy()
    expect(screen.queryByText(/You won|\+\$160/)).toBeNull()
  })

  it('sus salidas son revivirla o ir al resultado', () => {
    const props = renderModal()
    fireEvent.click(screen.getByRole('button', { name: /replay battle/i }))
    expect(props.onWatchBattle).toHaveBeenCalledTimes(1)   // revivirla va directa: no se pierde nada
    // Ir al resultado pasa por la confirmación, que tiene su propio bloque de tests.
    fireEvent.click(screen.getByRole('button', { name: /see result/i }))
    expect(screen.getByRole('dialog', { name: 'Skip the battle?' })).toBeTruthy()
  })

  it('una reembolsada dice qué pasó y solo ofrece "View"', () => {
    renderModal({ battles: [battle({ status: 'cancelled', won: false })] })
    expect(screen.getByText('Cancelled · refunded')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'View' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /replay battle/i })).toBeNull()
  })
})

describe('UnseenModal · salida en bloque de las batallas', () => {
  // El "Resolve" se quitó: daba por vistos de un toque resultados que el jugador no había visto,
  // y eso no se deshace. Solo queda el "Continue" de las reembolsadas, donde no hay nada que ver.
  it('con batallas jugadas NO hay salida en bloque', () => {
    renderModal({ battles: [battle({ battle_id: 'b1' }), battle({ battle_id: 'b2', won: false, amount_usd: -50 })] })
    expect(screen.queryByRole('button', { name: /Resolve/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
  })

  it('si TODAS son reembolsos (cancelada/anulada) la salida es "Continue"', () => {
    renderModal({ battles: [battle({ status: 'cancelled', won: false }), battle({ battle_id: 'b2', status: 'voided', won: false })] })
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
  })

  it('basta UNA jugada entre reembolsos para que no haya salida en bloque', () => {
    renderModal({ battles: [battle({ status: 'cancelled', won: false }), battle({ battle_id: 'b2', status: 'settled' })] })
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
  })

  it('"Continue" avisa al padre (que es quien las marca vistas)', () => {
    const props = renderModal({ battles: [battle({ status: 'cancelled', won: false })] })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(props.onSeeAllBattles).toHaveBeenCalledTimes(1)
  })

  it('mientras está ocupado no se puede pulsar', () => {
    const props = renderModal({ busy: true, battles: [battle({ status: 'cancelled', won: false })] })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(props.onSeeAllBattles).not.toHaveBeenCalled()
  })
})

describe('UnseenModal · confirmar antes de saltarse la batalla', () => {
  it('"See result" NO va directo: pregunta primero', () => {
    const props = renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'See result' }))
    expect(props.onResultBattle).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Skip the battle?' })).toBeTruthy()
  })

  it('"Yes" salta al resultado de ESA batalla', () => {
    const props = renderModal({ battles: [battle({ battle_id: 'b1' }), battle({ battle_id: 'b2' })] })
    fireEvent.click(screen.getAllByRole('button', { name: 'See result' })[1]!)
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
    expect(props.onResultBattle).toHaveBeenCalledTimes(1)
    expect(props.onResultBattle).toHaveBeenCalledWith(expect.objectContaining({ battle_id: 'b2' }))
  })

  it('"No" cierra el aviso y no se salta nada', () => {
    const props = renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'See result' }))
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    expect(props.onResultBattle).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('una reembolsada va directa: no hay reveal que perderse', () => {
    const props = renderModal({ battles: [battle({ status: 'cancelled', won: false })] })
    fireEvent.click(screen.getByRole('button', { name: 'View' }))
    expect(props.onResultBattle).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('UnseenModal · sobres', () => {
  it('una sola máquina: "N × TÍTULO" con el total pagado', () => {
    renderModal({ battles: [], packs: [pack('m1'), pack('m2'), pack('m3')] })
    expect(screen.getByText(/3 ×/)).toBeTruthy()
    expect(screen.getByText('$750 in packs to reveal')).toBeTruthy()   // 3 × 250
    expect(screen.getByRole('button', { name: 'Open all 3' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Skip to results' })).toBeTruthy()
  })

  it('máquinas mezcladas: "N packs" con el desglose', () => {
    renderModal({ battles: [], packs: [pack('m1', 'pokemon_250'), pack('m2', 'pokemon_50')] })
    expect(screen.getByText('2 packs')).toBeTruthy()
    expect(screen.getByText('$300 in packs to reveal')).toBeTruthy()   // 250 + 50
  })

  it('el desglose va una máquina por línea, no todo en una', () => {
    renderModal({ battles: [], packs: [pack('m1', 'pokemon_50'), pack('m2', 'pokemon_250'), pack('m3', 'pokemon_250')] })
    // cada máquina es su propio nodo de texto…
    const uno = screen.getByText(/^1 × /)
    const dos = screen.getByText(/^2 × /)
    expect(uno.textContent).not.toEqual(dos.textContent)
    // …y ninguno arrastra al otro detrás de un separador
    expect(screen.queryByText(/× .+ · .+ ×/)).toBeNull()
  })

  it('un solo sobre dice "Open pack", no "Open all 1"', () => {
    renderModal({ battles: [], packs: [pack('m1')] })
    expect(screen.getByRole('button', { name: 'Open pack' })).toBeTruthy()
  })

  it('las salidas avisan al padre', () => {
    const props = renderModal({ battles: [], packs: [pack('m1')] })
    fireEvent.click(screen.getByRole('button', { name: 'Open pack' }))
    expect(props.onOpenAllPacks).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Skip to results' }))
    expect(props.onSkipPacks).toHaveBeenCalledTimes(1)
  })

  it('sin batallas no hay salida en bloque (solo la tarjeta de sobres)', () => {
    renderModal({ battles: [], packs: [pack('m1')] })
    expect(screen.queryByRole('button', { name: /Resolve|Continue/ })).toBeNull()
  })
})
