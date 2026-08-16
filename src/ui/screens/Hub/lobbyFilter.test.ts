import { describe, it, expect } from 'vitest'
import { alternar, conModos, etiquetaModos, leerModos, paramModos } from './lobbyFilter'

const S = (...m: Array<'pack' | 'royale'>) => new Set(m)

describe('los modos de Live games', () => {
  it('por defecto están los DOS marcados', () => {
    // Es lo que da sentido a juntarlas: si arrancara filtrado, seguiríamos partiendo la lista y
    // cada mitad parecería un lobby vacío.
    expect(leerModos('')).toEqual(S('pack', 'royale'))
  })

  it('la URL puede traer uno solo', () => {
    // Es lo que hace que /play/royale siga funcionando: redirige aquí con su casilla puesta.
    expect(leerModos('?mode=royale')).toEqual(S('royale'))
    expect(leerModos('?mode=pack')).toEqual(S('pack'))
  })

  it('la URL puede traer los dos', () => {
    expect(leerModos('?mode=pack,royale')).toEqual(S('pack', 'royale'))
  })

  it('un modo inventado NO deja el lobby vacío', () => {
    // Caer a "todos" es lo que menos daño hace: una URL mal copiada no puede hacer creer que no
    // hay partidas.
    expect(leerModos('?mode=ajedrez')).toEqual(S('pack', 'royale'))
  })

  it('con los dos marcados la URL va limpia', () => {
    expect(paramModos(S('pack', 'royale'))).toEqual({})
  })

  it('con uno marcado la URL lo dice, para poder enlazarlo', () => {
    expect(paramModos(S('royale'))).toEqual({ mode: 'royale' })
  })

  it('sin ninguno la URL TAMBIÉN lo dice', () => {
    // Si no, recargar devolvería los dos y el usuario vería reaparecer lo que acababa de apagar.
    expect(paramModos(S())).toEqual({ mode: 'none' })
    expect(leerModos('?mode=none').size).toBe(0)
  })

  it('alternar enciende, apaga y no toca el original', () => {
    const a = S('pack')
    expect(alternar(a, 'royale')).toEqual(S('pack', 'royale'))
    expect(alternar(a, 'pack')).toEqual(S())
    expect(a).toEqual(S('pack'))
  })

  it('se pueden apagar los DOS', () => {
    // Bloquear la última casilla deja al usuario peleándose con un control que no le obedece. Lo
    // que hay que hacer es explicar la lista vacía, no impedir llegar a ella.
    expect(alternar(S('pack'), 'pack').size).toBe(0)
  })

  it('el botón dice "All games" con los dos, y el nombre con uno', () => {
    expect(etiquetaModos(S('pack', 'royale'))).toBe('All games')
    expect(etiquetaModos(S('royale'))).toBe('Battle Royale')
    expect(etiquetaModos(S('pack'))).toBe('Pack Battle')
    expect(etiquetaModos(S())).toBe('No modes')
  })

  it('filtra las partidas por modo', () => {
    const filas = [{ mode: 'pack' as const }, { mode: 'royale' as const }, { mode: 'pack' as const }]
    expect(conModos(filas, S('pack'))).toHaveLength(2)
    expect(conModos(filas, S('pack', 'royale'))).toHaveLength(3)
    expect(conModos(filas, S())).toHaveLength(0)
  })
})
