import { describe, it, expect } from 'vitest'
import { keyboardInset } from './useKeyboardInset'

describe('keyboardInset', () => {
  it('con el teclado abierto devuelve lo que tapa', () => {
    // Pantalla de 800, viewport visual de 500 → el teclado ocupa 300.
    expect(keyboardInset(800, { height: 500, offsetTop: 0 })).toBe(300)
  })

  it('descuenta el desplazamiento del viewport visual', () => {
    // iOS desplaza el viewport al enfocar; sin restar offsetTop, el hueco se contaría dos veces
    // y el chat subiría de más.
    expect(keyboardInset(800, { height: 500, offsetTop: 120 })).toBe(180)
  })

  it('con el teclado cerrado es 0', () => {
    expect(keyboardInset(800, { height: 800, offsetTop: 0 })).toBe(0)
  })

  it('nunca es negativo', () => {
    // Pasa mientras el navegador reajusta: un valor negativo hundiría el chat fuera de pantalla.
    expect(keyboardInset(800, { height: 900, offsetTop: 0 })).toBe(0)
  })

  it('sin visualViewport no se mueve nada', () => {
    // Navegador que no lo soporta: mejor dejarlo quieto que colocarlo mal.
    expect(keyboardInset(800, null)).toBe(0)
    expect(keyboardInset(800, undefined)).toBe(0)
  })

  it('redondea, que un bottom con decimales provoca bordes borrosos', () => {
    expect(keyboardInset(800, { height: 500.4, offsetTop: 0 })).toBe(300)
  })
})
