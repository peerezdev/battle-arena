import { describe, it, expect } from 'vitest'
import { siguienteLobby } from './siguienteLobby'
import type { OpenBattle } from '../../../onchain/packBattleClient'

const sala = (over: Partial<OpenBattle> = {}): OpenBattle => ({
  id: 'b', mode: 'pack', machine_code: 'pokemon_50', price: 50_000_000, buyin: 50_000_000,
  max_players: 4, players: 1, creator_wallet: 'OTRO', player_wallets: ['OTRO'], ...over,
} as OpenBattle)

describe('la siguiente sala a la que entrar', () => {
  it('la que está más CERCA de arrancar', () => {
    // Menos plazas libres = antes empieza, y eso es lo que busca quien quiere jugar ya.
    const r = siguienteLobby([
      sala({ id: 'lejos', players: 1, max_players: 4 }),
      sala({ id: 'cerca', players: 3, max_players: 4 }),
    ], { mode: 'pack' })
    expect(r?.id).toBe('cerca')
  })

  it('a igualdad de plazas, la sala más grande', () => {
    // Donde hay más en juego.
    const r = siguienteLobby([
      sala({ id: 'peque', players: 1, max_players: 2 }),
      sala({ id: 'grande', players: 9, max_players: 10 }),
    ], { mode: 'pack' })
    expect(r?.id).toBe('grande')
  })

  it('nunca una llena', () => {
    expect(siguienteLobby([sala({ players: 4, max_players: 4 })], { mode: 'pack' })).toBeNull()
  })

  it('nunca una en la que ya estoy sentado', () => {
    // Recomendarle entrar donde ya está es un callejón sin salida.
    const salas = [sala({ id: 'mia', player_wallets: ['ME', 'OTRO'], players: 2 })]
    expect(siguienteLobby(salas, { mode: 'pack', meWallet: 'ME' })).toBeNull()
    // Sin wallet no se puede saber, así que no se descarta nada.
    expect(siguienteLobby(salas, { mode: 'pack' })?.id).toBe('mia')
  })

  it('nunca la partida que se acaba de jugar', () => {
    // En el resultado de una batalla, recomendar volver a la misma no ofrece nada nuevo.
    const salas = [sala({ id: 'esta' })]
    expect(siguienteLobby(salas, { mode: 'pack', excluirId: 'esta' })).toBeNull()
  })

  it('solo del modo pedido', () => {
    const salas = [sala({ id: 'r', mode: 'royale' }), sala({ id: 'p', mode: 'pack' })]
    expect(siguienteLobby(salas, { mode: 'royale' })?.id).toBe('r')
    expect(siguienteLobby(salas, { mode: 'pack' })?.id).toBe('p')
  })

  it('sin nada abierto, null y no una excepción', () => {
    expect(siguienteLobby([], { mode: 'pack' })).toBeNull()
  })

  it('no reordena la lista que recibe', () => {
    // Es la misma lista que pinta la pantalla: ordenarla aquí le cambiaría el orden de las cards.
    const salas = [sala({ id: 'a', players: 1 }), sala({ id: 'b', players: 3 })]
    siguienteLobby(salas, { mode: 'pack' })
    expect(salas.map((s) => s.id)).toEqual(['a', 'b'])
  })
})
