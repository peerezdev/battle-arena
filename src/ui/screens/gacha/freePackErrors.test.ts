import { describe, it, expect } from 'vitest'
import { mensajeDeCanje } from './freePackErrors'
import { GachaDisabledError, GachaHttpError } from '../../../onchain/gachaClient'

describe('mensajeDeCanje', () => {
  it('dice cuántos puntos faltan, con la cifra del servidor', () => {
    const m = mensajeDeCanje(new GachaHttpError(409, 'not_enough_points:7611'))
    expect(m).toBe('You need 7,611 more points for a free pack here.')
  })

  it.each([
    ['machine_no_free_spins', /does not offer free packs/i],
    ['machine_out_of_cards', /ran out of cards/i],
    ['gacha_disabled', /gacha is closed/i],
    ['signer_unavailable', /unavailable right now/i],
    ['upstream_error', /Collector Crypt could not process/i],
  ])('traduce %s a un mensaje escrito por nosotros', (codigo, espera) => {
    expect(mensajeDeCanje(new GachaHttpError(409, codigo))).toMatch(espera)
  })

  it('NUNCA enseña el texto crudo que venga del backend', () => {
    // El caso real: CC cambió su contrato y el jugador leía su error, en su vocabulario.
    const m = mensajeDeCanje(new GachaHttpError(502, 'Missing or invalid nonce'))
    expect(m).not.toMatch(/nonce/i)
    expect(m).toMatch(/try again/i)
  })

  it('un código desconocido cae en el mensaje del estado HTTP, no en el silencio', () => {
    expect(mensajeDeCanje(new GachaHttpError(401, 'lo_que_sea'))).toMatch(/Log in again/i)
    expect(mensajeDeCanje(new GachaHttpError(429, 'lo_que_sea'))).toMatch(/Too many spins/i)
    expect(mensajeDeCanje(new GachaHttpError(418, 'lo_que_sea'))).toMatch(/Could not claim/i)
  })

  it('el kill-switch del gacha tiene su propio mensaje', () => {
    expect(mensajeDeCanje(new GachaDisabledError())).toMatch(/gacha is closed/i)
  })

  it('un fallo que no sea del backend tampoco deja al jugador sin mensaje', () => {
    expect(mensajeDeCanje(new TypeError('Failed to fetch'))).toMatch(/Could not claim/i)
    expect(mensajeDeCanje('vete a saber')).toMatch(/Could not claim/i)
  })
})
