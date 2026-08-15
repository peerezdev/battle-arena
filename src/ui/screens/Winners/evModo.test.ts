import { describe, it, expect, beforeEach } from 'vitest'
import { convertible, enModo, guardarModo, leerModo } from './evModo'
import type { EvRow } from '../../../onchain/gachaClient'

const fila = (over: Partial<EvRow> = {}): EvRow => ({
  machine: 'pokemon_50', name: 'Elite Pokémon', pack_price: 50, buyback_pct: 0.85,
  realized_n_pulls: 300, realized_window_hours: 48, window_complete: true, hours_covered: 48,
  gaps: [], realized_edge_pct: 11.5, realized_ci_lo_pct: 8.0, realized_ci_hi_pct: 15.0,
  realized_verdict: 'CONFIDENT +EV', pulls_to_conclude: null, tiers: [],
  model_ev: null, model_ratio: null, model_edge_pct: null, ...over,
})

beforeEach(() => localStorage.clear())

describe('los dos modos', () => {
  it('"me la quedo" deja la medición tal cual', () => {
    const f = fila()
    expect(enModo(f, 'keep')).toBe(f)
  })

  it('"la revendo" aplica la recompra al punto', () => {
    // 0.85 × 1.115 − 1 = −5.2%. Es el número que sale a mano con los datos reales de mainnet.
    expect(enModo(fila(), 'cashout').realized_edge_pct).toBeCloseTo(-5.225, 3)
  })

  it('el intervalo se convierte igual, sin rehacer el bootstrap', () => {
    // La transformación es lineal, así que los extremos se mueven con el punto.
    const r = enModo(fila(), 'cashout')
    expect(r.realized_ci_lo_pct).toBeCloseTo(-8.2, 2)     // 0.85×1.08 − 1
    expect(r.realized_ci_hi_pct).toBeCloseTo(-2.25, 2)    // 0.85×1.15 − 1
  })

  it('el veredicto SE REHACE: lo que era positivo pasa a negativo', () => {
    // Es la razón de no limitarse a reescalar los números: el intervalo entero baja, y con él la
    // conclusión. Dejar el veredicto viejo diría "+EV" sobre un intervalo que ya está bajo cero.
    expect(fila().realized_verdict).toBe('CONFIDENT +EV')
    expect(enModo(fila(), 'cashout').realized_verdict).toBe('CONFIDENT -EV')
  })

  it('un intervalo que cruza el cero tras convertir queda sin concluir', () => {
    const r = enModo(fila({ realized_edge_pct: 20, realized_ci_lo_pct: 10, realized_ci_hi_pct: 30 }), 'cashout')
    expect(r.realized_ci_lo_pct! < 0 && r.realized_ci_hi_pct! > 0).toBe(true)
    expect(r.realized_verdict).toBe('unclear (CI crosses zero)')
  })

  it('los estados de COBERTURA se respetan, no se recalculan', () => {
    // BUILDING, GAP y NOT ENOUGH DATA hablan de la muestra, no del valor de la carta: mirar la
    // misma medición de otra forma no completa una ventana ni tapa un agujero.
    for (const v of ['BUILDING', 'GAP IN WINDOW', 'NOT ENOUGH DATA']) {
      expect(enModo(fila({ realized_verdict: v }), 'cashout').realized_verdict).toBe(v)
    }
  })

  it('el modelo se convierte con la MISMA regla que lo medido', () => {
    // Llega en valor de carta justo para esto. Si viniera con la recompra ya puesta habría que
    // hacerle algo distinto, y cualquier despiste ahí parecería una diferencia entre lo esperado y
    // lo medido que en realidad no existe.
    const f = fila({ model_ev: 26.998, model_ratio: 1.08, model_edge_pct: 8.0 })
    const r = enModo(f, 'cashout')
    expect(r.model_edge_pct).toBeCloseTo(-8.2, 1)      // 0.85 × 1.08 − 1
    expect(r.model_ratio).toBeCloseTo(0.918, 3)
    expect(r.model_ev).toBeCloseTo(22.95, 2)
  })

  it('el modelo y lo medido se mueven a la vez, no uno solo', () => {
    // Convertir una mitad y la otra no inventaría una brecha entre modelo y realidad.
    const f = fila({ realized_edge_pct: 8.0, model_edge_pct: 8.0, model_ratio: 1.08 })
    const r = enModo(f, 'cashout')
    expect(r.realized_edge_pct).toBeCloseTo(r.model_edge_pct!, 6)
  })

  it('una máquina sin modelo se convierte igual sin inventárselo', () => {
    const r = enModo(fila({ model_ev: null, model_ratio: null, model_edge_pct: null }), 'cashout')
    expect(r.realized_edge_pct).toBeCloseTo(-5.225, 3)
    expect(r.model_ratio).toBeNull()
  })

  it('sin buyback conocido no se convierte nada', () => {
    // Inventar un 85% daría un número con pinta de medido que no lo es.
    const f = fila({ buyback_pct: null })
    expect(enModo(f, 'cashout')).toBe(f)
    expect(convertible(f)).toBe(false)
    expect(convertible(fila())).toBe(true)
  })

  it('sin medición no hay nada que convertir en lo medido…', () => {
    const f = fila({ realized_edge_pct: null, realized_ci_lo_pct: null, realized_ci_hi_pct: null,
                     model_ev: null, model_ratio: null, model_edge_pct: null })
    expect(enModo(f, 'cashout')).toEqual(f)
  })

  it('…pero el modelo SÍ se convierte aunque todavía no haya medición', () => {
    // Es el caso de una máquina recién barrida que aún no tiene 48 h de feed: lo esperado ya se
    // sabe, y enseñarlo en valor de carta mientras el interruptor dice "a recompra" sería mentir.
    const f = fila({ realized_edge_pct: null, realized_ci_lo_pct: null, realized_ci_hi_pct: null,
                     model_ev: 26.998, model_ratio: 1.08, model_edge_pct: 8.0 })
    expect(enModo(f, 'cashout').model_ratio).toBeCloseTo(0.918, 3)
  })

  it('no muta la fila original', () => {
    const f = fila()
    enModo(f, 'cashout')
    expect(f.realized_edge_pct).toBe(11.5)
  })
})

describe('preferencia de modo', () => {
  it('por defecto es el conservador: lo que recuperas si vendes', () => {
    // Es el que no puede acusarte de vender humo, y el que cuadra con el EV del modelo.
    expect(leerModo()).toBe('cashout')
  })

  it('se recuerda', () => {
    guardarModo('keep')
    expect(leerModo()).toBe('keep')
    guardarModo('cashout')
    expect(leerModo()).toBe('cashout')
  })

  it('un valor raro guardado cae al de por defecto', () => {
    localStorage.setItem('ba.evTracker.modo', 'cualquier cosa')
    expect(leerModo()).toBe('cashout')
  })
})
