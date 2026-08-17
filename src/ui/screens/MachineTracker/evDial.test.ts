import { describe, it, expect } from 'vitest'
import { RATIO_MAX, RATIO_MIN, anguloAguja, esConcluyente, estadoDe, etiqueta, ratioDesdeEdge }
  from './evDial'

const fila = (over = {}) => ({
  hours_covered: 48, realized_window_hours: 48, realized_n_pulls: 16157,
  pulls_to_conclude: null as number | null, ...over,
})

describe('la aguja', () => {
  it('1.00 queda justo arriba', () => {
    // Es lo que hace el dial legible: la referencia está en el centro del arco, no en un extremo.
    expect(anguloAguja(1)).toBe(0)
  })

  it('los extremos son ±90 grados', () => {
    expect(anguloAguja(RATIO_MIN)).toBe(-90)
    expect(anguloAguja(RATIO_MAX)).toBe(90)
  })

  it('un ratio fuera de escala se queda en el tope, no se sale del arco', () => {
    // Un pack que pagara el triple dibujaría la aguja fuera del dibujo.
    expect(anguloAguja(3)).toBe(90)
    expect(anguloAguja(0.1)).toBe(-90)
  })

  it('paga menos de lo que cuesta, aguja a la izquierda', () => {
    expect(anguloAguja(0.952)).toBeLessThan(0)
  })
})

describe('ratio medido', () => {
  it('sale del edge', () => {
    expect(ratioDesdeEdge(-4.8)).toBeCloseTo(0.952, 5)
    expect(ratioDesdeEdge(0)).toBe(1)
  })

  it('sin medición no hay ratio', () => {
    // Devolver 1 sería peor que devolver nada: se leería como "paga justo".
    expect(ratioDesdeEdge(null)).toBeNull()
  })
})

describe('estados', () => {
  it('cada veredicto del backend tiene su estado', () => {
    expect(estadoDe('CONFIDENT -EV')).toBe('confirmado_neg')
    expect(estadoDe('CONFIDENT +EV')).toBe('confirmado_pos')
    expect(estadoDe('BUILDING')).toBe('construyendo')
    expect(estadoDe('GAP IN WINDOW')).toBe('con_hueco')
    expect(estadoDe('NOT ENOUGH DATA')).toBe('sin_muestra')
    expect(estadoDe('unclear (CI crosses zero)')).toBe('sin_concluir')
  })

  it('un veredicto desconocido no se toma por bueno', () => {
    // Si el backend añadiera un estado nuevo, tratarlo como concluyente afirmaría algo sin base.
    expect(esConcluyente(estadoDe('ALGO_NUEVO'))).toBe(false)
    expect(esConcluyente(estadoDe(null))).toBe(false)
  })

  it('solo los dos confirmados son concluyentes', () => {
    expect(esConcluyente('confirmado_neg')).toBe(true)
    expect(esConcluyente('confirmado_pos')).toBe(true)
    for (const e of ['sin_concluir', 'construyendo', 'con_hueco', 'sin_muestra'] as const) {
      expect(esConcluyente(e)).toBe(false)
    }
  })
})

describe('la etiqueta del veredicto', () => {
  it('las tres formas de no concluir dicen cosas DISTINTAS', () => {
    // Para quien mira no es lo mismo llevar poco midiendo, haber perdido un trozo, o que la
    // máquina no se juegue. Colapsarlas en un "unclear" genérico borra la información útil.
    const textos = (['construyendo', 'con_hueco', 'sin_muestra'] as const)
      .map((e) => etiqueta(e, fila({ hours_covered: 6, realized_n_pulls: 12 })).texto)
    expect(new Set(textos).size).toBe(3)
  })

  it('construyendo dice cuánto lleva', () => {
    const l = etiqueta('construyendo', fila({ hours_covered: 6 }))
    expect(l.texto).toContain('6h / 48h')
    expect(l.detalle).toMatch(/until the window is full/i)
  })

  it('sin concluir ofrece cuánta muestra faltaría', () => {
    // Es lo único accionable de esa tarjeta; sin ello solo dice "no sé".
    expect(etiqueta('sin_concluir', fila({ pulls_to_conclude: 1400 })).detalle).toContain('1,400')
  })

  it('sin concluir y sin estimación no inventa un número', () => {
    expect(etiqueta('sin_concluir', fila()).detalle).toBeNull()
  })

  it('los confirmados no llevan explicación', () => {
    // El número ya lo dice todo; una coletilla ahí sería ruido.
    expect(etiqueta('confirmado_neg', fila()).detalle).toBeNull()
  })
})
