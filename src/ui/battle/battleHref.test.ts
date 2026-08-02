import { describe, it, expect } from 'vitest'
import { battleHref } from './battleHref'

describe('battleHref', () => {
  it('una partida liquidada abre el RESULTADO', () => {
    // Era el fallo: los botones de "Result" de las listas abrían la partida por el principio,
    // así que el jugador se comía el reveal entero para ver un marcador que ya existía.
    expect(battleHref('b1', { status: 'settled' })).toBe('/play/battle/b1?view=result')
  })

  it('una partida en juego abre el reveal, que es lo que se está viendo', () => {
    expect(battleHref('b1', { status: 'running' })).toBe('/play/battle/b1')
    expect(battleHref('b1', { status: 'lobby' })).toBe('/play/battle/b1')
  })

  it('sin estado no se adivina: al reveal', () => {
    expect(battleHref('b1')).toBe('/play/battle/b1')
  })

  it('se puede forzar el resultado sin saber el estado', () => {
    // Lo que hace el modal de "While you were away": ahí la batalla ya terminó por definición.
    expect(battleHref('b1', { view: 'result' })).toBe('/play/battle/b1?view=result')
  })

  it('se puede forzar el reveal AUNQUE esté liquidada', () => {
    // Es un "Replay": se pide ver la película otra vez, a sabiendas.
    expect(battleHref('b1', { view: 'reveal', status: 'settled' })).toBe('/play/battle/b1')
  })

  it('el id se escapa', () => {
    expect(battleHref('a/b?c', { status: 'settled' })).toBe('/play/battle/a%2Fb%3Fc?view=result')
  })
})
