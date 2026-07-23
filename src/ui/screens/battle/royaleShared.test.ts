import { describe, it, expect } from 'vitest'
import { shortWallet, tintFor, medalColor, pullTitle } from './royaleShared'

describe('royaleShared', () => {
  it('shortWallet truncates long wallets and leaves short ones', () => {
    expect(shortWallet('ABCDEFGHIJKL')).toBe('ABCD…IJKL')
    expect(shortWallet('short')).toBe('short')
  })

  it('tintFor is deterministic per wallet', () => {
    expect(tintFor('wallet-x')).toBe(tintFor('wallet-x'))
    expect(tintFor('wallet-x')).toMatch(/linear-gradient/)
  })

  it('medalColor returns gold/silver/bronze for the podium', () => {
    expect(medalColor(1)).toBe('#f5c542')
    expect(medalColor(2)).toBe('#c8d0da')
    expect(medalColor(3)).toBe('#e8964e')
  })
})

describe('pullTitle', () => {
  it('usa el nombre real de la carta cuando lo hay', () => {
    expect(pullTitle({ name: 'Charizard VMAX', rarity: 'Epic', insuredValue: 412 })).toBe('Charizard VMAX')
  })

  it('cae a la rareza cuando el nombre es solo el valor repetido', () => {
    // Las tiradas de bot/mock guardan el valor en `name` → "150 · $150" diría lo mismo dos veces.
    expect(pullTitle({ name: '150', rarity: 'Common', insuredValue: 150 })).toBe('Common')
  })

  it('un nombre numérico que NO coincide con el valor sí se muestra', () => {
    expect(pullTitle({ name: '1999', rarity: 'Rare', insuredValue: 80 })).toBe('1999')
  })

  it('sin nombre ni rareza queda "card"', () => {
    expect(pullTitle({ name: null, rarity: null, insuredValue: 20 })).toBe('card')
  })

  it('sin carta no hay etiqueta', () => {
    expect(pullTitle(null)).toBeNull()
  })
})
