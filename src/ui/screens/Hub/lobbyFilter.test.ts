import { describe, it, expect } from 'vitest'
import { hrefFiltro, leerFiltro, muestra } from './lobbyFilter'

describe('el filtro del Lobby', () => {
  it('por defecto enseña TODO', () => {
    // Es la decisión que da sentido a la fusión: si arrancara filtrado, seguiríamos partiendo la
    // liquidez en dos y cada mitad parecería vacía.
    expect(leerFiltro('')).toBe('all')
    expect(leerFiltro('?otra=cosa')).toBe('all')
  })

  it('lee el modo de la URL', () => {
    expect(leerFiltro('?mode=pack')).toBe('pack')
    expect(leerFiltro('?mode=royale')).toBe('royale')
  })

  it('un modo inventado cae en "todo" y no rompe la pantalla', () => {
    expect(leerFiltro('?mode=ajedrez')).toBe('all')
  })

  it('vive en la URL para poder enlazarlo y volver a él', () => {
    // Sin esto, el botón de atrás perdería el filtro y no se podría compartir "mira las royale".
    expect(hrefFiltro('royale')).toBe('/play/lobby?mode=royale')
    expect(hrefFiltro('pack')).toBe('/play/lobby?mode=pack')
  })

  it('"todo" va sin parámetro, que es el estado limpio', () => {
    expect(hrefFiltro('all')).toBe('/play/lobby')
  })

  it('con "todo" se ven los dos modos', () => {
    expect(muestra('all', 'pack')).toBe(true)
    expect(muestra('all', 'royale')).toBe(true)
  })

  it('filtrado se ve solo el suyo', () => {
    expect(muestra('pack', 'pack')).toBe(true)
    expect(muestra('pack', 'royale')).toBe(false)
    expect(muestra('royale', 'pack')).toBe(false)
  })
})
