import { describe, it, expect } from 'vitest'
import { battleAlertFor } from './battleAlerts'

const ME = 'meWALLET'
const OTHER = 'otherWALLET'
const ELSEWHERE = '/home'
const join = (over: Record<string, unknown> = {}) =>
  ({ type: 'battle_join', battle_id: 'b1', players: [ME, OTHER], joiner: OTHER, joiner_name: 'Bob', ...over })
const start = (over: Record<string, unknown> = {}) =>
  ({ type: 'battle_start', battle_id: 'b1', players: [ME, OTHER], ...over })

describe('battleAlertFor', () => {
  it('ignora eventos que no son de batalla', () => {
    expect(battleAlertFor({ type: 'chat', battle_id: 'b1', players: [ME] }, ME, ELSEWHERE)).toBeNull()
    expect(battleAlertFor({ type: 'rematch', players: [ME] }, ME, ELSEWHERE)).toBeNull()
  })

  it('sin wallet no avisa (no sé si soy participante)', () => {
    expect(battleAlertFor(join(), null, ELSEWHERE)).toBeNull()
  })

  it('battle_join: alguien entra a MI lobby → toast con su nombre y View lobby', () => {
    const a = battleAlertFor(join(), ME, ELSEWHERE)
    expect(a).toEqual({ kind: 'join', message: 'Bob joined your lobby', actionLabel: 'View lobby', battleId: 'b1' })
  })

  it('battle_join sin nombre cae a "A player"', () => {
    expect(battleAlertFor(join({ joiner_name: undefined }), ME, ELSEWHERE)?.message).toBe('A player joined your lobby')
  })

  it('mi propia unión no me avisa', () => {
    expect(battleAlertFor(join({ joiner: ME }), ME, ELSEWHERE)).toBeNull()
  })

  it('un join de un lobby en el que NO estoy no me avisa', () => {
    expect(battleAlertFor(join({ players: [OTHER, 'X'] }), ME, ELSEWHERE)).toBeNull()
  })

  it('battle_start: mi partida se llena → toast de arranque con View battle', () => {
    expect(battleAlertFor(start(), ME, ELSEWHERE)).toEqual({
      kind: 'start', message: 'Your battle is starting', actionLabel: 'View battle', battleId: 'b1',
    })
  })

  it('un arranque de una partida en la que NO estoy no me avisa', () => {
    expect(battleAlertFor(start({ players: [OTHER] }), ME, ELSEWHERE)).toBeNull()
  })

  it('si ya estoy viendo esa batalla, no hay toast (lo veo en vivo)', () => {
    const viewing = '/play/battle/b1'
    expect(battleAlertFor(join(), ME, viewing)).toBeNull()
    expect(battleAlertFor(start(), ME, viewing)).toBeNull()
    // pero viendo OTRA batalla sí avisa
    expect(battleAlertFor(start(), ME, '/play/battle/otra')).not.toBeNull()
  })

  it('la ruta de resultado (?view=result) también cuenta como "viéndola"', () => {
    expect(battleAlertFor(start(), ME, '/play/battle/b1')).toBeNull()
  })
})
