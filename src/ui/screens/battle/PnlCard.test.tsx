import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PnlCard } from './PnlCard'
import type { Pnl } from './pnl'

const pnl = (over: Partial<Pnl> = {}): Pnl => ({
  mode: 'PACK BATTLE', winner: 'A', entry: 450, payout: 1812,
  profit: 1362, multiple: 4.026, background: null, ...over,
})

describe('PnlCard', () => {
  it('enseña la ganancia con signo y sin céntimos', () => {
    render(<PnlCard pnl={pnl()} winnerName="prueba2" />)
    expect(screen.getByText('+$1,362')).toBeTruthy()
    expect(screen.getByText('×4.0 RETURN')).toBeTruthy()
  })

  it('enseña quién ganó, el modo y las dos cifras de origen', () => {
    render(<PnlCard pnl={pnl()} winnerName="prueba2" />)
    expect(screen.getByText(/prueba2/)).toBeTruthy()
    expect(screen.getByText('WINNER')).toBeTruthy()
    expect(screen.getByText('PACK BATTLE')).toBeTruthy()
    expect(screen.getByText('$450')).toBeTruthy()      // entry
    expect(screen.getByText('$1,812')).toBeTruthy()    // payout
  })

  it('una pérdida sale con su signo, no maquillada', () => {
    render(<PnlCard pnl={pnl({ profit: -100, payout: 350, multiple: 0.78 })} winnerName="prueba2" />)
    expect(screen.getByText('−$100')).toBeTruthy()
    expect(screen.queryByText(/\+\$/)).toBeNull()
    expect(screen.getByText('WINNER')).toBeTruthy()    // ganó la partida igual
  })

  it('sin entrada no se pinta el múltiplo', () => {
    // Un lobby de la casa se abre sin cobrar: "×∞ RETURN" no significaría nada.
    render(<PnlCard pnl={pnl({ entry: 0, multiple: null })} winnerName="prueba2" />)
    expect(screen.queryByText(/RETURN/)).toBeNull()
  })

  it('la carta del botín va de fondo cuando la hay', () => {
    const { rerender } = render(<PnlCard pnl={pnl({ background: 'https://cc/x.png' })} winnerName="p" />)
    const con = screen.getByTestId('pnl-card')
    expect(con.style.backgroundImage).toContain('https://cc/x.png')

    rerender(<PnlCard pnl={pnl()} winnerName="p" />)
    expect(screen.getByTestId('pnl-card').style.backgroundImage).toBe('')
  })
  it('sin enlace no hay botón: la tarjeta queda limpia para una captura', () => {
    render(<PnlCard pnl={pnl()} winnerName="prueba2" />)
    expect(screen.queryByText('Share on X')).toBeNull()
  })

  it('con enlace el botón va DENTRO de la tarjeta, no al lado', () => {
    render(<PnlCard pnl={pnl()} winnerName="prueba2" shareHref="https://x.com/intent/post?text=hola" />)
    const boton = screen.getByText('Share on X').closest('a') as HTMLAnchorElement
    expect(screen.getByTestId('pnl-card').contains(boton)).toBe(true)
    expect(boton.style.position).toBe('absolute')   // esquina inferior derecha
    expect(boton.style.right).not.toBe('')
    expect(boton.style.bottom).not.toBe('')
  })
})
