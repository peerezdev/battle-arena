import { describe, it, expect } from 'vitest'
import { tipAlertFor } from './tipAlert'

describe('tipAlertFor', () => {
  it('dice quién y cuánto', () => {
    expect(tipAlertFor({ type: 'tip', from: 'W1', fromName: 'Ana', amount: 1.5 }))
      .toBe('Ana sent you 1.50 USDC')
  })

  it('no se come los decimales de una cantidad rara', () => {
    // El backend manda unidades base entre un millón, así que puede traer hasta 6 decimales.
    // Redondear a 2 a secas convertiría 0.001 en "0.00 USDC", que es decir que no ha llegado nada.
    expect(tipAlertFor({ type: 'tip', from: 'W1', fromName: 'Ana', amount: 0.001 }))
      .toBe('Ana sent you 0.001 USDC')
  })

  it('ignora los marcos que no son propinas', () => {
    // Por aquí pasa TODO el socket: chat, drops, presencia, emotes.
    expect(tipAlertFor({ type: 'message', user: 'Ana', text: 'hola' })).toBeNull()
    expect(tipAlertFor({ type: 'presence', online: 3 })).toBeNull()
    expect(tipAlertFor(null)).toBeNull()
    expect(tipAlertFor('tip')).toBeNull()
    // Con fromName y amount válidos pero type distinto: si no se mirara el type, esto colaría.
    expect(tipAlertFor({ type: 'drop', fromName: 'Ana', amount: 1.5 })).toBeNull()
  })

  it('un marco de propina incompleto no saca un aviso a medias', () => {
    // Mejor ningún aviso que "undefined sent you NaN USDC".
    expect(tipAlertFor({ type: 'tip', from: 'W1', amount: 2 })).toBeNull()          // sin nombre
    expect(tipAlertFor({ type: 'tip', from: 'W1', fromName: 'Ana' })).toBeNull()    // sin cantidad
    expect(tipAlertFor({ type: 'tip', from: 'W1', fromName: 'Ana', amount: 0 })).toBeNull()
    expect(tipAlertFor({ type: 'tip', from: 'W1', fromName: 'Ana', amount: -5 })).toBeNull()
    expect(tipAlertFor({ type: 'tip', from: 'W1', fromName: 'Ana', amount: '2' })).toBeNull()
  })
})
