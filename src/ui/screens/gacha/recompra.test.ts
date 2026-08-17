import { describe, it, expect } from 'vitest'
import { recompraDe, recompraMostrada } from './recompra'
import type { GachaMachine } from '../../../onchain/gachaClient'

const maq = (code: string, instantBuyback: number | null): GachaMachine =>
  ({ code, name: code, price: 50, odds: {}, stock: {}, ev: null, image: null,
     instantBuyback } as GachaMachine)

const LISTA = [maq('pokemon_250', 90), maq('pokemon_50', 85)]

describe('qué recompra se enseña', () => {
  it('la de la TIRADA manda sobre la de la máquina abierta', () => {
    // El fallo exacto: un replay de una máquina al 90% se veía al 85% porque en la vault había
    // abierta una del 85%. Invertir este orden lo reproduce.
    expect(recompraMostrada(90, 85)).toBe(90)
  })

  it('la máquina abierta solo entra si la tirada no trae nada', () => {
    // Es el caso normal: tirar desde su propia máquina, donde las dos coinciden igualmente.
    expect(recompraMostrada(null, 85)).toBe(85)
    expect(recompraMostrada(undefined, 85)).toBe(85)
  })

  it('sin ninguna de las dos, no se inventa', () => {
    expect(recompraMostrada(null, null)).toBeNull()
    expect(recompraMostrada(undefined, undefined)).toBeNull()
  })

  it('un 0 de la tirada NO se confunde con "no hay dato"', () => {
    // Una máquina sin recompra es un dato: cero. Con `||` en vez de `??` habría caído al respaldo
    // y habría enseñado el porcentaje de otra máquina.
    expect(recompraMostrada(0, 85)).toBe(0)
  })
})

describe('la recompra de una máquina por su código', () => {
  it('la encuentra', () => {
    expect(recompraDe('pokemon_250', LISTA)).toBe(90)
    expect(recompraDe('pokemon_50', LISTA)).toBe(85)
  })

  it('una máquina que no está en la lista da null, NO la de otra', () => {
    // Es lo que sostiene todo: sin el dato no se enseña recompra, y eso es mejor que enseñar la
    // de la máquina equivocada.
    expect(recompraDe('maquina_retirada', LISTA)).toBeNull()
  })

  it('sin código o sin lista, null', () => {
    expect(recompraDe(null, LISTA)).toBeNull()
    expect(recompraDe('pokemon_250', null)).toBeNull()
    expect(recompraDe('pokemon_250', [])).toBeNull()
  })

  it('una máquina cuyo buyback viene vacío da null y no un cero inventado', () => {
    expect(recompraDe('sin_dato', [maq('sin_dato', null)])).toBeNull()
  })
})
