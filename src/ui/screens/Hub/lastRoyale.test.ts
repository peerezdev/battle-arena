import { describe, it, expect } from 'vitest'
import { lastSettledRoyale } from './lastRoyale'
import type { LiveBattle } from './hubMockData'

function b(over: Partial<LiveBattle>): LiveBattle {
  return {
    id: 'x', mode: 'royale', live: false, title: 'm', sub: '', players: [], cards: [],
    costLabel: 'ENTRY', costValue: 10, action: 'watch', entry: 10, pot: 100, slots: '5/5',
    statusText: 'Final', statusColor: '#888', battleStatus: 'settled',
    ...over,
  } as LiveBattle
}

describe('lastSettledRoyale', () => {
  it('devuelve la royale terminada más reciente por settled_at', () => {
    const out = lastSettledRoyale([
      b({ id: 'vieja', settledAt: '2026-07-01T10:00:00Z' }),
      b({ id: 'nueva', settledAt: '2026-07-20T10:00:00Z' }),
      b({ id: 'media', settledAt: '2026-07-10T10:00:00Z' }),
    ])
    expect(out?.id).toBe('nueva')
  })

  it('ignora las de modo pack', () => {
    const out = lastSettledRoyale([
      b({ id: 'pack', mode: 'pack', settledAt: '2026-07-20T10:00:00Z' }),
      b({ id: 'royale', settledAt: '2026-07-01T10:00:00Z' }),
    ])
    expect(out?.id).toBe('royale')
  })

  it('ignora las que no han terminado: en curso, anuladas o canceladas', () => {
    const noop: LiveBattle['battleStatus'][] = ['lobby', 'running', 'voided', 'cancelled']
    for (const st of noop) {
      expect(lastSettledRoyale([b({ battleStatus: st, settledAt: '2026-07-20T10:00:00Z' })])).toBeNull()
    }
  })

  it('sin ninguna royale terminada devuelve null', () => {
    expect(lastSettledRoyale([])).toBeNull()
    expect(lastSettledRoyale([b({ mode: 'pack' })])).toBeNull()
  })

  it('cae a created_at cuando falta settled_at', () => {
    const out = lastSettledRoyale([
      b({ id: 'sin-fecha', settledAt: null, createdAt: '2026-07-20T10:00:00Z' }),
      b({ id: 'con-fecha', settledAt: '2026-07-05T10:00:00Z' }),
    ])
    expect(out?.id).toBe('sin-fecha')
  })
})
