import { describe, expect, it } from 'vitest'
import { holdBalance, isBalanceHeld } from './balanceHold'

describe('balanceHold', () => {
  it('no está congelado por defecto', () => {
    expect(isBalanceHeld()).toBe(false)
  })

  it('congela y descongela con una sola petición', () => {
    const release = holdBalance()
    expect(isBalanceHeld()).toBe(true)
    release()
    expect(isBalanceHeld()).toBe(false)
  })

  it('con dos peticiones a la vez, soltar una NO descongela', () => {
    // El caso real: la tirada congela, y el modal de sobres pendientes tambien. Si soltar una
    // descongelara, el saldo se actualizaria a mitad del reveal y destriparia el resultado.
    const releaseA = holdBalance()
    const releaseB = holdBalance()
    releaseA()
    expect(isBalanceHeld()).toBe(true)
    releaseB()
    expect(isBalanceHeld()).toBe(false)
  })

  it('soltar dos veces la misma no descuenta de más', () => {
    // React puede ejecutar el cleanup de un efecto mas de una vez; sin idempotencia, la segunda
    // llamada se comeria la congelacion de OTRO que si sigue vivo.
    const releaseA = holdBalance()
    const releaseB = holdBalance()
    releaseA()
    releaseA()
    expect(isBalanceHeld()).toBe(true)
    releaseB()
    expect(isBalanceHeld()).toBe(false)
  })

  it('nunca queda en negativo', () => {
    const release = holdBalance()
    release()
    release()
    expect(isBalanceHeld()).toBe(false)
    const again = holdBalance()
    expect(isBalanceHeld()).toBe(true)
    again()
    expect(isBalanceHeld()).toBe(false)
  })
})
