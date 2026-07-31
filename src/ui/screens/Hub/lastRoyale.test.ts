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


// ── la lista completa para la sección Recent ─────────────────────────────────
// La pantalla pasó de enseñar UNA royale terminada al lado de Quick Match a acumularlas debajo de
// los lobbies, como el Recent de Live Games. Los criterios de qué entra son los mismos que ya
// tenía lastSettledRoyale — solo cambia que devuelve todas y ordenadas.

import { settledRoyales } from './lastRoyale'

describe('settledRoyales', () => {
  it('las devuelve de más reciente a más antigua', () => {
    const list = settledRoyales([
      b({ id: 'vieja', settledAt: '2026-07-01T10:00:00Z' }),
      b({ id: 'nueva', settledAt: '2026-07-03T10:00:00Z' }),
      b({ id: 'media', settledAt: '2026-07-02T10:00:00Z' }),
    ])
    expect(list.map((x) => x.id)).toEqual(['nueva', 'media', 'vieja'])
  })

  it('deja fuera lo que no sea una royale terminada', () => {
    const list = settledRoyales([
      b({ id: 'ok' }),
      b({ id: 'pack', mode: 'pack' }),
      b({ id: 'curso', battleStatus: 'running' }),
      b({ id: 'anulada', battleStatus: 'voided' }),
      b({ id: 'cancelada', battleStatus: 'cancelled' }),
    ])
    expect(list.map((x) => x.id)).toEqual(['ok'])
  })

  it('sin ninguna terminada devuelve lista vacía, no null', () => {
    expect(settledRoyales([b({ battleStatus: 'running' })])).toEqual([])
  })

  it('cae a created_at cuando falta settled_at', () => {
    const list = settledRoyales([
      b({ id: 'sin-fecha', settledAt: undefined, createdAt: '2026-07-01T10:00:00Z' }),
      b({ id: 'con-fecha', settledAt: '2026-07-05T10:00:00Z' }),
    ])
    expect(list.map((x) => x.id)).toEqual(['con-fecha', 'sin-fecha'])
  })

  it('la primera de la lista es la misma que devuelve lastSettledRoyale', () => {
    // Las dos existen a la vez, así que no pueden discrepar sobre cuál es la última.
    const rows = [
      b({ id: 'a', settledAt: '2026-07-01T10:00:00Z' }),
      b({ id: 'b', settledAt: '2026-07-04T10:00:00Z' }),
    ]
    expect(settledRoyales(rows)[0].id).toBe(lastSettledRoyale(rows)!.id)
  })
})
