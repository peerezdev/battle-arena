import { describe, it, expect } from 'vitest'
import { tiradasGratis } from './freeSpins'

describe('tiradasGratis', () => {
  it('cuesta más cuanto más cara es la máquina', () => {
    expect(tiradasGratis(50, 0).required).toBe(100_000)
    expect(tiradasGratis(250, 0).required).toBe(500_000)
    expect(tiradasGratis(5000, 0).required).toBe(10_000_000)
  })

  it('los mismos puntos dan tirada en la barata y no en la cara', () => {
    // El caso que motivó el cambio: se anunciaban 3 tiradas en TODAS las máquinas.
    const puntos = 364_060
    expect(tiradasGratis(50, puntos).count).toBe(3)
    expect(tiradasGratis(250, puntos).count).toBe(0)
    expect(tiradasGratis(5000, puntos).count).toBe(0)
  })

  it('coincide con lo que responde Collector Crypt para la máquina base', () => {
    // Medido contra /api/freeSpins con una wallet real de 364.060 puntos:
    // freeSpinsLeft = 3, pointsUntilNextSpin = 35.940.
    const r = tiradasGratis(50, 364_060)
    expect(r.count).toBe(3)
    expect(r.untilNext).toBe(35_940)
  })

  it('sin puntos falta una tirada entera, no cero', () => {
    // 0 % required es 0, así que un `required - resto` a secas diría "no te falta nada".
    expect(tiradasGratis(50, 0)).toEqual({ required: 100_000, count: 0, untilNext: 100_000 })
    expect(tiradasGratis(250, 0).untilNext).toBe(500_000)
  })

  it('con el saldo justo no falta nada', () => {
    expect(tiradasGratis(50, 100_000)).toEqual({ required: 100_000, count: 1, untilNext: 0 })
    expect(tiradasGratis(50, 200_000)).toEqual({ required: 100_000, count: 2, untilNext: 0 })
  })

  it('no cuenta puntos negativos ni fracciones', () => {
    expect(tiradasGratis(50, -5).count).toBe(0)
    expect(tiradasGratis(50, -5).untilNext).toBe(100_000)
    expect(tiradasGratis(50, 100_000.9).count).toBe(1)
  })

  it('un precio ausente cae al base en vez de dividir por cero', () => {
    expect(tiradasGratis(0, 100_000)).toEqual({ required: 100_000, count: 1, untilNext: 0 })
  })
})
