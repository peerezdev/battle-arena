import { describe, it, expect } from 'vitest'
import { LENTO_MS, RAPIDO_MS, aplicarVivo } from './evVivo'
import type { EvRow, EvTier } from '../../../onchain/gachaClient'

const tier = (over: Partial<EvTier> = {}): EvTier => ({
  tier: 'Epic', current: 80, average: 165.7, seen: 12, sample: 2000, days_since: 0.1,
  cold: false, ...over,
})

const fila = (machine: string, over: Partial<EvRow> = {}): EvRow => ({
  machine, name: machine, pack_price: 50, buyback_pct: 0.85,
  realized_n_pulls: 3068, realized_window_hours: 48, window_complete: true, hours_covered: 48,
  gaps: [], realized_edge_pct: 6.65, realized_ci_lo_pct: 3.29, realized_ci_hi_pct: 10.14,
  realized_verdict: 'CONFIDENT +EV', pulls_to_conclude: null, tiers: [tier()], ...over,
})

describe('el carril rápido', () => {
  it('trae las rachas nuevas', () => {
    const r = aplicarVivo([fila('pokemon_50')], [{ machine: 'pokemon_50', tiers: [tier({ current: 81 })] }])
    expect(r[0].tiers[0].current).toBe(81)
  })

  it('NO toca el edge ni el intervalo ni el veredicto', () => {
    // Vienen del carril lento y son coherentes entre sí: sustituir uno solo dejaría la tarjeta
    // enseñando un intervalo calculado sobre una muestra que ya no es la que dice.
    const antes = fila('pokemon_50')
    const [d] = aplicarVivo([antes], [{ machine: 'pokemon_50', tiers: [tier({ current: 81 })] }])
    expect(d.realized_edge_pct).toBe(antes.realized_edge_pct)
    expect(d.realized_ci_lo_pct).toBe(antes.realized_ci_lo_pct)
    expect(d.realized_ci_hi_pct).toBe(antes.realized_ci_hi_pct)
    expect(d.realized_verdict).toBe(antes.realized_verdict)
    expect(d.realized_n_pulls).toBe(antes.realized_n_pulls)
  })

  it('no reordena las tarjetas', () => {
    // El servidor las manda por edge, y el edge no viaja por este carril: moverlas de sitio cada
    // diez segundos sería puro baile.
    const filas = [fila('a'), fila('b'), fila('c')]
    const vivas = [{ machine: 'c', tiers: [tier()] }, { machine: 'a', tiers: [tier()] }]
    expect(aplicarVivo(filas, vivas).map((f) => f.machine)).toEqual(['a', 'b', 'c'])
  })

  it('una máquina que no llega se queda con lo que tenía', () => {
    // Vaciarle la tabla diría "no hay datos" cuando lo cierto es "no han llegado todavía".
    const [d] = aplicarVivo([fila('pokemon_50')], [{ machine: 'otra', tiers: [] }])
    expect(d.tiers[0].current).toBe(80)
  })

  it('una máquina que solo trae el carril rápido no se cuela en la pantalla', () => {
    // Sin edge no hay tarjeta que pintar; inventarle una fila daría un dial sin medición.
    expect(aplicarVivo([fila('a')], [{ machine: 'nueva', tiers: [tier()] }]).map((f) => f.machine))
      .toEqual(['a'])
  })

  it('no muta las filas originales', () => {
    const filas = [fila('pokemon_50')]
    aplicarVivo(filas, [{ machine: 'pokemon_50', tiers: [tier({ current: 81 })] }])
    expect(filas[0].tiers[0].current).toBe(80)
  })

  it('lo caro va seis veces más lento que lo barato', () => {
    // Medido en mainnet: el bootstrap son ~9 s las 48 máquinas y las rachas ~370 ms.
    expect(LENTO_MS).toBe(60_000)
    expect(RAPIDO_MS).toBe(10_000)
    expect(LENTO_MS / RAPIDO_MS).toBe(6)
  })
})
