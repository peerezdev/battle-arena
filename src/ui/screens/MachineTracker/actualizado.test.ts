import { describe, it, expect } from 'vitest'
import { LIMITE_RANCIO_S, estaRancio, horaActualizacion } from './actualizado'

const T = 1_786_900_000          // un instante cualquiera, en segundos

describe('la hora de la última medición', () => {
  it('sale como la leería un reloj', () => {
    const texto = horaActualizacion(T, new Date(T * 1000 + 5_000))
    expect(texto).toMatch(/\d{1,2}:\d{2}:\d{2}/)
  })

  it('sin dato pone un guion, no una hora inventada', () => {
    // El dato existe justo para poder desconfiar: inventarlo lo vuelve inútil.
    const ahora = new Date(T * 1000)
    expect(horaActualizacion(null, ahora)).toBe('—')
    expect(horaActualizacion(0, ahora)).toBe('—')
    expect(horaActualizacion(undefined, ahora)).toBe('—')
  })

  it('una hora del FUTURO también es un guion', () => {
    // Un reloj mal puesto en el servidor daría "actualizado a las 3 de mañana", que se lee como
    // que todo va bien cuando es justo la señal contraria.
    expect(horaActualizacion(T + 3600, new Date(T * 1000))).toBe('—')
  })

  it('unos segundos de desfase NO se toman por futuro', () => {
    // Los relojes del navegador y del servidor nunca coinciden al segundo.
    expect(horaActualizacion(T + 20, new Date(T * 1000))).not.toBe('—')
  })
})

describe('cuándo se da por rancio', () => {
  it('recién calculado no lo está', () => {
    expect(estaRancio(T, T + 30)).toBe(false)
  })

  it('un par de refrescos perdidos tampoco', () => {
    // El carril lento va cada 60 s; dos minutos es tardanza, no avería.
    expect(estaRancio(T, T + 120)).toBe(false)
  })

  it('cinco minutos sí: son cinco refrescos perdidos', () => {
    // Es el aviso que habría delatado en un minuto la ingesta que se quedó muda cinco horas.
    expect(estaRancio(T, T + LIMITE_RANCIO_S + 1)).toBe(true)
  })

  it('sin dato no se acusa a nadie', () => {
    // Ya se enseña un guion; añadir "STALE" sería decir dos cosas distintas del mismo hueco.
    expect(estaRancio(null, T)).toBe(false)
  })

  it('el límite se puede ajustar sin tocar la lógica', () => {
    expect(estaRancio(T, T + 40, 30)).toBe(true)
    expect(estaRancio(T, T + 20, 30)).toBe(false)
  })
})
