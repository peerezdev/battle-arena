import { describe, it, expect, vi } from 'vitest'
import { enTanda } from './tanda'
import { etiquetaTanda } from './GachaPackTilt'

/** Una tarea que no resuelve hasta que se le dice. Sirve para comprobar que EMPEZARON todas antes
 *  de que terminara ninguna, que es la diferencia entre paralelo y una fila rápida. */
function controlada<T>() {
  let soltar!: (v: T) => void
  const p = new Promise<T>((r) => { soltar = r })
  return { p, soltar }
}

describe('una tanda de sobres', () => {
  it('las lanza TODAS antes de que termine ninguna', async () => {
    // Es el test que de verdad distingue paralelo de secuencial: si fueran en fila, la segunda no
    // habría empezado mientras la primera sigue sin resolver.
    const puertas = [controlada<number>(), controlada<number>(), controlada<number>()]
    const empezadas: number[] = []
    const promesa = enTanda(3, (i) => { empezadas.push(i); return puertas[i].p })

    await Promise.resolve()
    expect(empezadas).toEqual([0, 1, 2])       // las tres en vuelo, ninguna resuelta

    puertas.forEach((p, i) => p.soltar(i))
    expect((await promesa).ok).toEqual([0, 1, 2])
  })

  it('una que falla NO corta las demás', async () => {
    // El usuario pidió diez; que el tercero falle no es motivo para dejarle sin el séptimo.
    const r = await enTanda(4, async (i) => {
      if (i === 1) throw new Error('CC dijo que no')
      return i
    })
    expect(r.ok).toEqual([0, 2, 3])
    expect(r.fallos).toBe(1)
    expect(r.error).toBe('CC dijo que no')
  })

  it('conserva el orden en que se pidieron, no en el que respondieron', async () => {
    // Si no, la misma tanda se revelaría en un orden distinto cada vez.
    const r = await enTanda(3, async (i) => {
      await new Promise((res) => setTimeout(res, [30, 0, 15][i]))
      return i
    })
    expect(r.ok).toEqual([0, 1, 2])
  })

  it('el avance cuenta cuántas van, no cuál acaba', async () => {
    // En paralelo terminan en cualquier orden, así que un índice se leería como una posición en
    // una cola que ya no existe.
    const avances: number[] = []
    await enTanda(3, async (i) => {
      await new Promise((res) => setTimeout(res, [20, 0, 10][i]))
      return i
    }, (n) => avances.push(n))
    expect(avances).toEqual([1, 2, 3])
  })

  it('un null es un fallo silencioso, no un resultado', async () => {
    // Es el caso del sobre que sigue `pending` tras agotar el sondeo: no hay carta que enseñar.
    const r = await enTanda(3, async (i) => (i === 0 ? null : i))
    expect(r.ok).toEqual([1, 2])
    expect(r.fallos).toBe(1)
    expect(r.error).toBeNull()          // no hubo excepción, solo no llegó
  })

  it('si fallan todas, se queda el motivo para poder decirlo', async () => {
    const r = await enTanda(2, async () => { throw new Error('sin saldo') })
    expect(r.ok).toEqual([])
    expect(r.error).toBe('sin saldo')
  })

  it('una tanda de cero no llama a nadie', async () => {
    const tarea = vi.fn()
    expect((await enTanda(0, tarea)).ok).toEqual([])
    expect(tarea).not.toHaveBeenCalled()
  })
})

describe('lo que se lee mientras avanza', () => {
  it('cada fase dice lo suyo', () => {
    // Antes las tres compartían texto, así que el contador llegaba a 10, empezaba la fase
    // siguiente y volvía a 1: parecía reiniciarse.
    expect(etiquetaTanda('firmando', 3, 10)).toBe('Buying packs… 3/10')
    expect(etiquetaTanda('abriendo', 3, 10)).toBe('Revealing… 3/10')
  })

  it('un solo sobre no lleva contador', () => {
    expect(etiquetaTanda('firmando', 0, 1)).toBe('Buying pack…')
    expect(etiquetaTanda('abriendo', 0, 1)).toBe('Revealing…')
  })

  it('no se pasa del total', () => {
    expect(etiquetaTanda('abriendo', 12, 10)).toBe('Revealing… 10/10')
  })
})
