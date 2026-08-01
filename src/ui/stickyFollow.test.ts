import { describe, it, expect } from 'vitest'
import { siguienteTop, topeAbajo } from './stickyFollow'

// Panel de 900 en una ventana de 600: no cabe, faltan 300 + los huecos.
const ALTO = 900
const VISTA = 600
const HUECO = 16

describe('stickyFollow', () => {
  it('con un panel que NO cabe, el tope de abajo es negativo', () => {
    // Es lo que permite que el final del panel llegue al fondo de la ventana.
    expect(topeAbajo(ALTO, VISTA, HUECO)).toBe(600 - 900 - 16)
  })

  it('con un panel que cabe, no hay nada que mover', () => {
    expect(topeAbajo(200, VISTA, HUECO)).toBe(HUECO)
    expect(siguienteTop(HUECO, 400, 200, VISTA, HUECO)).toBe(HUECO)
  })

  it('bajando, el panel sube hasta enseñar su final y ahí se queda', () => {
    let top = HUECO
    for (let i = 0; i < 20; i++) top = siguienteTop(top, 50, ALTO, VISTA, HUECO)
    expect(top).toBe(topeAbajo(ALTO, VISTA, HUECO))
  })

  it('no se pasa del tope de abajo por mucho que se baje', () => {
    expect(siguienteTop(HUECO, 99_999, ALTO, VISTA, HUECO)).toBe(topeAbajo(ALTO, VISTA, HUECO))
  })

  it('subiendo reacciona al primer gesto, no al llegar arriba', () => {
    const abajo = topeAbajo(ALTO, VISTA, HUECO)
    // Un scroll mínimo hacia arriba ya mueve el panel.
    expect(siguienteTop(abajo, -1, ALTO, VISTA, HUECO)).toBe(abajo + 1)
    expect(siguienteTop(abajo, -120, ALTO, VISTA, HUECO)).toBe(abajo + 120)
  })

  it('no se pasa del tope de arriba por mucho que se suba', () => {
    expect(siguienteTop(-500, -99_999, ALTO, VISTA, HUECO)).toBe(HUECO)
  })

  it('el movimiento es proporcional al scroll', () => {
    // Ni salta ni se acelera: lo que se desplaza la página se desplaza el panel, al revés.
    expect(siguienteTop(-100, 30, ALTO, VISTA, HUECO)).toBe(-130)
    expect(siguienteTop(-100, -30, ALTO, VISTA, HUECO)).toBe(-70)
  })

  it('cambiar de dirección no da saltos: se sigue desde donde estaba', () => {
    let top = siguienteTop(HUECO, 200, ALTO, VISTA, HUECO)      // bajando
    expect(top).toBe(HUECO - 200)
    top = siguienteTop(top, -50, ALTO, VISTA, HUECO)            // y ahora subiendo
    expect(top).toBe(HUECO - 150)
  })

  it('un scroll de cero no mueve nada', () => {
    expect(siguienteTop(-42, 0, ALTO, VISTA, HUECO)).toBe(-42)
  })
})
