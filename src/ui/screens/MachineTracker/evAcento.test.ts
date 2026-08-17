import { describe, it, expect } from 'vitest'
import { RARITY } from '../../theme'
import { ACENTO, acentoDe, afirma, colorRareza, fondoFila } from './evAcento'

describe('el acento de una tarjeta', () => {
  it('confirmado a favor va en verde, confirmado en contra en rosa', () => {
    expect(acentoDe('confirmado_pos')).toBe(ACENTO.bueno)
    expect(acentoDe('confirmado_neg')).toBe(ACENTO.malo)
  })

  it('los TRES estados de "no se puede concluir" van igual, en ámbar', () => {
    // Pintarlos distinto sugeriría que unos están más cerca de una conclusión que otros, y no lo
    // están: se distinguen por su texto, no por su color.
    expect(acentoDe('sin_concluir')).toBe(ACENTO.dudoso)
    expect(acentoDe('construyendo')).toBe(ACENTO.dudoso)
    expect(acentoDe('con_hueco')).toBe(ACENTO.dudoso)
  })

  it('sin muestra, gris', () => {
    expect(acentoDe('sin_muestra')).toBe(ACENTO.sinDatos)
  })

  it('el verde y el rosa NO se usan sin veredicto confirmado', () => {
    // Es la regla que sostiene toda la pantalla: el color no puede afirmar lo que los datos no
    // dicen. Un rosa fuerte sobre seis horas de datos sentencia una máquina sin pruebas.
    for (const e of ['sin_concluir', 'construyendo', 'con_hueco', 'sin_muestra'] as const) {
      expect(acentoDe(e)).not.toBe(ACENTO.bueno)
      expect(acentoDe(e)).not.toBe(ACENTO.malo)
    }
  })

  it('solo un veredicto confirmado AFIRMA', () => {
    expect(afirma('confirmado_pos')).toBe(true)
    expect(afirma('confirmado_neg')).toBe(true)
    for (const e of ['sin_concluir', 'construyendo', 'con_hueco', 'sin_muestra'] as const) {
      expect(afirma(e)).toBe(false)
    }
  })

  it('el rosa no es el rojo del tema', () => {
    // El rojo está reservado a pérdida y eliminación en las batallas. Esto no es una derrota, es
    // una medición, y usar el mismo rojo mezclaría dos cosas que no se parecen.
    expect(ACENTO.malo).not.toBe('#ff5e7a')
  })
})

describe('los colores de rareza', () => {
  it('son los del TEMA, no unos propios del tracker', () => {
    // La misma rareza tiene que verse igual aquí, en el feed de ganadores y en el reveal. Un Epic
    // violeta en una pantalla y dorado en otra obliga a reaprender la leyenda en cada sitio.
    expect(colorRareza('Uncommon')).toBe(RARITY.uncommon)
    expect(colorRareza('Rare')).toBe(RARITY.rare)
    expect(colorRareza('Epic')).toBe(RARITY.epic)
    expect(colorRareza('Common')).toBe(RARITY.common)
  })

  it('da igual cómo venga escrito', () => {
    expect(colorRareza('epic')).toBe(RARITY.epic)
    expect(colorRareza('EPIC')).toBe(RARITY.epic)
  })

  it('una rareza desconocida no revienta ni se pinta de un color de verdad', () => {
    expect(colorRareza('Mítica')).toBe(ACENTO.sinDatos)
  })

  it('el fondo de la fila sale del color de su rareza y se desvanece', () => {
    // Es lo que permite recorrer la columna de rarezas sin leerla.
    const f = fondoFila('Epic')
    expect(f).toContain(RARITY.epic)
    expect(f).toContain('transparent')
  })
})
