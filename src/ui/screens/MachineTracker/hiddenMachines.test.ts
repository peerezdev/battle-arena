import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { alternar, guardarOcultas, leerOcultas, visibles } from './hiddenMachines'

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('preferencia de máquinas ocultas', () => {
  it('sin nada guardado no hay ninguna oculta', () => {
    expect(leerOcultas().size).toBe(0)
  })

  it('lo guardado se recupera', () => {
    guardarOcultas(new Set(['pokemon_50', 'anime_75']))
    expect([...leerOcultas()].sort()).toEqual(['anime_75', 'pokemon_50'])
  })

  it('una máquina NUEVA se ve por defecto', () => {
    // La razón de guardar las ocultas y no las visibles: con la lista de visibles, cada máquina
    // que añadiera Collector Crypt nacería invisible para quien ya tuviera preferencia guardada.
    guardarOcultas(new Set(['anime_75']))
    const filas = [{ machine: 'anime_75' }, { machine: 'recien_llegada' }]
    expect(visibles(filas, leerOcultas())).toEqual([{ machine: 'recien_llegada' }])
  })

  it('alternar añade y quita sin tocar el original', () => {
    const a = new Set(['x'])
    const b = alternar(a, 'y')
    expect([...b].sort()).toEqual(['x', 'y'])
    expect([...alternar(b, 'x')]).toEqual(['y'])
    expect([...a]).toEqual(['x'])          // el conjunto de entrada no se muta
  })

  it('visibles conserva el orden del servidor', () => {
    // El servidor ordena por edge; reordenar aquí desharía esa decisión sin que nadie lo pidiera.
    const filas = [{ machine: 'a' }, { machine: 'b' }, { machine: 'c' }]
    expect(visibles(filas, new Set(['b'])).map((f) => f.machine)).toEqual(['a', 'c'])
  })

  it('un valor corrupto no rompe la pantalla', () => {
    localStorage.setItem('ba.evTracker.hiddenMachines', 'esto no es json')
    expect(leerOcultas().size).toBe(0)
  })

  it('un valor con la forma equivocada tampoco', () => {
    localStorage.setItem('ba.evTracker.hiddenMachines', '{"no":"es un array"}')
    expect(leerOcultas().size).toBe(0)
    localStorage.setItem('ba.evTracker.hiddenMachines', '[1,null,"buena",""]')
    expect([...leerOcultas()]).toEqual(['buena'])   // se queda con lo utilizable
  })

  it('sin localStorage disponible no revienta', () => {
    // Safari en privado lanza al escribir. Perder una preferencia es aceptable; romper la página no.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denegado') })
    expect(() => guardarOcultas(new Set(['x']))).not.toThrow()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denegado') })
    expect(leerOcultas().size).toBe(0)
  })

  it('se guarda ordenado, para que el valor no dependa del orden de pulsación', () => {
    guardarOcultas(new Set(['z', 'a', 'm']))
    expect(localStorage.getItem('ba.evTracker.hiddenMachines')).toBe('["a","m","z"]')
  })
})
